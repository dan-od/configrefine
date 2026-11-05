import { useState, useRef, useCallback, useEffect } from "react";

const EMPTY_CONN = { host: "", port: "", username: "", password: "", enablePass: "" };

export const API_BASE = typeof window !== "undefined" && window.location.hostname !== "localhost"
  ? "" : "http://localhost:3001";

const countLabel = n => `${n} device${n !== 1 ? "s" : ""}`;

export function usePodConnection(persistence) {
  const [mode, setMode] = useState("direct");
  const [conn, setConn] = useState(EMPTY_CONN);
  const [apiKey, setApiKey] = useState("");
  const [directHosts, setDirectHosts] = useState([""]);
  const [session, setSession] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [restored, setRestored] = useState(false);

  const [activeOps, setActiveOps] = useState({});
  const busy = Object.values(activeOps).some(Boolean);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const setOpBusy = useCallback((op, on) =>
    setActiveOps(p => (!!p[op] === on ? p : { ...p, [op]: on })), []);

  const ctrlRef = useRef(null);
  const sessionRef = useRef(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  // Save connection params whenever session changes
  useEffect(() => {
    if (!persistence) return;
    if (session) {
      persistence.saveConnection({
        mode: "console",
        host: session.host,
        port: session.port,
        podId: session.pod,
        podName: session.pod ? `POD ${session.pod}` : "POD",
        username: session.username,
      });
    }
  }, [session, persistence]);

  // Auto-reconnect from sessionStorage on mount
  useEffect(() => {
    if (!persistence) return;
    const saved = persistence.loadConnection();
    if (!saved || saved.mode !== "console" || !saved.host || !saved.username) return;
    setConn(prev => ({ ...prev, host: saved.host, port: saved.port || "", username: saved.username }));
    setMode("console");
    setRestored(true);
  }, [persistence]);

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
      if (ctrlRef.current !== ctrl) return;
      const n = Object.keys(data.devices).length;
      setSession({
        host: c.host, port: c.port, username: c.username, password: c.password,
        pod: data.pod || "", devices: data.devices,
      });
      setDiscoverMsg({ status: "done", text: `Found ${countLabel(n)}` });
      setReconnecting(false);
    } catch (e) {
      if (ctrlRef.current !== ctrl) return;
      const text = e.name === "AbortError" ? "Discovery timed out (30s)"
        : e instanceof TypeError ? "Cannot reach backend"
        : e.message;
      setDiscoverMsg({
        status: "error",
        text: rediscover && sessionRef.current ? `Rediscover failed: ${text} — showing previous device list` : text,
      });
      setReconnecting(false);
    } finally {
      clearTimeout(timer);
      if (ctrlRef.current === ctrl) { ctrlRef.current = null; setDiscovering(false); }
    }
  }, [conn, apiKey]);

  const rediscover = useCallback(() => {
    if (busyRef.current) return;
    if (sessionRef.current) discover(sessionRef.current);
  }, [discover]);

  const disconnect = useCallback(() => {
    if (busyRef.current) return;
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setDiscovering(false);
    setSession(null);
    setConn(EMPTY_CONN);
    setApiKey("");
    setDiscoverMsg(null);
    setReconnecting(false);
    persistence?.clearConnection();
  }, [persistence]);

  const releaseIfIdle = useCallback(() => {
    if (sessionRef.current || ctrlRef.current) return;
    setConn(EMPTY_CONN);
    setApiKey("");
    setDiscoverMsg(null);
  }, []);

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
    busy, setOpBusy,
    reconnecting, restored,
    discover, rediscover, disconnect, releaseIfIdle, consoleCreds,
  };
}

export function useReportBusy(pod, op, busy) {
  const { setOpBusy } = pod;
  useEffect(() => { setOpBusy(op, busy); }, [setOpBusy, op, busy]);
  useEffect(() => () => setOpBusy(op, false), [setOpBusy, op]);
}
