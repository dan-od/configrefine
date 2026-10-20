import { useState, useEffect } from "react";
import { Loader, Check, Upload, X, ArrowRight } from "lucide-react";
import { useTheme, mono } from "../theme";
import { Btn, canHover } from "./Shared";
import { useStream } from "../hooks/useStream";

/**
 * Push cleaned configs onto devices — supports direct SSH and console-server modes.
 * Shared props: conn, apiKey, needsAuth, apiOnline, mode, files, apiBase, inpStyle, pod
 * Console targets come from the shared `pod` device list; only the
 * config → device mappings are local to this tab.
 */
export function PushPanel({ conn, apiKey, apiOnline, mode, files: loadedFiles, apiBase, inpStyle, pod }) {
  const { C } = useTheme();
  const { devices, directHosts } = pod;
  const [pushMappings, setPushMappings] = useState([]);

  const { status, message, results, pulling, busy, readStream, reset, initResults, setStatus, setMessage } =
    useStream("push");

  const [rowHov, setRowHov] = useState(null); // hovered mapping fileId

  // Rebuild mappings when files change, keeping targets already chosen per file
  useEffect(() => {
    const active = (loadedFiles ?? []).filter(f => f.clean || f.raw);
    setPushMappings(prev => active.map(f => {
      const old = prev.find(m => m.fileId === f.id);
      return {
        fileId: f.id, name: f.name, config: f.clean || f.raw,
        target: old?.target ?? "", // direct mode: device IP
        num: old?.num ?? "",       // console mode: pod menu number
        enabled: old?.enabled ?? true,
      };
    }));
  }, [loadedFiles]);

  // Drop console targets that are no longer on the pod (rediscover / disconnect)
  useEffect(() => {
    setPushMappings(p => p.map(m => m.num && !(devices && devices[m.num]) ? { ...m, num: "" } : m));
  }, [devices]);

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
    const active = pushMappings.filter(m => m.enabled && m.num);
    if (!active.length) { setMessage("Map at least one config to a device"); return; }
    const creds = pod.consoleCreds();
    if (!creds) { setMessage("Connect to a pod first"); return; }
    const mappings = active.map(m => ({ num: m.num, name: m.name, config: m.config }));
    initResults(active.length);
    setMessage("Connecting to console server...");
    const { signal, clearTimeout: clear } = withTimeout(300000);
    try {
      const res = await fetch(`${apiBase}/api/push-console`, {
        method: "POST", headers: authHeaders(), signal,
        body: JSON.stringify({ ...creds, mappings }),
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

  const readyCount = pushMappings.filter(m => m.enabled && (mode === "direct" ? m.target.trim() : m.num)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
          Map configs → {mode === "direct" ? "device IPs" : "menu numbers"}
        </div>

        {/* Console mode: targets come from the shared pod device list */}
        {mode === "console" && !devices && (
          <div style={{ fontSize: 10, color: C.muted, textAlign: "center", padding: "4px 0 6px" }}>
            Connect to a pod above to choose target devices.
          </div>
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
              <input placeholder="IP address" list="cr-direct-hosts" style={{ ...inpStyle, flex: 1, minWidth: 0, padding: "4px 8px", fontSize: 10 }}
                value={m.target} onChange={e => setPushMappings(p => p.map((x, j) => j === i ? { ...x, target: e.target.value } : x))} />
            ) : (
              <select disabled={!devices} style={{ ...inpStyle, flex: 1, minWidth: 0, padding: "4px 8px", fontSize: 10, cursor: devices ? "pointer" : "not-allowed" }}
                value={m.num} onChange={e => setPushMappings(p => p.map((x, j) => j === i ? { ...x, num: e.target.value } : x))}>
                <option value="">Select device...</option>
                {devices && Object.entries(devices).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([num, name]) => (
                  <option key={num} value={num}>[{num}] {name}</option>
                ))}
              </select>
            )}
          </div>
        ); })}
        {/* Direct mode: suggest the hosts entered in Pull / Erase */}
        {mode === "direct" && (
          <datalist id="cr-direct-hosts">
            {[...new Set(directHosts.map(h => h.trim()).filter(Boolean))].map(h => <option key={h} value={h} />)}
          </datalist>
        )}
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
