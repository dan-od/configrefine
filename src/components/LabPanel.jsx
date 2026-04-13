import { useState, useEffect } from "react";
import { canHover } from "./Shared";
import { X, AlertCircle, Download, Upload, Trash2, Monitor, Server } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn } from "./Shared";
import { PullPanel } from "./PullPanel";
import { PushPanel } from "./PushPanel";
import { ErasePanel } from "./ErasePanel";

/**
 * Thin wrapper: owns shared state (credentials, mode, api status) and
 * delegates all pull / push logic to PullPanel / PushPanel.
 *
 * On mobile, rendered inside a BottomSheet — pass inSheet=true to suppress
 * the outer container chrome (border, full-screen positioning, close header).
 *
 * Credentials are cleared on unmount so they don't linger in memory.
 */
export function LabPanel({ onClose, onConfigsPulled, files: loadedFiles, vp, inSheet }) {
  const { C } = useTheme();
  const [action, setAction] = useState("pull");  // "pull" | "push" | "erase"
  const [mode, setMode] = useState("direct");    // "direct" | "console"
  const [conn, setConn] = useState({ host: "", port: "", username: "", password: "", enablePass: "" });
  const [apiKey, setApiKey] = useState("");
  const [apiOnline, setApiOnline] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [tabHov, setTabHov] = useState(null);   // "pull" | "push"
  const [modeHov, setModeHov] = useState(null); // "direct" | "console"

  const apiBase = typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "" : "http://localhost:3001";

  // Check backend health on mount
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${apiBase}/api/status`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setApiOnline(true); setNeedsAuth(d.auth === true); })
      .catch(() => setApiOnline(false));
    return () => ctrl.abort();
  }, [apiBase]);

  // Clear credentials from memory when panel closes
  useEffect(() => {
    return () => {
      setConn({ host: "", port: "", username: "", password: "", enablePass: "" });
      setApiKey("");
    };
  }, []);

  // Compact input sizes on mobile / in-sheet
  const inp = {
    width: "100%",
    padding: (vp.phone || inSheet) ? "6px 8px" : "7px 10px",
    border: `1px solid ${C.border}`,
    background: C.surface, color: C.text,
    fontSize: 11, outline: "none",
    fontFamily: "inherit", borderRadius: 0,
  };

  const sharedProps = { conn, apiKey, needsAuth, apiOnline, mode, apiBase, inpStyle: inp };

  // ── Inner content (tabs + credentials + panel) ─────────────────────────────
  const content = (
    <>
      {/* ── Pull / Push / Erase tab ── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
        {[
          { id: "pull",  label: "Pull",  icon: Download },
          { id: "push",  label: "Push",  icon: Upload   },
          { id: "erase", label: "Erase", icon: Trash2   },
        ].map(a => {
          const isActive = action === a.id;
          const isHov = !isActive && tabHov === a.id;
          const activeColor = a.id === "erase" ? C.red : C.accent;
          const activeBg    = a.id === "erase" ? "rgba(248,113,113,0.08)" : C.accentDim;
          return (
            <button key={a.id} onClick={() => setAction(a.id)}
              onMouseEnter={() => canHover && setTabHov(a.id)}
              onMouseLeave={() => setTabHov(null)}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 0",
                background: isActive ? activeBg : isHov ? C.raised : "transparent",
                borderBottom: isActive ? `2px solid ${activeColor}` : "2px solid transparent",
                color: isActive ? activeColor : isHov ? C.text : C.muted,
                fontSize: 11, fontWeight: 700, fontFamily: mono, border: "none", cursor: "pointer",
                transition: "background .15s, color .15s",
              }}>
              <a.icon style={{ width: 13, height: 13 }} />
              {a.label}
            </button>
          );
        })}
      </div>

      {/* ── Direct / Console mode tab ── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
        {[{ id: "direct", label: "Direct SSH", icon: Monitor }, { id: "console", label: "Console Server", icon: Server }].map(m => {
          const isActive = mode === m.id;
          const isHov = !isActive && modeHov === m.id;
          return (
            <button key={m.id} onClick={() => setMode(m.id)}
              onMouseEnter={() => canHover && setModeHov(m.id)}
              onMouseLeave={() => setModeHov(null)}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 0",
                background: isActive ? C.surface : isHov ? C.raised : "transparent",
                borderBottom: isActive ? `1px solid ${C.accent}44` : "1px solid transparent",
                color: isActive ? C.textBright : isHov ? C.text : C.muted,
                fontSize: 9, fontWeight: 600, fontFamily: mono, border: "none", cursor: "pointer",
                transition: "background .15s, color .15s",
              }}>
              <m.icon style={{ width: 10, height: 10 }} />
              {m.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: inSheet ? undefined : 1, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Backend offline warning */}
        {apiOnline === false && (
          <div style={{ padding: 12, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <AlertCircle style={{ width: 13, height: 13, color: C.red }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>Backend not running</span>
            </div>
            <code style={{ fontSize: 10, color: C.accent, fontFamily: mono, padding: "6px 10px", background: C.surface, border: `1px solid ${C.border}`, display: "block" }}>
              python pull_configs.py --serve
            </code>
          </div>
        )}

        {/* ── Credentials (shared across pull/push) ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
            {mode === "console" ? "Console Server" : "Credentials"}
          </div>
          {mode === "console" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 56px", gap: 6 }}>
              <input placeholder="Console server host" style={inp} value={conn.host} onChange={e => setConn({ ...conn, host: e.target.value })} />
              <input placeholder="Port" style={{ ...inp, textAlign: "center" }} value={conn.port} onChange={e => setConn({ ...conn, port: e.target.value })} />
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <input placeholder="Username" style={inp} value={conn.username} onChange={e => setConn({ ...conn, username: e.target.value })} autoComplete="off" />
            <input placeholder="Password" type="password" style={inp} value={conn.password} onChange={e => setConn({ ...conn, password: e.target.value })} autoComplete="off" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: mode === "direct" ? "1fr 56px" : "1fr", gap: 6 }}>
            <input placeholder="Enable password (optional)" type="password" style={inp} value={conn.enablePass} onChange={e => setConn({ ...conn, enablePass: e.target.value })} autoComplete="off" />
            {mode === "direct" && <input placeholder="Port" style={{ ...inp, textAlign: "center" }} value={conn.port} onChange={e => setConn({ ...conn, port: e.target.value })} />}
          </div>
          {needsAuth && (
            <input placeholder="API Key" type="password" style={{ ...inp, borderColor: apiKey ? C.borderActive : "rgba(248,113,113,0.3)" }} value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" />
          )}
        </div>

        {/* ── Panel ── */}
        {action === "pull"
          ? <PullPanel {...sharedProps} onConfigsPulled={onConfigsPulled} />
          : action === "push"
            ? <PushPanel {...sharedProps} files={loadedFiles} />
            : <ErasePanel {...sharedProps} />
        }
      </div>
    </>
  );

  // ── Sheet mode (mobile) — no outer chrome ──────────────────────────────────
  if (inSheet) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* Compact title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted, textTransform: "uppercase", fontFamily: mono }}>Remotely</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: action === "erase" ? C.red : C.textBright, marginTop: 2 }}>
              {action === "pull" ? "Pull Configs" : action === "push" ? "Push Configs" : "Erase & Reload"}
            </div>
          </div>
          {apiOnline !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", background: apiOnline ? C.greenDim : "rgba(248,113,113,0.1)", border: `1px solid ${apiOnline ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}` }}>
              <div style={{ width: 5, height: 5, background: apiOnline ? C.green : C.red }} />
              <span style={{ fontSize: 8, fontWeight: 700, color: apiOnline ? C.green : C.red, fontFamily: mono }}>{apiOnline ? "API" : "OFF"}</span>
            </div>
          )}
        </div>
        {content}
      </div>
    );
  }

  // ── Desktop mode — full side panel ────────────────────────────────────────
  return (
    <div style={{
      width: vp.phone ? "100%" : 340, minWidth: vp.phone ? 0 : 340,
      display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.border}`,
      background: C.bg, overflowY: "auto",
      ...(vp.phone && { position: "fixed", inset: 0, zIndex: 100 }),
    }}>
      {/* ── Header ── */}
      <div style={{ padding: "16px 14px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted, textTransform: "uppercase", fontFamily: mono }}>Remotely</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: action === "erase" ? C.red : C.textBright, marginTop: 2 }}>
            {action === "pull" ? "Pull Configs" : action === "push" ? "Push Configs" : "Erase & Reload"}
          </div>
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
      {content}
    </div>
  );
}
