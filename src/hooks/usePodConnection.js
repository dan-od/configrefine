import { useState, useRef, useCallback, useEffect } from "react";

const EMPTY_CONN = { host: "", port: "", username: "", password: "", enablePass: "" };

// Backend base URL — same-origin in production, local API server in dev.
export const API_BASE = typeof window !== "undefined" && window.location.hostname !== "localhost"
  ? "" : "http://localhost:3001";

const countLabel = n => `${n} device${n !== 1 ? "s" : ""}`;

/**
 * Shared lab connection state for the Pull / Push / Erase tabs.
 *
 * Owns the connection form (mode, host, port, credentials, API key), the
 * direct-SSH host list and the console-server pod "session": the devices
 * found by /api/discover plus the credentials discovery succeeded with.
 * Discovery runs only when discover() is called (Connect or Rediscover),
 * never on tab switches, and every tab reads the same device list.
 *
 * Everything lives in React state only — nothing is written to
 * localStorage or any other persistent store. Credentials are dropped by
 * disconnect(), or by releaseIfIdle() when the SSH panel closes while no pod
 * is connected (same as the old per-panel behaviour).
 *
 * The backend is stateless: each pull/push/erase still opens its own SSH
 * session to the console server with the session credentials.
 */
export function usePodConnection() {
  const [mode, setMode] = useState("direct");          // "direct" | "console"
  const [conn, setConn] = useState(EMPTY_CONN);
  const [apiKey, setApiKey] = useState("");
  const [directHosts, setDirectHosts] = useState([""]);
  // { host, port, username, password, pod, devices } once discovery succeeds
  const [session, setSession] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState(null); // { status: "info"|"done"|"error", text }

  const ctrlRef = useRef(null);
  const sessionRef = useRef(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // Abort an in-flight discovery if the app unmounts
  useEffect(() => () => ctrlRef.current?.abort(), []);

  /**
   * Read the console-server menu. With no argument it uses the connection
   * form; Rediscover passes the current session so the same pod is re-read.
   */
  const discover = useCallback(async (creds) => {
    const c = creds ?? conn;
    if (!c.host || !c.username || !c.password) {
      setDiscoverMsg({ status: "error", text: "Enter host, username & password" });
      return;
    }
    const rediscover = !!creds;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 30000);

    setDiscovering(true);
    setDiscoverMsg({ status: "info", text: "Connecting & reading device menu..." });
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`${API_BASE}/api/discover`, {
        method: "POST", headers, signal: ctrl.signal,
        body: JSON.stringify({ host: c.host, port: parseInt(c.port || "22"), username: c.username, password: c.password }),
      });
      if (res.status === 401) throw new Error("Invalid API key");
      if (res.status === 429) throw new Error("Rate limited");
      const data = await res.json();
      if (data.error || !data.devices) throw new Error(data.error || "No device menu received");
      if (ctrlRef.current !== ctrl) return; // superseded or disconnected
      const n = Object.keys(data.devices).length;
      setSession({
        host: c.host, port: c.port, username: c.username, password: c.password,
        pod: data.pod || "", devices: data.devices,
      });
      setDiscoverMsg({ status: "done", text: `Found ${countLabel(n)}` });
    } catch (e) {
      if (ctrlRef.current !== ctrl) return; // aborted by disconnect / newer discover
      const text = e.name === "AbortError" ? "Discovery timed out (30s)"
        : e instanceof TypeError ? "Cannot reach backend"
        : e.message;
      setDiscoverMsg({
        status: "error",
        text: rediscover && sessionRef.current ? `Rediscover failed: ${text} — showing previous device list` : text,
      });
    } finally {
      clearTimeout(timer);
      if (ctrlRef.current === ctrl) { ctrlRef.current = null; setDiscovering(false); }
    }
  }, [conn, apiKey]);

  const rediscover = useCallback(() => {
    if (sessionRef.current) discover(sessionRef.current);
  }, [discover]);

  // Drop the pod session and every credential held in memory.
  const disconnect = useCallback(() => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setDiscovering(false);
    setSession(null);
    setConn(EMPTY_CONN);
    setApiKey("");
    setDiscoverMsg(null);
  }, []);

  // Called when the SSH panel closes: keep credentials only while a pod is connected.
  const releaseIfIdle = useCallback(() => {
    if (sessionRef.current || ctrlRef.current) return;
    setConn(EMPTY_CONN);
    setApiKey("");
    setDiscoverMsg(null);
  }, []);

  // Credentials for console-server operations on the connected pod.
  const consoleCreds = () => session && ({
    host: session.host, port: parseInt(session.port || "22"),
    username: session.username, password: session.password,
    enablePass: conn.enablePass,
  });

  return {
    apiBase: API_BASE,
    mode, setMode,
    conn, setConn,
    apiKey, setApiKey,
    directHosts, setDirectHosts,
    session,
    devices: session?.devices ?? null,
    connected: !!session,
    discovering, discoverMsg,
    discover, rediscover, disconnect, releaseIfIdle, consoleCreds,
  };
}
