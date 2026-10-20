"""SSH connection helpers, host sanitization, and menu parsing."""

import paramiko
import time
import re


def sanitize_host(host: str) -> str:
    """Strip URL prefixes and validate that the hostname/IP contains only safe chars.

    Raises ValueError for inputs that look like injection attempts so they never
    reach paramiko.  Call this before every ssh_connect / direct connect.
    """
    # Strip common URL prefixes users might accidentally paste
    host = re.sub(r'^https?://', '', host).strip('/ \t')
    if not host:
        raise ValueError("Host must not be empty")
    # Allow only valid hostname/IP characters (letters, digits, dots, hyphens)
    if not re.match(r'^[a-zA-Z0-9._-]+$', host):
        raise ValueError(f"Invalid hostname or IP address: {host!r}")
    return host


def wait_for(channel, patterns, timeout=15):
    """Read from channel until a pattern is found or timeout."""
    buf = ""
    start = time.time()
    if isinstance(patterns, str):
        patterns = [patterns]
    while time.time() - start < timeout:
        if channel.recv_ready():
            chunk = channel.recv(65535).decode("utf-8", errors="replace")
            buf += chunk
            for p in patterns:
                if p in buf:
                    return buf
        time.sleep(0.1)
    return buf


# Cisco-style prompt: hostname, optional "(config...)" mode, then > or #
_PROMPT_RE = re.compile(r'^(?P<host>[^\s()#>]+)(?P<mode>\([^)]*\))?(?P<char>[>#])\s*$')


def _read_until_idle(channel, timeout=5, idle=0.6):
    """Read until output goes quiet for `idle` seconds (or timeout)."""
    buf = ""
    start = last = time.time()
    while time.time() - start < timeout:
        if channel.recv_ready():
            buf += channel.recv(65535).decode("utf-8", errors="replace")
            last = time.time()
        elif buf and time.time() - last > idle:
            break
        time.sleep(0.1)
    return buf


def _last_line(buf):
    lines = [l.strip() for l in buf.replace("\r", "\n").split("\n") if l.strip()]
    return lines[-1] if lines else ""


def ensure_privileged_exec(channel, enable_pass="", attempts=10):
    """Bring a device to the privileged EXEC (#) prompt from whatever state it was left in.

    Handles config mode and submodes ((config)#, (config-if)#, ...), user EXEC (>),
    --More-- pagers, the initial configuration dialog / autoinstall questions,
    pending [confirm] / "...?" prompts (aborted, never confirmed) and
    "Press RETURN to get started" after an exec timeout.
    Returns the prompt line; raises RuntimeError if the device can't be brought to #.
    """
    enable_tries = 0
    pass_sent = False
    last = ""
    # Never press Enter blind: Ctrl+C aborts a pending [confirm]/question,
    # Ctrl+U discards a half-typed command (e.g. "reload") so Enter can't run it
    channel.send("\x03\x15")
    time.sleep(0.3)
    channel.send("\r")
    for _ in range(attempts):
        out = _read_until_idle(channel)
        last = _last_line(out)
        low = last.lower()

        if "--more--" in low:
            channel.send("q")
            continue
        if "initial configuration dialog" in low or ("[yes/no]" in low and "configuration" in out.lower()):
            channel.send("no\r")
            continue
        if "terminate autoinstall" in low:
            channel.send("yes\r")
            continue
        if "[confirm]" in low or "[yes/no]" in low or last.endswith("?"):
            # Something else is waiting for confirmation (reload, delete, copy) — abort it
            channel.send("\x03")
            continue
        if low.endswith("username:") or low.endswith("login:"):
            raise RuntimeError("Console asks for a login (Username:) — line login is not supported")
        if low.endswith("password:"):
            if enable_tries and not pass_sent:
                channel.send(f"{enable_pass}\r")
                pass_sent = True
            else:
                channel.send("\r")
            continue

        m = _PROMPT_RE.match(last)
        if m:
            if m.group("mode"):
                # Config mode or a submode: clear any half-typed line, then leave config
                channel.send("\x15end\r")
                continue
            if m.group("char") == ">":
                if enable_tries >= 2:
                    raise RuntimeError("enable failed — check the enable password")
                enable_tries += 1
                pass_sent = False
                channel.send("enable\r")
                continue
            return last

        # Unknown state (blank, "Press RETURN to get started", partial output): nudge
        channel.send("\r")

    raise RuntimeError(f"Could not reach privileged EXEC prompt (last seen: {last!r})")


def read_running_config(channel, timeout=60):
    """From privileged EXEC, disable paging and return `show running-config` output."""
    channel.send("terminal length 0\r")
    wait_for(channel, "#", timeout=3)
    channel.send("show running-config\r")
    time.sleep(1)

    buf = ""
    start = time.time()
    while time.time() - start < timeout:
        if channel.recv_ready():
            buf += channel.recv(65535).decode("utf-8", errors="replace")
            tail = buf.split("\n")
            if re.search(r'^end\s*$', buf, re.MULTILINE) and tail[-1].rstrip().endswith("#"):
                break
        time.sleep(0.2)

    if "% Invalid input" in buf:
        raise RuntimeError("show running-config was rejected by the device")
    if not re.search(r'^end\s*$', buf, re.MULTILINE):
        raise RuntimeError(f"show running-config incomplete — no 'end' line after {timeout}s ({len(buf)} bytes)")
    return buf


def ssh_connect(host, port, username, password):
    """Create SSH connection and return (client, channel, menu_text)."""
    host = sanitize_host(host)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=host, port=int(port),
        username=username, password=password,
        timeout=15, look_for_keys=False, allow_agent=False
    )
    channel = client.invoke_shell(width=200, height=50)
    time.sleep(1)
    menu = wait_for(channel, "> ", timeout=15)
    return client, channel, menu


def parse_menu(menu_text):
    """Parse console server menu, return {key: label} for numeric entries."""
    devices = {}
    for line in menu_text.split("\n"):
        m = re.match(r'.*\[(\d+)\]\s+(.+)', line)
        if m:
            label = re.split(r'\s{3,}\[', m.group(2))[0].strip()
            if label:
                devices[m.group(1)] = label
    return devices
