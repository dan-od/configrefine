import { useState, useEffect } from "react";
import { Wifi, Loader, Check, X, AlertCircle, Play, RotateCcw, Download } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn, Btn } from "./Shared";

export function LabPanel({ onClose, onConfigsPulled, vp }) {
  const { C } = useTheme();
  const [conn, setConn] = useState({ host: "", port: "", username: "", password: "", enablePass: "" });
  const [apiKey, setApiKey] = useState("");
  const [devices, setDevices] = useState(null);
  const [pod, setPod] = useState("");
  const [selected, setSelected] = useState([]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState(null);
  const [pulling, setPulling] = useState(null);
  const [apiOnline, setApiOnline] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const apiBase = typeof window !== "undefined" && window.location.hostname !== "localhost" ? "" : "http://localhost:3001";

  useEffect(() => {
    fetch(`${apiBase}/api/status`).then(r => r.json())
      .then(d => { setApiOnline(true); setNeedsAuth(d.auth === true); })
      .catch(() => setApiOnline(false));
  }, []);

  const authHeaders = () => {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  };

  const toggleDevice = n => setSelected(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);

  const discover = async () => {
    if (!conn.host || !conn.username || !conn.password) { setMessage("Enter host, username & password"); return; }
    if (needsAuth && !apiKey) { setMessage("API key required"); return; }
    setStatus("discovering"); setMessage("Connecting & reading device menu..."); setDevices(null); setResults(null);
    try {
      const res = await fetch(`${apiBase}/api/discover`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ host: conn.host, port: parseInt(conn.port || "22"), username: conn.username, password: conn.password }) });
      if (res.status === 401) { setStatus("error"); setMessage("Invalid API key"); return; }
      if (res.status === 429) { setStatus("error"); setMessage("Rate limited — try again in a minute"); return; }
      const data = await res.json();
      if (data.error) { setStatus("error"); setMessage(data.error); }
      else { setDevices(data.devices); setPod(data.pod || ""); setSelected(Object.keys(data.devices)); setStatus("idle"); setMessage(`Found ${Object.keys(data.devices).length} devices` + (data.pod ? ` on POD ${data.pod}` : "")); }
    } catch { setStatus("error"); setMessage("Cannot reach backend. Is pull_configs.py --serve running?"); }
  };

  const pull = async () => {
    if (selected.length === 0) { setMessage("Select at least one device"); return; }
    if (needsAuth && !apiKey) { setMessage("API key required"); return; }
    const devMap = {}; selected.forEach(k => { if (devices[k]) devMap[k] = devices[k]; });
    setStatus("pulling"); setMessage("Connecting..."); setResults({ configs: {}, pulled: 0, total: selected.length, errors: [] }); setPulling(null);
    try {
      const res = await fetch(`${apiBase}/api/pull`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ host: conn.host, port: parseInt(conn.port || "22"), username: conn.username, password: conn.password, enablePass: conn.enablePass, devices: devMap }) });
      if (res.status === 401) { setStatus("error"); setMessage("Invalid API key"); return; }
      if (res.status === 429) { setStatus("error"); setMessage("Rate limited"); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "status") setMessage(msg.message);
            else if (msg.type === "pulling") { setPulling(msg.device); setMessage(`Pulling ${msg.device}...`); }
            else if (msg.type === "device") { setPulling(null); setResults(prev => ({ ...prev, configs: { ...prev.configs, [msg.name]: msg.config }, pulled: prev.pulled + 1 })); setMessage(`Pulled ${msg.name} (${(msg.size / 1024).toFixed(1)}kb)`); }
            else if (msg.type === "device_error") { setPulling(null); setResults(prev => ({ ...prev, errors: [...prev.errors, msg.name] })); setMessage(`Failed: ${msg.name}`); }
            else if (msg.type === "error") { setStatus("error"); setMessage(msg.message); }
            else if (msg.type === "done") { setPulling(null); setStatus("done"); setMessage(`Done — ${msg.pulled}/${msg.total} pulled`); }
          } catch {}
        }
      }
    } catch { setStatus("error"); setMessage("Connection to backend lost"); }
  };

  const downloadFile = (name, content) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    a.download = `${name}.txt`; a.click();
  };
  const downloadAll = () => {
    if (!results?.configs) return;
    Object.entries(results.configs).forEach(([name, config]) => setTimeout(() => downloadFile(name, config), 100));
  };

  const busy = status === "discovering" || status === "pulling";
  const inp = { width: "100%", padding: "7px 10px", border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 11, outline: "none", fontFamily: "inherit", borderRadius: 0 };

  return (
    <div style={{ width: vp.phone ? "100%" : 320, minWidth: vp.phone ? 0 : 320, display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.border}`, background: C.bg, overflowY: "auto", ...(vp.phone && { position: "fixed", inset: 0, zIndex: 100 }) }}>
      <div style={{ padding: "16px 14px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted, textTransform: "uppercase", fontFamily: mono }}>Lab</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textBright, marginTop: 2 }}>Pull Configs</div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {apiOnline !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", background: apiOnline ? C.greenDim : "rgba(248,113,113,0.1)", border: `1px solid ${apiOnline ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}` }}>
              <div style={{ width: 5, height: 5, background: apiOnline ? C.green : C.red }} />
              <span style={{ fontSize: 8, fontWeight: 700, color: apiOnline ? C.green : C.red, fontFamily: mono }}>{apiOnline ? "API" : "OFF"}</span>
            </div>
          )}
          <IcoBtn icon={X} label="Close" onClick={onClose} />
        </div>
      </div>

      <div style={{ flex: 1, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {apiOnline === false && (
          <div style={{ padding: 12, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <AlertCircle style={{ width: 13, height: 13, color: C.red }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>Backend not running</span>
            </div>
            <code style={{ fontSize: 10, color: C.accent, fontFamily: mono, padding: "6px 10px", background: C.surface, border: `1px solid ${C.border}`, display: "block" }}>python pull_configs.py --serve</code>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>Connection</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 6 }}>
            <input placeholder="Host" style={inp} value={conn.host} onChange={e => setConn({ ...conn, host: e.target.value })} />
            <input placeholder="Port" style={inp} value={conn.port} onChange={e => setConn({ ...conn, port: e.target.value })} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <input placeholder="Username" style={inp} value={conn.username} onChange={e => setConn({ ...conn, username: e.target.value })} />
            <input placeholder="Password" type="password" style={inp} value={conn.password} onChange={e => setConn({ ...conn, password: e.target.value })} />
          </div>
          <input placeholder="Enable password (optional)" type="password" style={inp} value={conn.enablePass} onChange={e => setConn({ ...conn, enablePass: e.target.value })} />
          {needsAuth && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.accent + "88", textTransform: "uppercase", fontFamily: mono }}>API Key</div>
              <input placeholder="Required for remote access" type="password" style={{ ...inp, borderColor: apiKey ? C.borderActive : "rgba(248,113,113,0.3)" }} value={apiKey} onChange={e => setApiKey(e.target.value)} />
            </div>
          )}
        </div>

        {!devices && (
          <Btn icon={status === "discovering" ? Loader : Wifi} onClick={discover} primary disabled={!apiOnline || busy} style={{ justifyContent: "center", padding: "10px 0" }}>
            {status === "discovering" ? "Discovering..." : "Connect & Discover Devices"}
          </Btn>
        )}

        {devices && (<>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>Devices{pod ? ` · POD ${pod}` : ""}</span>
              <div style={{ display: "flex", gap: 6 }}>
                {["All", "None"].map(lbl => (
                  <button key={lbl} onClick={() => setSelected(lbl === "All" ? Object.keys(devices) : [])} style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", opacity: 0.7, fontFamily: mono }}>{lbl}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 3 }}>
              {Object.entries(devices).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([num, name]) => {
                const on = selected.includes(num);
                return (
                  <button key={num} onClick={() => toggleDevice(num)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: `1px solid ${on ? C.borderActive : "transparent"}`, background: on ? C.accentDim : "transparent", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", background: on ? C.accent : C.muted + "33" }}>
                      {on && <Check style={{ width: 10, height: 10, color: "#0a0e1a" }} />}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: on ? C.accent : C.text }}>[{num}]</span>
                    <span style={{ fontSize: 10, color: C.muted }}>{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Btn icon={status === "pulling" ? Loader : Play} onClick={pull} primary disabled={busy || selected.length === 0} style={{ justifyContent: "center", padding: "10px 0" }}>
            {status === "pulling" ? "Pulling..." : `Pull ${selected.length} Device${selected.length !== 1 ? "s" : ""}`}
          </Btn>
          <Btn icon={RotateCcw} onClick={() => { setDevices(null); setResults(null); setPulling(null); setMessage(""); setStatus("idle"); }} style={{ justifyContent: "center", fontSize: 9, padding: "6px 0" }}>Re-scan Devices</Btn>
        </>)}

        {message && (
          <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, background: status === "error" ? "rgba(248,113,113,0.06)" : status === "done" ? C.greenDim : C.accentDim, border: `1px solid ${status === "error" ? "rgba(248,113,113,0.15)" : status === "done" ? "rgba(52,211,153,0.15)" : C.borderActive}`, color: status === "error" ? C.red : status === "done" ? C.green : C.accent }}>{message}</div>
        )}

        {results && (Object.keys(results.configs).length > 0 || pulling || results.errors.length > 0) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>Configs {results.pulled}/{results.total}</span>
              {Object.keys(results.configs).length > 1 && (
                <button onClick={downloadAll} style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", opacity: 0.7, fontFamily: mono }}>Save All</button>
              )}
            </div>
            {pulling && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: `1px solid ${C.borderActive}`, background: C.accentDim }}>
                <Loader style={{ width: 12, height: 12, color: C.accent, animation: "spin 1s linear infinite" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: C.accent }}>{pulling}</span>
                <span style={{ fontSize: 9, color: C.muted, marginLeft: "auto", fontFamily: mono }}>pulling...</span>
              </div>
            )}
            {Object.entries(results.configs).map(([name, config]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 0, border: `1px solid ${C.border}`, background: C.raised }}>
                <button onClick={() => onConfigsPulled?.({ [name]: config }, name)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: C.text }}>
                  <Check style={{ width: 12, height: 12, color: C.green }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.textBright }}>{name}</span>
                  <span style={{ fontSize: 9, color: C.muted, marginLeft: "auto", fontFamily: mono }}>{(config.length / 1024).toFixed(1)}kb</span>
                </button>
                <IcoBtn icon={Download} label={`Save ${name}.txt`} onClick={() => downloadFile(name, config)} size={12} style={{ padding: 8, borderLeft: `1px solid ${C.border}` }} />
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
    </div>
  );
}
