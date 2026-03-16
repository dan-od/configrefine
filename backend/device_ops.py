"""Device discovery and config pulling operations."""

import re
import time
from .ssh_utils import ssh_connect, wait_for, parse_menu


def discover_devices(host, port, username, password):
    """SSH in, read menu, parse device list, disconnect."""
    print(f"  Discovering devices on {host}:{port}...")
    try:
        client, channel, menu = ssh_connect(host, port, username, password)
    except Exception as e:
        print(f"  ✗ Connection failed: {e}")
        return {"error": str(e)}

    if "> " not in menu:
        client.close()
        return {"error": "No menu prompt received"}

    devices = parse_menu(menu)
    pod_match = re.search(r'\[POD\s*(\S+)', menu)
    pod = pod_match.group(1).rstrip(']').strip() if pod_match else ""

    try:
        channel.send("x\n")
    except:
        pass
    client.close()

    print(f"  ✓ Found {len(devices)} devices (POD {pod})")
    for k, v in sorted(devices.items(), key=lambda x: int(x[0])):
        print(f"    [{k}] {v}")

    return {"devices": devices, "pod": pod, "raw_menu": menu}


def escape_to_menu(channel):
    """Send ~. escape sequence to return to console server menu."""
    channel.send("\r")
    time.sleep(0.3)
    channel.send("~")
    time.sleep(0.3)
    channel.send(".")
    time.sleep(1.5)
    return wait_for(channel, "> ", timeout=10)


def pull_single_device(channel, device_num, device_name, enable_pass=""):
    """From the main menu, connect to device, pull show run, return to menu."""
    print(f"  [{device_num}] Connecting to {device_name}...")

    channel.send(f"{device_num}\n")
    output = wait_for(channel, "Press any key", timeout=10)

    if "Press any key" not in output:
        print(f"      ⚠ No connection banner: {output[-80:]}")
        return None

    time.sleep(0.5)
    channel.send("\r")
    wait_for(channel, [">", "#"], timeout=8)

    time.sleep(0.5)
    channel.send("\r")
    prompt_check = wait_for(channel, [">", "#"], timeout=5)

    if ">" in prompt_check.split("\n")[-1]:
        print(f"      → User mode, sending enable...")
        channel.send("enable\r")
        time.sleep(0.5)
        en_out = wait_for(channel, ["#", "Password"], timeout=5)
        if "Password" in en_out or "password" in en_out:
            channel.send(f"{enable_pass}\r")
            wait_for(channel, "#", timeout=5)

    channel.send("terminal length 0\r")
    wait_for(channel, "#", timeout=3)

    print(f"      → Pulling show running-config...")
    channel.send("show running-config\r")
    time.sleep(1)

    config_buf = ""
    start = time.time()
    while time.time() - start < 20:
        if channel.recv_ready():
            chunk = channel.recv(65535).decode("utf-8", errors="replace")
            config_buf += chunk
            if "end" in config_buf and "#" in config_buf.split("end")[-1]:
                break
        time.sleep(0.2)

    print(f"      → Returning to menu...")
    menu_buf = escape_to_menu(channel)
    if "> " not in menu_buf:
        print(f"      → Retry escape...")
        escape_to_menu(channel)

    print(f"      ✓ Done — {len(config_buf)} bytes")
    return config_buf


def pull_all_configs(host, port, username, password, devices, enable_pass=""):
    """Pull configs from selected devices. Returns {name: config}."""
    results = {}
    print(f"\n{'='*60}")
    print(f"  Pulling {len(devices)} devices from {host}:{port}")
    print(f"{'='*60}\n")

    try:
        client, channel, menu = ssh_connect(host, port, username, password)
    except Exception as e:
        return {"error": str(e)}

    if "> " not in menu:
        client.close()
        return {"error": "No menu prompt received"}

    for num, name in devices.items():
        try:
            config = pull_single_device(channel, num, name, enable_pass)
            if config:
                host_match = re.search(r'^hostname\s+(\S+)', config, re.MULTILINE)
                device_name = host_match.group(1) if host_match else name
                results[device_name] = config
                print(f"      ✓ {device_name} — {len(config)} bytes\n")
            else:
                results[name] = None
        except Exception as e:
            print(f"      ✗ Error: {e}\n")
            results[name] = None
            try:
                escape_to_menu(channel)
            except:
                pass

    try:
        channel.send("x\n")
    except:
        pass
    client.close()

    ok = sum(1 for v in results.values() if v)
    print(f"\n  Done — {ok}/{len(devices)} pulled\n")
    return results
