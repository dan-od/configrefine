#!/usr/bin/env python3
"""
ConfigRefine — Lab Config Puller

Usage:
  python pull_configs.py                    Interactive CLI
  python pull_configs.py --serve            Local dev (no auth, HTTP)
  python pull_configs.py --serve --api-key MY_SECRET_KEY
  python pull_configs.py --serve --api-key MY_KEY --cert cert.pem --key key.pem
  python pull_configs.py --serve --api-key MY_KEY --cors https://configrefine.yourdomain.com

Options:
  --serve           Start HTTP API server
  --port N          Listen port (default: 3001)
  --api-key KEY     Require API key in Authorization header
  --cert FILE       TLS certificate file (enables HTTPS)
  --key FILE        TLS private key file
  --cors ORIGIN     Allowed CORS origin (default: * for dev)
  --rate-limit N    Max requests/min per IP (default: 10, 0=unlimited)
"""

import sys
import os
from backend.api import start_server
from backend.device_ops import discover_devices, pull_all_configs


def get_arg(flag, default=None):
    """Get a CLI argument value by flag name."""
    for i, a in enumerate(sys.argv):
        if a == flag and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def serve_mode():
    port = int(get_arg("--port", "3001"))
    api_key = get_arg("--api-key") or os.environ.get("CONFIGREFINE_API_KEY")
    cors = get_arg("--cors", "*")
    certfile = get_arg("--cert")
    keyfile = get_arg("--key")
    rate_limit = int(get_arg("--rate-limit", "10"))

    start_server(
        port=port,
        api_key=api_key,
        cors_origin=cors,
        certfile=certfile,
        keyfile=keyfile,
        rate_limit=rate_limit,
    )


def cli_mode():
    print("\n  ConfigRefine — Lab Config Puller\n")
    host = input("  Host: ").strip()
    port = input("  Port [22]: ").strip() or "22"
    username = input("  Username: ").strip()
    password = input("  Password: ").strip()

    result = discover_devices(host, port, username, password)
    if "error" in result:
        print(f"\n  ✗ {result['error']}")
        return

    devices = result["devices"]
    print(f"\n  Found {len(devices)} devices:")
    for k, v in sorted(devices.items(), key=lambda x: int(x[0])):
        print(f"    [{k}] {v}")

    sel = input(f"\n  Pull which? (comma-separated, or 'all') [all]: ").strip()
    selected = devices if not sel or sel.lower() == "all" else \
        {k: v for k, v in devices.items() if k in [n.strip() for n in sel.split(",")]}

    enable_pass = input("  Enable password (blank if none): ").strip()
    pull_all_configs(host=host, port=int(port), username=username,
                     password=password, devices=selected, enable_pass=enable_pass)


if __name__ == "__main__":
    if "--serve" in sys.argv:
        serve_mode()
    elif "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
    else:
        cli_mode()
