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
