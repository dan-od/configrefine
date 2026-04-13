"""HTTP API server for ConfigRefine — auth, HTTPS, rate limiting, security hardening."""

import json
import re
import ssl
import time
import hmac
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from .ssh_utils import ssh_connect, wait_for, sanitize_host
from .pull_ops import discover_devices, pull_single_device, escape_to_menu
from .push_ops import push_config_direct, push_via_console, erase_reload_direct, erase_reload_via_console

# ── Server config (set by start_server) ──
_config = {
    "api_key": None,       # None = no auth required (local dev)
    "cors_origin": "*",    # Restrict in production
    "rate_limit": 10,      # Max requests per minute per IP
}

# ── Per-IP, per-endpoint rate limiter ──
_rate_store: dict[str, list[float]] = {}

# ── Maximum request body size (5 MB) ──
MAX_BODY_BYTES = 5 * 1024 * 1024


def _rate_check(key: str, limit: int) -> bool:
    """Return True if the request is allowed; False if rate limited.
    `key` combines IP + endpoint path so limits are per-endpoint."""
    if limit <= 0:
        return True
    now = time.time()
    window = 60  # 1-minute window
    hits = _rate_store.get(key, [])
    hits = [t for t in hits if now - t < window]  # prune expired
    if len(hits) >= limit:
        _rate_store[key] = hits
        return False
    hits.append(now)
    # Clean up empty buckets to prevent unbounded memory growth
    if hits:
        _rate_store[key] = hits
    else:
        _rate_store.pop(key, None)
    return True


class APIHandler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = _config["cors_origin"]
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        """Parse JSON request body, enforcing size limit."""
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY_BYTES:
            raise ValueError(f"Request body too large ({length:,} bytes; max {MAX_BODY_BYTES:,})")
        return json.loads(self.rfile.read(length)) if length else {}

    def _auth_ok(self) -> bool:
        """Timing-safe API key check. Logs failed attempts."""
        key = _config["api_key"]
        if not key:
            return True  # no auth configured (local dev)
        header = self.headers.get("Authorization", "")
        token = header.replace("Bearer ", "").strip()
        if not token:
            self._json(401, {"error": "Unauthorized — missing API key"})
            return False
        # hmac.compare_digest prevents timing-oracle attacks
        if not hmac.compare_digest(token.encode(), key.encode()):
            ip = self.client_address[0]
            print(f"  [AUTH] Failed attempt from {ip}")
            self._json(401, {"error": "Unauthorized — invalid API key"})
            return False
        return True

    def _rate_ok(self, path: str) -> bool:
        """Per-IP, per-endpoint rate check."""
        ip = self.client_address[0]
        key = f"{ip}:{path}"
        if not _rate_check(key, _config["rate_limit"]):
            self._json(429, {"error": "Rate limited — too many requests"})
            return False
        return True

    def _start_stream(self):
        """Begin a chunked streaming response."""
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

    def _send_line(self, data: dict):
        """Send one JSON line in chunked encoding."""
        line = json.dumps(data) + "\n"
        chunk = f"{len(line):X}\r\n{line}\r\n"
        self.wfile.write(chunk.encode())
        self.wfile.flush()

    def _end_stream(self):
        self.wfile.write(b"0\r\n\r\n")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/api/status":
            self._json(200, {
                "status": "ready",
                "auth": bool(_config["api_key"]),
                "https": hasattr(self.connection, "getpeercert"),
            })
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth_ok():
            return
        path = urlparse(self.path).path
        if not self._rate_ok(path):
            return

        try:
            body = self._body()
        except (ValueError, json.JSONDecodeError) as e:
            self._json(400, {"error": f"Bad request: {e}"})
            return

        host = body.get("host", "")
        port = body.get("port", 3014)
        username = body.get("username", "")
        password = body.get("password", "")

        # Validate host/user/pass for endpoints that require them
        if path in ("/api/discover", "/api/pull", "/api/push-console", "/api/erase-console"):
            if not host or not username or not password:
                self._json(400, {"error": "Missing host, username, or password"})
                return
            try:
                host = sanitize_host(host)
            except ValueError as e:
                self._json(400, {"error": str(e)})
                return

        if path == "/api/discover":
            result = discover_devices(host, port, username, password)
            self._json(200 if "devices" in result else 500, result)

        elif path == "/api/pull":
            self._handle_pull(body, host, port, username, password)

        elif path == "/api/pull-direct":
            self._handle_pull_direct(body)

        elif path == "/api/push-direct":
            self._handle_push_direct(body)

        elif path == "/api/push-console":
            self._handle_push_console(body, host, port, username, password)

        elif path == "/api/erase-direct":
            self._handle_erase_direct(body)

        elif path == "/api/erase-console":
            self._handle_erase_console(body, host, port, username, password)

        else:
            self._json(404, {"error": "not found"})

    # ── Pull configs via console server ──
    def _handle_pull(self, body, host, port, username, password):
        devices = body.get("devices")
        if not isinstance(devices, dict) or not devices:
            self._json(400, {"error": "No devices selected or invalid format"})
            return
        enable_pass = body.get("enablePass", "")

        self._start_stream()
        self._send_line({"type": "status", "message": "Connecting to console server..."})

        try:
            client, channel, menu = ssh_connect(host, port, username, password)
        except Exception as e:
            self._send_line({"type": "error", "message": str(e)})
            self._send_line({"type": "done", "pulled": 0, "total": len(devices)})
            self._end_stream()
            return

        if "> " not in menu:
            client.close()
            self._send_line({"type": "error", "message": "No menu prompt received"})
            self._send_line({"type": "done", "pulled": 0, "total": len(devices)})
            self._end_stream()
            return

        self._send_line({"type": "status", "message": "Connected — pulling configs..."})
        pulled = 0

        for num, name in devices.items():
            self._send_line({"type": "pulling", "device": name, "num": num})
            try:
                config = pull_single_device(channel, num, name, enable_pass)
                if config:
                    host_match = re.search(r'^hostname\s+(\S+)', config, re.MULTILINE)
                    device_name = host_match.group(1) if host_match else name
                    self._send_line({"type": "device", "name": device_name, "menu_name": name, "num": num, "config": config, "size": len(config)})
                    pulled += 1
                else:
                    self._send_line({"type": "device_error", "name": name, "num": num, "message": "No config received"})
            except Exception as e:
                self._send_line({"type": "device_error", "name": name, "num": num, "message": str(e)})
                try:
                    escape_to_menu(channel)
                except Exception:
                    pass

        try:
            channel.send("x\n")
        except Exception:
            pass
        client.close()

        self._send_line({"type": "done", "pulled": pulled, "total": len(devices)})
        self._end_stream()

    # ── Pull configs via direct SSH ──
    def _handle_pull_direct(self, body):
        import paramiko
        from .ssh_utils import sanitize_host as _san

        devices = body.get("devices")
        if not isinstance(devices, list) or not devices:
            self._json(400, {"error": "No devices provided or invalid format"})
            return

        self._start_stream()
        self._send_line({"type": "status", "message": f"Pulling {len(devices)} device(s) via direct SSH..."})
        pulled = 0

        for d in devices:
            d_host_raw = d.get("host", "")
            d_port = d.get("port", 22)
            d_user = d.get("username", "")
            d_pass = d.get("password", "")
            d_enable = d.get("enablePass", "")

            try:
                d_host = _san(d_host_raw)
            except ValueError as e:
                self._send_line({"type": "device_error", "name": d_host_raw, "message": str(e)})
                continue

            if not d_host or not d_user or not d_pass:
                self._send_line({"type": "device_error", "name": d_host, "message": "Missing credentials"})
                continue

            self._send_line({"type": "pulling", "device": d_host})
            try:
                client = paramiko.SSHClient()
                client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                client.connect(hostname=d_host, port=int(d_port), username=d_user, password=d_pass,
                               timeout=15, look_for_keys=False, allow_agent=False)
                channel = client.invoke_shell(width=200, height=50)
                import time as _t; _t.sleep(1)

                buf = wait_for(channel, [">", "#"], timeout=10)
                last_line = buf.strip().split("\n")[-1] if buf.strip() else ""
                if ">" in last_line and "#" not in last_line:
                    channel.send("enable\r")
                    en_out = wait_for(channel, ["#", "Password"], timeout=5)
                    if "Password" in en_out or "password" in en_out:
                        channel.send(f"{d_enable}\r")
                        wait_for(channel, "#", timeout=5)

                channel.send("terminal length 0\r")
                wait_for(channel, "#", timeout=3)
                channel.send("show running-config\r")
                _t.sleep(1)

                config_buf = ""
                start = _t.time()
                while _t.time() - start < 20:
                    if channel.recv_ready():
                        chunk = channel.recv(65535).decode("utf-8", errors="replace")
                        config_buf += chunk
                        if "end" in config_buf and "#" in config_buf.split("end")[-1]:
                            break
                    _t.sleep(0.2)

                channel.send("exit\r")
                client.close()

                host_match = re.search(r'^hostname\s+(\S+)', config_buf, re.MULTILINE)
                device_name = host_match.group(1) if host_match else d_host
                self._send_line({"type": "device", "name": device_name, "config": config_buf, "size": len(config_buf)})
                pulled += 1
            except Exception as e:
                self._send_line({"type": "device_error", "name": d_host, "message": str(e)})

        self._send_line({"type": "done", "pulled": pulled, "total": len(devices)})
        self._end_stream()

    # ── Push configs via direct SSH ──
    def _handle_push_direct(self, body):
        mappings = body.get("mappings")
        if not isinstance(mappings, list) or not mappings:
            self._json(400, {"error": "No device mappings provided or invalid format"})
            return

        self._start_stream()
        self._send_line({"type": "status", "message": f"Pushing configs to {len(mappings)} device(s)..."})
        pushed = 0

        for m in mappings:
            d_host_raw = m.get("host", "")
            d_port = m.get("port", 22)
            d_user = m.get("username", "")
            d_pass = m.get("password", "")
            d_enable = m.get("enablePass", "")
            d_config = m.get("config", "")
            d_name = m.get("name", d_host_raw)

            try:
                d_host = sanitize_host(d_host_raw)
            except ValueError as e:
                self._send_line({"type": "device_error", "name": d_name, "message": str(e)})
                continue

            if not d_host or not d_config:
                self._send_line({"type": "device_error", "name": d_name, "message": "Missing host or config"})
                continue

            self._send_line({"type": "pulling", "device": d_name})
            try:
                result = push_config_direct(d_host, d_port, d_user, d_pass, d_config, d_enable)
                if result:
                    errs = result.get("errors", [])
                    self._send_line({"type": "device", "name": result["name"], "config": f"Pushed {result['pushed']} lines", "pushed": result["pushed"], "errors": errs})
                    pushed += 1
                else:
                    self._send_line({"type": "device_error", "name": d_name, "message": "Push failed"})
            except Exception as e:
                self._send_line({"type": "device_error", "name": d_name, "message": str(e)})

        self._send_line({"type": "done", "pulled": pushed, "total": len(mappings)})
        self._end_stream()

    # ── Push configs via console server ──
    def _handle_push_console(self, body, host, port, username, password):
        mappings = body.get("mappings")
        if not isinstance(mappings, list) or not mappings:
            self._json(400, {"error": "No device mappings provided or invalid format"})
            return
        enable_pass = body.get("enablePass", "")

        self._start_stream()
        self._send_line({"type": "status", "message": "Connecting to console server..."})

        try:
            client, channel, menu = ssh_connect(host, port, username, password)
        except Exception as e:
            self._send_line({"type": "error", "message": str(e)})
            self._send_line({"type": "done", "pulled": 0, "total": len(mappings)})
            self._end_stream()
            return

        if "> " not in menu:
            client.close()
            self._send_line({"type": "error", "message": "No menu prompt received"})
            self._send_line({"type": "done", "pulled": 0, "total": len(mappings)})
            self._end_stream()
            return

        self._send_line({"type": "status", "message": "Connected — pushing configs..."})
        pushed = 0

        for m in mappings:
            d_num = m.get("num", "")
            d_name = m.get("name", d_num)
            d_config = m.get("config", "")

            if not d_num or not d_config:
                self._send_line({"type": "device_error", "name": d_name, "message": "Missing menu number or config"})
                continue

            self._send_line({"type": "pulling", "device": d_name, "num": d_num})
            try:
                result = push_via_console(channel, d_num, d_name, d_config, enable_pass)
                if result:
                    errs = result.get("errors", [])
                    self._send_line({"type": "device", "name": result["name"], "config": f"Pushed {result['pushed']} lines", "pushed": result["pushed"], "errors": errs})
                    pushed += 1
                else:
                    self._send_line({"type": "device_error", "name": d_name, "message": "Push failed"})
            except Exception as e:
                self._send_line({"type": "device_error", "name": d_name, "message": str(e)})
                try:
                    escape_to_menu(channel)
                except Exception:
                    pass

        try:
            channel.send("x\n")
        except Exception:
            pass
        client.close()

        self._send_line({"type": "done", "pulled": pushed, "total": len(mappings)})
        self._end_stream()

    # ── Erase & reload via direct SSH ──
    def _handle_erase_direct(self, body):
        devices = body.get("devices")
        if not isinstance(devices, list) or not devices:
            self._json(400, {"error": "No devices provided or invalid format"})
            return

        self._start_stream()
        self._send_line({"type": "status", "message": f"Erasing {len(devices)} device(s)..."})
        erased = 0

        for d in devices:
            d_host_raw = d.get("host", "")
            d_port = d.get("port", 22)
            d_user = d.get("username", "")
            d_pass = d.get("password", "")
            d_enable = d.get("enablePass", "")

            try:
                d_host = sanitize_host(d_host_raw)
            except ValueError as e:
                self._send_line({"type": "device_error", "name": d_host_raw, "message": str(e)})
                continue

            if not d_host or not d_user or not d_pass:
                self._send_line({"type": "device_error", "name": d_host, "message": "Missing credentials"})
                continue

            self._send_line({"type": "pulling", "device": d_host})
            try:
                result = erase_reload_direct(d_host, d_port, d_user, d_pass, d_enable)
                if result:
                    self._send_line({"type": "device", "name": result["name"], "config": "Erased & reloading"})
                    erased += 1
                else:
                    self._send_line({"type": "device_error", "name": d_host, "message": "Erase failed"})
            except Exception as e:
                self._send_line({"type": "device_error", "name": d_host, "message": str(e)})

        self._send_line({"type": "done", "pulled": erased, "total": len(devices)})
        self._end_stream()

    # ── Erase & reload via console server ──
    def _handle_erase_console(self, body, host, port, username, password):
        devices = body.get("devices")
        if not isinstance(devices, dict) or not devices:
            self._json(400, {"error": "No devices selected or invalid format"})
            return
        enable_pass = body.get("enablePass", "")

        self._start_stream()
        self._send_line({"type": "status", "message": "Connecting to console server..."})

        try:
            client, channel, menu = ssh_connect(host, port, username, password)
        except Exception as e:
            self._send_line({"type": "error", "message": str(e)})
            self._send_line({"type": "done", "pulled": 0, "total": len(devices)})
            self._end_stream()
            return

        if "> " not in menu:
            client.close()
            self._send_line({"type": "error", "message": "No menu prompt received"})
            self._send_line({"type": "done", "pulled": 0, "total": len(devices)})
            self._end_stream()
            return

        self._send_line({"type": "status", "message": "Connected — erasing devices..."})
        erased = 0

        for num, name in devices.items():
            self._send_line({"type": "pulling", "device": name, "num": num})
            try:
                result = erase_reload_via_console(channel, num, name, enable_pass)
                if result:
                    self._send_line({"type": "device", "name": result["name"], "config": "Erased & reloading"})
                    erased += 1
                else:
                    self._send_line({"type": "device_error", "name": name, "num": num, "message": "Erase failed"})
            except Exception as e:
                self._send_line({"type": "device_error", "name": name, "num": num, "message": str(e)})
                try:
                    escape_to_menu(channel)
                except Exception:
                    pass

        try:
            channel.send("x\n")
        except Exception:
            pass
        client.close()

        self._send_line({"type": "done", "pulled": erased, "total": len(devices)})
        self._end_stream()

    def log_message(self, _format, *_args):
        # Suppress default access log noise; errors are printed inline
        pass


def start_server(port=3001, api_key=None, cors_origin="*",
                 certfile=None, keyfile=None, rate_limit=10):
    _config["api_key"] = api_key
    _config["cors_origin"] = cors_origin
    _config["rate_limit"] = rate_limit

    server = HTTPServer(("0.0.0.0", port), APIHandler)

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
    print(f"  Rate limit: {rate_limit}/min per IP per endpoint")
    print(f"  Endpoints:  GET /api/status  POST /api/discover  /api/pull  /api/pull-direct")
    print(f"              POST /api/push-direct  /api/push-console")
    print(f"              POST /api/erase-direct  /api/erase-console")
    print(f"{'='*60}\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
        server.server_close()
