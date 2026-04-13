import { useState } from "react";
import { Wifi, Loader, Check, X, Play, RotateCcw, Download, Plus, Server, Monitor } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn, Btn, canHover } from "./Shared";
import { useStream } from "../hooks/useStream";

/**
 * Pull configs from devices — supports both direct SSH and console-server modes.
 * Shared props: conn, apiKey, needsAuth, apiOnline, mode, apiBase, inpStyle
 */
export function PullPanel({ conn, apiKey, needsAuth, apiOnline, mode, onConfigsPulled, apiBase, inpStyle }) {
  const { C } = useTheme();
  const [devices, setDevices] = useState(null);
  const [pod, setPod] = useState("");
  const [selected, setSelected] = useState([]);
  const [directHosts, setDirectHosts] = useState([""]);
  const [discoverStatus, setDiscoverStatus] = useState("idle");

  const { status, message, results, pulling, busy, readStream, reset, initResults, setStatus, setMessage } =
    useStream("pull");

  const [rowHov, setRowHov] = useState(null); // hovered device num string
  const [selHov, setSelHov] = useState(null); // "All" | "None"

  const authHeaders = () => {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  };

  const toggleDevice = n =>
    setSelected(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);

  const withTimeout = (ms) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return { signal: ctrl.signal, clearTimeout: () => clearTimeout(id) };
  };

  // ── Discover devices on console server ──
  const discover = async () => {
    if (!conn.host || !conn.username || !conn.password) {
      setMessage("Enter host, username & password"); return;
    }
    setDiscoverStatus("discovering");
    setMessage("Connecting & reading device menu...");
    setDevices(null);
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
      else {
        setDevices(data.devices);
        setPod(data.pod || "");
        setSelected(Object.keys(data.devices));
        setMessage(`Found ${Object.keys(data.devices).length} device${Object.keys(data.devices).length !== 1 ? "s" : ""}`);
      }
    } catch (e) {
      clear();
      setStatus("error");
      setMessage(e.name === "AbortError" ? "Discovery timed out (30s)" : "Cannot reach backend");
    } finally {
      setDiscoverStatus("idle");
    }
  };

  // ── Pull via console server ──
  const pullConsole = async () => {
    if (!selected.length) return;
    const devMap = {};
    selected.forEach(k => { if (devices[k]) devMap[k] = devices[k]; });
    initResults(selected.length);
    setMessage("Connecting...");
    const { signal, clearTimeout: clear } = withTimeout(300000); // 5 min
    try {
      const res = await fetch(`${apiBase}/api/pull`, {
        method: "POST", headers: authHeaders(), signal,
        body: JSON.stringify({ host: conn.host, port: parseInt(conn.port || "22"), username: conn.username, password: conn.password, enablePass: conn.enablePass, devices: devMap }),
      });
      clear();
      if (res.status === 401 || res.status === 429) {
        setStatus("error"); setMessage(res.status === 401 ? "Invalid API key" : "Rate limited"); return;
      }
      await readStream(res);
    } catch (e) {
      clear();
      setStatus("error");
      setMessage(e.name === "AbortError" ? "Pull timed out" : "Connection lost");
    }
  };

  // ── Pull via direct SSH ──
  const pullDirect = async () => {
    const hosts = directHosts.filter(h => h.trim());
    if (!hosts.length || !conn.username || !conn.password) {
      setMessage("Enter credentials and device IPs"); return;
    }
    const devList = hosts.map(h => ({ host: h.trim(), port: parseInt(conn.port || "22"), username: conn.username, password: conn.password, enablePass: conn.enablePass }));
    initResults(hosts.length);
    setMessage("Connecting...");
    const { signal, clearTimeout: clear } = withTimeout(300000);
    try {
      const res = await fetch(`${apiBase}/api/pull-direct`, {
        method: "POST", headers: authHeaders(), signal,
        body: JSON.stringify({ devices: devList }),
      });
      clear();
      if (res.status === 401 || res.status === 429) {
        setStatus("error"); setMessage(res.status === 401 ? "Invalid API key" : "Rate limited"); return;
      }
      await readStream(res);
    } catch (e) {
      clear();
      setStatus("error");
      setMessage(e.name === "AbortError" ? "Pull timed out" : "Connection lost");
    }
  };

  const downloadFile = (name, content) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    a.download = `${name}.txt`; a.click();
  };

  const downloadAll = () => {
    if (!results?.configs) return;
    Object.entries(results.configs).forEach(([name, config], i) =>
      setTimeout(() => downloadFile(name, config), i * 100));
  };

  const discovering = discoverStatus === "discovering";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Direct SSH — host list */}
      {mode === "direct" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>Devices</span>
            <button onClick={() => setDirectHosts(p => [...p, ""])} title="Add device" style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", fontFamily: mono, display: "flex", alignItems: "center", gap: 3 }}>
              <Plus style={{ width: 10, height: 10 }} /> Add
            </button>
          </div>
          {directHosts.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 4 }}>
              <input placeholder="Device IP or hostname" style={{ ...inpStyle, flex: 1 }} value={h}
                onChange={e => { const n = [...directHosts]; n[i] = e.target.value; setDirectHosts(n); }} />
              {directHosts.length > 1 && (
                <IcoBtn icon={X} label="Remove" onClick={() => setDirectHosts(p => p.filter((_, j) => j !== i))} size={12} style={{ padding: 6 }} />
              )}
            </div>
          ))}
        </div>
      )}
      {mode === "direct" && (
        <Btn icon={busy ? Loader : Play} onClick={pullDirect} primary disabled={!apiOnline || busy || !directHosts.some(h => h.trim())} style={{ justifyContent: "center", padding: "10px 0" }}>
          {busy ? "Pulling..." : `Pull ${directHosts.filter(h => h.trim()).length} Device${directHosts.filter(h => h.trim()).length !== 1 ? "s" : ""}`}
        </Btn>
      )}

      {/* Console server — discover then select */}
      {mode === "console" && !devices && (
        <Btn icon={discovering ? Loader : Wifi} onClick={discover} primary disabled={!apiOnline || discovering} style={{ justifyContent: "center", padding: "10px 0" }}>
          {discovering ? "Discovering..." : "Connect & Discover Devices"}
        </Btn>
      )}
      {mode === "console" && devices && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
                Devices{pod ? ` · POD ${pod}` : ""}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {["All", "None"].map(lbl => (
                  <button key={lbl}
                    onClick={() => setSelected(lbl === "All" ? Object.keys(devices) : [])}
                    onMouseEnter={() => canHover && setSelHov(lbl)}
                    onMouseLeave={() => setSelHov(null)}
                    style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", opacity: selHov === lbl ? 1 : 0.7, transition: "opacity .12s", fontFamily: mono }}
                  >{lbl}</button>
                ))}
              </div>
            </div>
            {Object.entries(devices).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([num, name]) => {
              const on = selected.includes(num);
              const hov = !on && rowHov === num;
              return (
                <button key={num} onClick={() => toggleDevice(num)}
                  onMouseEnter={() => canHover && setRowHov(num)}
                  onMouseLeave={() => setRowHov(null)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: `1px solid ${on ? C.borderActive : hov ? C.border : "transparent"}`, background: on ? C.accentDim : hov ? C.raised : "transparent", cursor: "pointer", textAlign: "left", transition: "background .12s, border-color .12s" }}>
                  <div style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", background: on ? C.accent : C.muted + "33", transition: "background .12s" }}>
                    {on && <Check style={{ width: 10, height: 10, color: "#0a0e1a" }} />}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: on ? C.accent : hov ? C.textBright : C.text }}>[{num}]</span>
                  <span style={{ fontSize: 10, color: C.muted }}>{name}</span>
                </button>
              );
            })}
          </div>
          <Btn icon={busy ? Loader : Play} onClick={pullConsole} primary disabled={busy || !selected.length} style={{ justifyContent: "center", padding: "10px 0" }}>
            {busy ? "Pulling..." : `Pull ${selected.length} Device${selected.length !== 1 ? "s" : ""}`}
          </Btn>
          <Btn icon={RotateCcw} onClick={() => { setDevices(null); reset(); }} style={{ justifyContent: "center", fontSize: 9, padding: "6px 0" }}>Re-scan</Btn>
        </>
      )}

      {/* Status bar */}
      {message && (
        <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, background: status === "error" ? "rgba(248,113,113,0.06)" : status === "done" ? C.greenDim : C.accentDim, border: `1px solid ${status === "error" ? "rgba(248,113,113,0.15)" : status === "done" ? "rgba(52,211,153,0.15)" : C.borderActive}`, color: status === "error" ? C.red : status === "done" ? C.green : C.accent }}>
          {message}
        </div>
      )}

      {/* Results list */}
      {results && (Object.keys(results.configs).length > 0 || pulling || results.errors.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
              Configs {results.pulled}/{results.total}
            </span>
            {Object.keys(results.configs).length > 1 && (
              <button onClick={downloadAll} title="Save all as .txt files" style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", opacity: 0.7, fontFamily: mono }}>Save All</button>
            )}
          </div>
          {pulling && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: `1px solid ${C.borderActive}`, background: C.accentDim }}>
              <Loader style={{ width: 12, height: 12, color: C.accent, animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent }}>{pulling}</span>
            </div>
          )}
          {Object.entries(results.configs).map(([name, config]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 0, border: `1px solid ${C.border}`, background: C.raised }}>
              <button onClick={() => onConfigsPulled?.({ [name]: config }, name)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: C.text }}>
                <Check style={{ width: 12, height: 12, color: C.green }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: C.textBright }}>{name}</span>
                <span style={{ fontSize: 9, color: C.muted, marginLeft: "auto", fontFamily: mono }}>
                  {(config.length / 1024).toFixed(1)}kb
                </span>
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
  );
}
