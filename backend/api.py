"""HTTP API server for ConfigRefine — with auth, HTTPS, and rate limiting."""

import json
import re
import ssl
import time
import hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from .ssh_utils import ssh_connect, wait_for
from .device_ops import discover_devices, pull_single_device

# ── Server config (set by start_server) ──
_config = {
    "api_key": None,       # None = no auth required (local dev)
    "cors_origin": "*",    # Restrict in production
    "rate_limit": 10,      # Max requests per minute per IP
}

# ── Rate limiter (in-memory, per IP) ──
_rate_store = {}  # {ip: [timestamp, timestamp, ...]}

def _rate_check(ip, limit):
    """Returns True if allowed, False if rate limited."""
    if limit <= 0:
        return True
    now = time.time()
    window = 60  # 1 minute window
    hits = _rate_store.get(ip, [])
    hits = [t for t in hits if now - t < window]  # prune old
    if len(hits) >= limit:
        return False
    hits.append(now)
    _rate_store[ip] = hits
    return True


class APIHandler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = _config["cors_origin"]
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _json(self, code, data):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def _auth_ok(self):
        """Check API key if configured. Returns True if authorized."""
        key = _config["api_key"]
        if not key:
            return True  # No auth configured (local dev mode)
        header = self.headers.get("Authorization", "")
        # Accept "Bearer <key>" or just "<key>"
        token = header.replace("Bearer ", "").strip()
        if not token or token != key:
            self._json(401, {"error": "Unauthorized — invalid or missing API key"})
            return False
        return True

    def _rate_ok(self):
        """Check rate limit. Returns True if allowed."""
        ip = self.client_address[0]
        if not _rate_check(ip, _config["rate_limit"]):
            self._json(429, {"error": "Rate limited — too many requests"})
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/api/status":
            # Status endpoint doesn't require auth (frontend checks connectivity)
            self._json(200, {
                "status": "ready",
                "auth": _config["api_key"] is not None,
                "https": hasattr(self.connection, "getpeercert"),
            })
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth_ok():
            return
        if not self._rate_ok():
            return

        path = urlparse(self.path).path
        body = self._body()
        host = body.get("host", "")
        port = body.get("port", 3014)
        username = body.get("username", "")
        password = body.get("password", "")

        if not host or not username or not password:
            self._json(400, {"error": "Missing host, username, or password"})
            return

        if path == "/api/discover":
            result = discover_devices(host, port, username, password)
            self._json(200 if "devices" in result else 500, result)

        elif path == "/api/pull":
            self._handle_pull(body, host, port, username, password)

        else:
            self._json(404, {"error": "not found"})

    def _handle_pull(self, body, host, port, username, password):
        """Stream config results as each device completes."""
        devices = body.get("devices", {})
        enable_pass = body.get("enablePass", "")
        if not devices:
            self._json(400, {"error": "No devices selected"})
            return

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def send_line(data):
            line = json.dumps(data) + "\n"
            chunk = f"{len(line):X}\r\n{line}\r\n"
            self.wfile.write(chunk.encode())
            self.wfile.flush()

        send_line({"type": "status", "message": "Connecting to console server..."})
        try:
            client, channel, menu = ssh_connect(host, port, username, password)
        except Exception as e:
            send_line({"type": "error", "message": str(e)})
            send_line({"type": "done", "pulled": 0, "total": len(devices)})
            self.wfile.write(b"0\r\n\r\n")
            return

        if "> " not in menu:
            client.close()
            send_line({"type": "error", "message": "No menu prompt received"})
            send_line({"type": "done", "pulled": 0, "total": len(devices)})
            self.wfile.write(b"0\r\n\r\n")
            return

        send_line({"type": "status", "message": "Connected — pulling configs..."})
        pulled = 0

        for num, name in devices.items():
            send_line({"type": "pulling", "device": name, "num": num})
            try:
                config = pull_single_device(channel, num, name, enable_pass)
                if config:
                    host_match = re.search(r'^hostname\s+(\S+)', config, re.MULTILINE)
                    device_name = host_match.group(1) if host_match else name
                    send_line({"type": "device", "name": device_name, "menu_name": name, "num": num, "config": config, "size": len(config)})
                    pulled += 1
                else:
                    send_line({"type": "device_error", "name": name, "num": num, "message": "No config received"})
            except Exception as e:
                send_line({"type": "device_error", "name": name, "num": num, "message": str(e)})
                try:
                    from .device_ops import escape_to_menu
                    escape_to_menu(channel)
                except:
                    pass

        try:
            channel.send("x\n")
        except:
            pass
        client.close()

        send_line({"type": "done", "pulled": pulled, "total": len(devices)})
        self.wfile.write(b"0\r\n\r\n")

    def log_message(self, format, *args):
        print(f"  [API] {args[0]}")


def start_server(port=3001, api_key=None, cors_origin="*",
                 certfile=None, keyfile=None, rate_limit=10):
    """
    Start the API server.

    Args:
        port:        Listen port (default 3001)
        api_key:     Require this key in Authorization header (None = no auth)
        cors_origin: Allowed CORS origin ("*" for dev, "https://yourdomain.com" for prod)
        certfile:    Path to TLS certificate (None = plain HTTP)
        keyfile:     Path to TLS private key
        rate_limit:  Max requests per minute per IP (0 = unlimited)
    """
    _config["api_key"] = api_key
    _config["cors_origin"] = cors_origin
    _config["rate_limit"] = rate_limit

    server = HTTPServer(("0.0.0.0", port), APIHandler)

    # ── HTTPS setup ──
    proto = "http"
    if certfile and keyfile:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=certfile, keyfile=keyfile)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        proto = "https"

    print(f"\n{'='*60}")
    print(f"  ConfigRefine API — {proto}://localhost:{port}")
    print(f"  Auth:       {'API key required' if api_key else 'None (local dev)'}")
    print(f"  CORS:       {cors_origin}")
    print(f"  TLS:        {'Enabled' if certfile else 'Disabled (use Cloudflare or --cert)'}")
    print(f"  Rate limit: {rate_limit}/min per IP")
    print(f"  Endpoints:")
    print(f"    GET  /api/status    — health check")
    print(f"    POST /api/discover  — read device menu")
    print(f"    POST /api/pull      — pull configs (streaming)")
    print(f"{'='*60}\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
        server.server_close()
