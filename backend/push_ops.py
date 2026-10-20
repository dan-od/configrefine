"""Device push and erase operations — push config or erase via SSH / console server."""

import re
import time
import paramiko
from .ssh_utils import wait_for, sanitize_host, ensure_privileged_exec
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

def _do_write_erase(channel):
    """Send write erase and confirm. Returns when device returns to prompt."""
    channel.send("write erase\r")
    out = wait_for(channel, ["[confirm]", "[OK]", "#"], timeout=15)
    if "[confirm]" in out:
        channel.send("\r")
        wait_for(channel, ["[OK]", "#"], timeout=15)
    time.sleep(0.5)


def _do_reload(channel):
    """Send reload and confirm. The SSH session will drop — that is expected.
    Returns without error whether the session drops or not."""
    channel.send("reload\r")
    out = wait_for(channel, ["[confirm]", "Save?", "modified", "Proceed"], timeout=15)
    # Some IOS versions ask to save unsaved changes first — always say no
    if "Save?" in out or "modified" in out:
        channel.send("no\r")
        out = wait_for(channel, ["[confirm]", "Proceed"], timeout=10)
    # Confirm the reload
    if "[confirm]" in out or "Proceed" in out or "confirm" in out.lower():
        channel.send("\r")
    # Wait briefly — the device will cut the connection as it reloads
    try:
        wait_for(channel, ["restarting", "reset", "#"], timeout=8)
    except Exception:
        pass


def erase_reload_direct(host, port, username, password, enable_pass=""):
    """SSH directly to a device, run 'write erase' then 'reload'.
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
        ensure_privileged_exec(channel, enable_pass)
    except Exception:
        client.close()
        raise

    print(f"      → write erase...")
    _do_write_erase(channel)

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
    return {"name": host_clean, "status": "reloading"}


def erase_reload_via_console(channel, device_num, device_name, enable_pass=""):
    """From a console server menu, connect to device, run 'write erase' + 'reload',
    then return to the console menu (the menu port stays open even as the device reboots).
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
        ensure_privileged_exec(channel, enable_pass)

        print(f"      → write erase...")
        _do_write_erase(channel)

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
    return {"name": device_name, "status": "reloading"}
