"""Device push and erase operations — push config or erase via SSH / console server."""

import re
import time
import paramiko
from .ssh_utils import wait_for, sanitize_host, ensure_privileged_exec, run_show, _last_line
from .pull_ops import return_to_menu, dismiss_banner


# Lines that must never be sent during a config push
_PUSH_SKIP_PREFIXES = [
    "Building configuration", "Current configuration",
    "end", "Last configuration change", "NVRAM config",
    "show run",
]


def _should_skip_line(line):
    """Return True if this line should be skipped when pushing a config."""
    stripped = line.rstrip()
    if not stripped or stripped == "!":
        return True
    if any(stripped.lstrip().startswith(p) for p in _PUSH_SKIP_PREFIXES):
        return True
    if re.match(r'^version\s+\d', stripped):
        return True
    return False


def _push_lines(channel, lines):
    """Push config lines to an open channel. Returns (pushed_count, errors)."""
    pushed = 0
    errors = []
    for line in lines:
        if _should_skip_line(line):
            continue
        try:
            channel.send(line.rstrip() + "\r")
        except (paramiko.SSHException, OSError) as e:
            errors.append(f"SSH connection dropped at line {pushed}: {e}")
            return pushed, errors
        time.sleep(0.05)
        # Drain buffer every 20 lines to catch IOS error messages
        if pushed > 0 and pushed % 20 == 0:
            time.sleep(0.3)
            if channel.recv_ready():
                out = channel.recv(65535).decode("utf-8", errors="replace")
                for out_line in out.split("\n"):
                    ol = out_line.strip()
                    if ol.startswith("% ") or "Invalid" in ol:
                        errors.append(ol)
        pushed += 1

    # Final drain
    time.sleep(1)
    try:
        if channel.recv_ready():
            out = channel.recv(65535).decode("utf-8", errors="replace")
            for out_line in out.split("\n"):
                ol = out_line.strip()
                if ol.startswith("% ") or "Invalid" in ol:
                    errors.append(ol)
    except (paramiko.SSHException, OSError):
        pass

    return pushed, errors


def push_config_direct(host, port, username, password, config_text, enable_pass=""):
    """SSH directly to a device, enter config mode, push config line by line."""
    print(f"  Push config to {host}:{port}...")
    # Strip URL-like prefixes — ssh_utils.ssh_connect also does this but be explicit
    host_clean = re.sub(r'^https?://', '', host).strip('/ ')

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host_clean, port=int(port),
            username=username, password=password,
            timeout=15, look_for_keys=False, allow_agent=False,
        )
    except Exception as e:
        raise RuntimeError(f"SSH connect failed: {e}") from e

    channel = client.invoke_shell(width=200, height=50)
    time.sleep(1)

    try:
        ensure_privileged_exec(channel, enable_pass)
    except Exception:
        client.close()
        raise

    print(f"      → Entering configure terminal...")
    channel.send("configure terminal\r")
    time.sleep(0.5)
    wait_for(channel, "(config)", timeout=5)

    lines = config_text.strip().split("\n")
    pushed, errors = _push_lines(channel, lines)

    # Exit config mode (best-effort)
    try:
        channel.send("end\r")
        time.sleep(0.5)
        wait_for(channel, "#", timeout=3)
        channel.send("exit\r")
    except (paramiko.SSHException, OSError):
        pass
    finally:
        client.close()

    host_match = re.search(r'^hostname\s+(\S+)', config_text, re.MULTILINE)
    device_name = host_match.group(1) if host_match else host_clean

    print(f"      Done: {device_name} — {pushed} lines, {len(errors)} errors")
    return {"name": device_name, "pushed": pushed, "total_lines": len(lines), "errors": errors}


def push_via_console(channel, device_num, device_name, config_text, enable_pass=""):
    """From console server menu, connect to a device and push config."""
    print(f"  [{device_num}] Pushing config to {device_name}...")

    channel.send(f"{device_num}\n")
    output = wait_for(channel, "Press any key", timeout=10)
    if "Press any key" not in output:
        print(f"      No connection banner")
        return None

    try:
        dismiss_banner(channel)
        ensure_privileged_exec(channel, enable_pass)

        print(f"      → Entering configure terminal...")
        channel.send("configure terminal\r")
        time.sleep(0.5)
        wait_for(channel, "(config)", timeout=5)

        lines = config_text.strip().split("\n")
        pushed, errors = _push_lines(channel, lines)

        # Exit config mode before returning to the console menu
        try:
            channel.send("end\r")
            time.sleep(0.5)
            wait_for(channel, "#", timeout=3)
        except (paramiko.SSHException, OSError):
            pass
    finally:
        print(f"      → Returning to menu...")
        return_to_menu(channel)

    host_match = re.search(r'^hostname\s+(\S+)', config_text, re.MULTILINE)
    detected = host_match.group(1) if host_match else device_name

    print(f"      Done: {detected} — {pushed} lines, {len(errors)} errors")
    return {"name": detected, "pushed": pushed, "total_lines": len(lines), "errors": errors}


# ── Erase operations ──────────────────────────────────────────────────────────

def _ios_error(out):
    """First IOS error line ("% ..." / "%Error ...") in `out`, for error messages."""
    for line in out.replace("\r", "\n").split("\n"):
        if line.strip().startswith("%"):
            return line.strip()
    return _last_line(out)


def _do_write_erase(channel, prompt):
    """Send write erase and confirm. Returns once the device is back at `prompt`.
    Raises RuntimeError if IOS reports an error (the reload must not follow then)."""
    channel.send("write erase\r")
    out = wait_for(channel, ["[confirm]", prompt], timeout=15)
    if "[confirm]" in out:
        channel.send("\r")
        out = wait_for(channel, [prompt], timeout=30)
    if "%Error" in out or "Invalid input" in out:
        raise RuntimeError(f"write erase failed: {_ios_error(out)}")
    time.sleep(0.5)


# show version signals, most specific first. Strong switch signals win; router models beat
# the generic word "Catalyst" (Catalyst 8200/8300 are Edge *routers*).
_STRONG_SWITCH_RE = re.compile(
    r"Switch Ports\s+Model"                       # per-member table on 2960/3560/3750/3650/3850/9k
    r"|\bWS-C\d"                                  # classic Catalyst model numbers (WS-C2960-24TT-L)
    r"|\bC9[2-6]00[A-Z]?-"                        # Catalyst 9200/9300/9400/9500/9600 (C9200L-24T-4G)
    r"|\b(?:c29[56]0|c35[56]0|c37[56]0|c3[68]50|c4500|c6500|cat[2-9]k|cat9k|cat3k|s720\d\d|ie\d{4})",
    re.IGNORECASE)
_ROUTER_RE = re.compile(
    r"\bISR\d|\bisr\d{4}"                         # ISR4321, isr4300-universalk9
    r"|\bCISCO(?:18|19|28|29|38|39)\d\d"          # CISCO2911/K9, CISCO1941/K9
    r"|\bC(?:18|19|28|29|38|39)00\b"              # "C2900 Software (C2900-UNIVERSALK9-M)"
    r"|\bc1841\b|\bASR\d|\bCSR1000V|\bC8[0-5]00[A-Z]*\b|\bC11\d\d\b",  # C8200L-1N-4T (lab pod)
    re.IGNORECASE)
_WEAK_SWITCH_RE = re.compile(r"\bCatalyst\b", re.IGNORECASE)
# A file row in `dir flash:` output: "  2  -rwx  736  Mar 1 1993 00:04:29 +00:00  vlan.dat"
# (anchored on the index + permission columns so the echoed command can never match)
_VLAN_DAT_ROW_RE = re.compile(r"^\s*\d+\s+[-dlrwx]{4,}\s.*\bvlan\.dat\s*$", re.MULTILINE)


def detect_switch(channel, prompt):
    """Decide whether the device is a switch and whether flash:vlan.dat exists.

    VLANs (and VTP state) live in flash:vlan.dat, not in startup-config, so `write erase`
    leaves them behind. The direct test for "is there VLAN state to wipe" is whether
    vlan.dat is listed in `dir flash:`; `show version` classifies the device for reporting
    and covers the case where `dir flash:` can't be parsed. Heuristic, in order:

      1. strong switch signal in show version ("Switch Ports Model" table, WS-C..., C9x00-,
         Catalyst image names such as c2960-/c3750-/cat9k_iosxe)        -> switch
      2. router model / image (ISR..., CISCO29xx, C2900 Software, ASR, CSR1000V, C8x00) -> router
      3. the word "Catalyst" alone                                       -> switch
      4. no model signal but vlan.dat present                            -> switch
      5. otherwise                                                       -> router

    `terminal length 0` is sent first; run_show also pages through --More-- if it appears.
    Returns {"device_type": "switch"|"router", "vlan_dat": True|False|None, "reason": str},
    where vlan_dat is None when `dir flash:` didn't produce a usable listing.
    """
    run_show(channel, "terminal length 0", prompt, timeout=10)
    try:
        ver = run_show(channel, "show version", prompt, timeout=60)
    except RuntimeError:
        ver = ""
    try:
        listing = run_show(channel, "dir flash:", prompt, timeout=60)
    except RuntimeError:
        listing = ""
    if "Directory of" in listing and "Invalid input" not in listing and "%Error" not in listing:
        vlan_dat = bool(_VLAN_DAT_ROW_RE.search(listing))
    else:
        vlan_dat = None

    m = _STRONG_SWITCH_RE.search(ver)
    if m:
        return {"device_type": "switch", "vlan_dat": vlan_dat, "reason": f"show version: {m.group(0).strip()}"}
    m = _ROUTER_RE.search(ver)
    if m:
        return {"device_type": "router", "vlan_dat": vlan_dat, "reason": f"show version: {m.group(0).strip()}"}
    m = _WEAK_SWITCH_RE.search(ver)
    if m:
        return {"device_type": "switch", "vlan_dat": vlan_dat, "reason": "show version: Catalyst"}
    if vlan_dat:
        return {"device_type": "switch", "vlan_dat": True, "reason": "vlan.dat present in flash:"}
    return {"device_type": "router", "vlan_dat": vlan_dat, "reason": "no switch signal"}


def _do_delete_vlan_dat(channel, prompt):
    """Run `delete flash:vlan.dat` and walk its confirmation dialog.

    Plain `delete` (not /force) so each prompt names the file before we confirm it:
      Delete filename [vlan.dat]?          -> Enter (accept the default name)
      Delete flash:/vlan.dat? [confirm]    -> Enter
    Either prompt may be missing (`file prompt quiet`) or come in either order. A prompt
    that does not mention vlan.dat is aborted with Ctrl+C. Returns "deleted", or "absent"
    when IOS says the file doesn't exist; raises RuntimeError on any other error.
    """
    channel.send("delete flash:vlan.dat\r")
    out = ""
    for _ in range(6):
        chunk = wait_for(channel, ["?", "[confirm]", "rror", "No such file", "Invalid input", prompt], timeout=15)
        if chunk and _last_line(chunk) != prompt and "?" not in chunk and "[confirm]" not in chunk:
            # An error line: let the rest of it and the prompt arrive before deciding
            chunk += wait_for(channel, [prompt], timeout=10)
        out += chunk
        low = chunk.lower()
        last = _last_line(chunk)
        if "no such file" in low or "file not found" in low:
            return "absent"
        if "%error" in low or "invalid input" in low:
            raise RuntimeError(f"delete flash:vlan.dat failed: {_ios_error(chunk)}")
        if last == prompt:
            return "deleted"
        if "[confirm]" in last or last.endswith("?"):
            if "vlan.dat" not in last:
                channel.send("\x03")
                raise RuntimeError(f"Unexpected prompt during delete, aborted: {last!r}")
            channel.send("\r")
            continue
        if not chunk:
            break
    channel.send("\x03")
    raise RuntimeError(f"delete flash:vlan.dat did not finish (last seen: {_last_line(out)!r})")


def _clear_vlan_dat(channel, prompt):
    """After write erase: detect the device type and delete flash:vlan.dat when present.
    Returns (device_type, vlan_dat_status) with status "deleted" | "absent" | "n/a"."""
    info = detect_switch(channel, prompt)
    device_type, present = info["device_type"], info["vlan_dat"]
    print(f"      → Detected {device_type} ({info['reason']}); vlan.dat "
          f"{'present' if present else 'absent' if present is False else 'unknown'}")

    # Delete whenever vlan.dat is listed (also on a router with a switch module), and on a
    # switch whose flash listing couldn't be read (delete then reports "No such file")
    if not (present or (device_type == "switch" and present is None)):
        return device_type, ("absent" if device_type == "switch" else "n/a")

    print(f"      → delete flash:vlan.dat...")
    status = _do_delete_vlan_dat(channel, prompt)
    if status == "deleted" and present is not None:
        if _VLAN_DAT_ROW_RE.search(run_show(channel, "dir flash:", prompt, timeout=60)):
            raise RuntimeError("flash:vlan.dat is still present after delete")
    return device_type, status


def _do_reload(channel):
    """Send reload, answer the dialog, confirm. The session will drop — that is expected.

    IOS may first ask "System configuration has been modified. Save? [yes/no]:" (it does
    after write erase on many versions). That is always answered "no": "yes" would write
    the running config back to NVRAM and undo the erase. Then "Proceed with reload?
    [confirm]" is confirmed with Enter. Returns {"save_prompt": bool, "confirmed": bool}.
    """
    channel.send("reload\r")
    save_prompt = confirmed = False
    for _ in range(4):
        out = wait_for(channel, ["[yes/no]", "[confirm]"], timeout=15)
        low = out.lower()
        if "[yes/no]" in low:
            # Save? [yes/no] — never save
            save_prompt = True
            channel.send("no\r")
            continue
        if "[confirm]" in low or "proceed with reload" in low:
            channel.send("\r")
            confirmed = True
            break
        if not out:
            break
    # Wait briefly — the device will cut the connection as it reloads
    try:
        wait_for(channel, ["restarting", "reset", "RELOAD", "#"], timeout=8)
    except Exception:
        pass
    return {"save_prompt": save_prompt, "confirmed": confirmed}


def erase_reload_direct(host, port, username, password, enable_pass=""):
    """SSH directly to a device: write erase, delete flash:vlan.dat on switches, reload.
    The SSH connection drops when the device reboots — that is treated as success.
    """
    host_clean = sanitize_host(host)
    print(f"  Erase & reload {host_clean}:{port}...")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host_clean, port=int(port),
            username=username, password=password,
            timeout=15, look_for_keys=False, allow_agent=False,
        )
    except Exception as e:
        raise RuntimeError(f"SSH connect failed: {e}") from e

    channel = client.invoke_shell(width=200, height=50)
    time.sleep(1)

    try:
        prompt = ensure_privileged_exec(channel, enable_pass)

        print(f"      → write erase...")
        _do_write_erase(channel, prompt)
        device_type, vlan_dat = _clear_vlan_dat(channel, prompt)
    except Exception:
        client.close()
        raise

    print(f"      → reload (connection will drop — this is expected)...")
    try:
        _do_reload(channel)
    except (paramiko.SSHException, OSError, EOFError):
        # Connection dropped because device is rebooting — this is the happy path
        pass

    try:
        client.close()
    except Exception:
        pass

    print(f"      ✓ Erase & reload initiated on {host_clean}")
    return {"name": host_clean, "status": "reloading", "device_type": device_type, "vlan_dat": vlan_dat}


def erase_reload_via_console(channel, device_num, device_name, enable_pass=""):
    """From a console server menu, connect to device: write erase, delete flash:vlan.dat
    on switches, reload, then return to the console menu (the menu port stays open even
    as the device reboots).
    """
    print(f"  [{device_num}] Erase & reload {device_name}...")

    channel.send(f"{device_num}\n")
    output = wait_for(channel, "Press any key", timeout=10)
    if "Press any key" not in output:
        print(f"      No connection banner for [{device_num}]")
        return None

    reloading = False
    try:
        dismiss_banner(channel)
        prompt = ensure_privileged_exec(channel, enable_pass)

        print(f"      → write erase...")
        _do_write_erase(channel, prompt)
        device_type, vlan_dat = _clear_vlan_dat(channel, prompt)

        print(f"      → reload (device will reboot — menu port stays open)...")
        reloading = True
        try:
            _do_reload(channel)
        except (paramiko.SSHException, OSError, EOFError):
            # Expected: device cut the console session as it rebooted
            pass
    finally:
        # The console server keeps the TCP session alive even while the device reloads;
        # give it a moment to start rebooting before escaping back to the menu
        if reloading:
            print(f"      → Waiting for device to start reload then returning to menu...")
            time.sleep(4)
        return_to_menu(channel, retry_delay=3 if reloading else 0)

    print(f"      ✓ Erase & reload initiated on {device_name}")
    return {"name": device_name, "status": "reloading", "device_type": device_type, "vlan_dat": vlan_dat}
