import { useState, useEffect } from "react";
import { Wifi, Loader, Check, Upload, X, ArrowRight } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn, Btn, canHover } from "./Shared";
import { useStream } from "../hooks/useStream";

/**
 * Push cleaned configs onto devices — supports direct SSH and console-server modes.
 * Shared props: conn, apiKey, needsAuth, apiOnline, mode, files, apiBase, inpStyle
 */
export function PushPanel({ conn, apiKey, apiOnline, mode, files: loadedFiles, apiBase, inpStyle }) {
  const { C } = useTheme();
  const [devices, setDevices] = useState(null); // for console mode device list
  const [pushMappings, setPushMappings] = useState([]);
  const [discoverStatus, setDiscoverStatus] = useState("idle");

  const { status, message, results, pulling, busy, readStream, reset, initResults, setStatus, setMessage } =
    useStream("push");

  const [rowHov, setRowHov] = useState(null); // hovered mapping fileId

  // Rebuild mappings when files change
  useEffect(() => {
    const active = (loadedFiles ?? []).filter(f => f.clean || f.raw);
    setPushMappings(active.map(f => ({
      fileId: f.id, name: f.name, config: f.clean || f.raw, target: "", enabled: true,
    })));
  }, [loadedFiles]);

  const authHeaders = () => {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  };

  const withTimeout = (ms) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return { signal: ctrl.signal, clearTimeout: () => clearTimeout(id) };
  };

  // Discover console devices (needed for console push target selector)
  const discover = async () => {
    if (!conn.host || !conn.username || !conn.password) {
      setMessage("Enter console server credentials"); return;
    }
    setDiscoverStatus("discovering");
    setMessage("Discovering devices...");
    const { signal, clearTimeout: clear } = withTimeout(30000);
    try {
      const res = await fetch(`${apiBase}/api/discover`, {
        method: "POST", headers: authHeaders(), signal,
        body: JSON.stringify({ host: conn.host, port: parseInt(conn.port || "22"), username: conn.username, password: conn.password }),
      });
      clear();
      if (res.status === 401) { setStatus("error"); setMessage("Invalid API key"); return; }
      const data = await res.json();
      if (data.error) { setStatus("error"); setMessage(data.error); }
      else { setDevices(data.devices); setMessage(`Found ${Object.keys(data.devices).length} device${Object.keys(data.devices).length !== 1 ? "s" : ""}`); }
    } catch (e) {
      clear();
      setStatus("error");
      setMessage(e.name === "AbortError" ? "Discovery timed out" : "Cannot reach backend");
    } finally {
      setDiscoverStatus("idle");
    }
  };

  // ── Push direct SSH ──
  const pushDirect = async () => {
    const active = pushMappings.filter(m => m.enabled && m.target.trim());
    if (!active.length) { setMessage("Map at least one config to a device IP"); return; }
    if (!conn.username || !conn.password) { setMessage("Enter credentials"); return; }
    const mappings = active.map(m => ({
      host: m.target.trim(), port: parseInt(conn.port || "22"),
      username: conn.username, password: conn.password, enablePass: conn.enablePass,
      config: m.config, name: m.name,
    }));
    initResults(active.length);
    setMessage("Pushing configs...");
    const { signal, clearTimeout: clear } = withTimeout(300000);
    try {
      const res = await fetch(`${apiBase}/api/push-direct`, {
        method: "POST", headers: authHeaders(), signal,
        body: JSON.stringify({ mappings }),
      });
      clear();
      if (res.status === 401 || res.status === 429) {
        setStatus("error"); setMessage(res.status === 401 ? "Invalid API key" : "Rate limited"); return;
      }
      await readStream(res);
    } catch (e) {
      clear();
      setStatus("error");
      setMessage(e.name === "AbortError" ? "Push timed out" : "Connection lost");
    }
  };

  // ── Push via console server ──
  const pushConsole = async () => {
    const active = pushMappings.filter(m => m.enabled && m.target);
    if (!active.length) { setMessage("Map at least one config to a device"); return; }
    if (!conn.host || !conn.username || !conn.password) { setMessage("Enter console server credentials"); return; }
    const mappings = active.map(m => ({ num: m.target, name: m.name, config: m.config }));
    initResults(active.length);
    setMessage("Connecting to console server...");
    const { signal, clearTimeout: clear } = withTimeout(300000);
    try {
      const res = await fetch(`${apiBase}/api/push-console`, {
        method: "POST", headers: authHeaders(), signal,
        body: JSON.stringify({ host: conn.host, port: parseInt(conn.port || "22"), username: conn.username, password: conn.password, enablePass: conn.enablePass, mappings }),
      });
      clear();
      if (res.status === 401 || res.status === 429) {
        setStatus("error"); setMessage(res.status === 401 ? "Invalid API key" : "Rate limited"); return;
      }
      await readStream(res);
    } catch (e) {
      clear();
      setStatus("error");
      setMessage(e.name === "AbortError" ? "Push timed out" : "Connection lost");
    }
  };

  if (!loadedFiles || loadedFiles.filter(f => f.clean || f.raw).length === 0) {
    return (
      <div style={{ padding: "24px 16px", textAlign: "center" }}>
        <Upload style={{ width: 24, height: 24, color: C.muted + "44", margin: "0 auto 8px" }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>No configs loaded</div>
        <div style={{ fontSize: 9.5, color: C.muted + "88", marginTop: 4 }}>Upload, paste, or pull configs first, then come back to push them onto devices.</div>
      </div>
    );
  }

  const readyCount = pushMappings.filter(m => m.enabled && m.target.trim()).length;
  const discovering = discoverStatus === "discovering";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
          Map configs → {mode === "direct" ? "device IPs" : "menu numbers"}
        </div>

        {/* Console mode: need to discover first for the dropdown */}
        {mode === "console" && !devices && (
          <Btn icon={discovering ? Loader : Wifi} onClick={discover} style={{ justifyContent: "center", padding: "8px 0", fontSize: 9, marginBottom: 4 }}>
            {discovering ? "Discovering..." : "Discover devices first"}
          </Btn>
        )}

        {pushMappings.map((m, i) => {
          const hov = rowHov === m.fileId && m.enabled;
          return (<div key={m.fileId}
            onMouseEnter={() => canHover && setRowHov(m.fileId)}
            onMouseLeave={() => setRowHov(null)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
              border: `1px solid ${m.enabled ? (hov ? C.borderActive : C.border) : "transparent"}`,
              background: m.enabled ? (hov ? C.surface : C.raised) : "transparent",
              opacity: m.enabled ? 1 : 0.4, transition: "background .12s, border-color .12s",
            }}>
            <button onClick={() => setPushMappings(p => p.map((x, j) => j === i ? { ...x, enabled: !x.enabled } : x))}
              title={m.enabled ? "Disable" : "Enable"}
              style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", background: m.enabled ? C.accent : C.muted + "33", border: "none", cursor: "pointer", flexShrink: 0 }}>
              {m.enabled && <Check style={{ width: 9, height: 9, color: "#0a0e1a" }} />}
            </button>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.textBright, minWidth: 60, fontFamily: mono }}>{m.name}</span>
            <ArrowRight style={{ width: 12, height: 12, color: C.muted, flexShrink: 0 }} />
            {mode === "direct" ? (
              <input placeholder="IP address" style={{ ...inpStyle, flex: 1, padding: "4px 8px", fontSize: 10 }}
                value={m.target} onChange={e => setPushMappings(p => p.map((x, j) => j === i ? { ...x, target: e.target.value } : x))} />
            ) : (
              <select style={{ ...inpStyle, flex: 1, padding: "4px 8px", fontSize: 10, cursor: "pointer" }}
                value={m.target} onChange={e => setPushMappings(p => p.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}>
                <option value="">Select device...</option>
                {devices && Object.entries(devices).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([num, name]) => (
                  <option key={num} value={num}>[{num}] {name}</option>
                ))}
              </select>
            )}
          </div>
        ); })}
      </div>

      <Btn icon={busy ? Loader : Upload} onClick={mode === "direct" ? pushDirect : pushConsole} primary
        disabled={!apiOnline || busy || !readyCount || (mode === "console" && !devices)}
        style={{ justifyContent: "center", padding: "10px 0" }}>
        {busy ? "Pushing..." : `Push ${readyCount} Config${readyCount !== 1 ? "s" : ""}`}
      </Btn>

      {/* Status bar */}
      {message && (
        <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, background: status === "error" ? "rgba(248,113,113,0.06)" : status === "done" ? C.greenDim : C.accentDim, border: `1px solid ${status === "error" ? "rgba(248,113,113,0.15)" : status === "done" ? "rgba(52,211,153,0.15)" : C.borderActive}`, color: status === "error" ? C.red : status === "done" ? C.green : C.accent }}>
          {message}
        </div>
      )}

      {/* Push results */}
      {results && (Object.keys(results.configs).length > 0 || pulling || results.errors.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
            Pushed {results.pulled}/{results.total}
          </span>
          {pulling && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: `1px solid ${C.borderActive}`, background: C.accentDim }}>
              <Loader style={{ width: 12, height: 12, color: C.accent, animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent }}>{pulling}</span>
            </div>
          )}
          {Object.entries(results.configs).map(([name, info]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", border: `1px solid ${C.border}`, background: C.raised }}>
              <Check style={{ width: 12, height: 12, color: C.green }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.textBright }}>{name}</span>
              <span style={{ fontSize: 9, color: C.muted, marginLeft: "auto", fontFamily: mono }}>{info}</span>
            </div>
          ))}
          {results.errors.map(name => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", border: "1px solid rgba(248,113,113,0.15)", background: "rgba(248,113,113,0.04)" }}>
              <X style={{ width: 12, height: 12, color: C.red }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>{name}</span>
              <span style={{ fontSize: 9, color: C.muted, marginLeft: "auto" }}>failed</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
