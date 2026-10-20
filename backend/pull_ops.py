"""Console-server pull operations — discover, pull, escape."""

import re
import time
from .ssh_utils import ssh_connect, wait_for, parse_menu, ensure_privileged_exec, read_running_config


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
    except Exception:
        pass
    client.close()

    print(f"  ✓ Found {len(devices)} devices (POD {pod})")
    for k, v in sorted(devices.items(), key=lambda x: int(x[0])):
        print(f"    [{k}] {v}")

    return {"devices": devices, "pod": pod, "raw_menu": menu}


def escape_to_menu(channel):
    """Send ~. escape sequence to return to console server menu."""
    # Ctrl+U first so the Enter (needed for ~. to be seen at line start) can't run a half-typed command
    channel.send("\x15\r")
    time.sleep(0.3)
    channel.send("~")
    time.sleep(0.3)
    channel.send(".")
    time.sleep(1.5)
    return wait_for(channel, "> ", timeout=10)


def return_to_menu(channel, retry_delay=0):
    """Escape to the console-server menu, retrying once. Never raises, so it is safe in
    a finally block; a failure is logged rather than masking the original error."""
    try:
        if "> " not in escape_to_menu(channel):
            print(f"      → Retry escape...")
            time.sleep(retry_delay)
            escape_to_menu(channel)
    except Exception as e:
        print(f"      ⚠ Escape to menu failed: {e}")


def pull_single_device(channel, device_num, device_name, enable_pass=""):
    """From the main menu, connect to device, pull show run, return to menu."""
    print(f"  [{device_num}] Connecting to {device_name}...")

    channel.send(f"{device_num}\n")
    output = wait_for(channel, "Press any key", timeout=10)

    if "Press any key" not in output:
        print(f"      ⚠ No connection banner: {output[-80:]}")
        return None

    # From here on we are inside the device's console: always escape back to the menu,
    # or the next device's menu number would be typed into this console
    try:
        time.sleep(0.5)
        ensure_privileged_exec(channel, enable_pass)

        print(f"      → Pulling show running-config...")
        config_buf = read_running_config(channel)
    finally:
        print(f"      → Returning to menu...")
        return_to_menu(channel)

    print(f"      ✓ Done — {len(config_buf)} bytes")
    return config_buf


def pull_all_configs(host, port, username, password, devices, enable_pass=""):
    """Pull configs from selected devices via console server. Returns {name: config}."""
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
        channel.send("x\n")
    except Exception:
        pass
    client.close()

    ok = sum(1 for v in results.values() if v)
    print(f"\n  Done — {ok}/{len(devices)} pulled\n")
    return results
