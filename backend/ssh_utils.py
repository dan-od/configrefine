"""SSH connection helpers and menu parsing."""

import paramiko
import time
import re


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
    host = host.replace("http://", "").replace("https://", "").strip("/").strip()
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
