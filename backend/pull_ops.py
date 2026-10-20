"""Console-server pull operations — discover, pull, escape."""

import re
import time
from .ssh_utils import ssh_connect, wait_for, parse_menu, ensure_privileged_exec, read_running_config, _read_until_idle

# The console server clears the screen once it has attached to the device
CLEAR_SCREEN = "\x1b[J"


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
    # The menu title is wrapped in ANSI colour codes ("[\x1b[1mPOD 13 - Main Menu")
    plain = re.sub(r'\x1b\[[0-9;?]*[A-Za-z]', '', menu)
    pod_match = re.search(r'\[POD\s*(\S+)', plain)
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


def dismiss_banner(channel, attempts=3):
    """Answer the console server's "Press any key" banner and wait until it has attached.

    Nothing may be typed to the device before the server acknowledges the key by clearing
    the screen: keys sent while the banner is still being drawn are discarded, and keys
    sent after it are passed to the device. Losing the first keys of
    ensure_privileged_exec()'s safety sequence (Ctrl+C, Ctrl+U) would leave only its
    Enter to reach the device, which confirms a pending "Proceed with reload? [confirm]".
    Raises RuntimeError rather than proceed if the server never acknowledges.
    """
    _read_until_idle(channel, timeout=4, idle=0.5)   # let the banner finish drawing
    for _ in range(attempts):
        # Ctrl+U: accepted as "any key" (this server ignores Ctrl+C) and harmless if passed through
        channel.send("\x15")
        if CLEAR_SCREEN in wait_for(channel, CLEAR_SCREEN, timeout=3):
            time.sleep(0.2)
            _drain(channel)
            return
    raise RuntimeError("Console server did not attach to the device (no response to 'Press any key')")


def _drain(channel):
    while channel.recv_ready():
        channel.recv(65535)


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
        dismiss_banner(channel)
        ensure_privileged_exec(channel, enable_pass)

        print(f"      → Pulling show running-config...")
        config_buf = read_running_config(channel)
    finally:
        print(f"      → Returning to menu...")
        return_to_menu(channel)

    print(f"      ✓ Done — {len(config_buf)} bytes")
    return config_buf


_DEFAULT_HOSTNAMES = {"Router", "Switch", "switch"}


def unique_device_name(config, menu_name, used):
    """Name a pulled config by its hostname, falling back to the console menu label when
    the hostname is a factory default or already used — a freshly erased pod has four
    routers all called "Router", which would otherwise overwrite each other."""
    m = re.search(r'^hostname\s+(\S+)', config, re.MULTILINE)
    name = m.group(1) if m else menu_name
    if name in _DEFAULT_HOSTNAMES or name in used:
        name = menu_name if menu_name not in used else f"{name}-{len(used) + 1}"
    used.add(name)
    return name


def pull_all_configs(host, port, username, password, devices, enable_pass=""):
    """Pull configs from selected devices via console server. Returns {name: config}."""
    results = {}
    used = set()
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
                device_name = unique_device_name(config, name, used)
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
