import { useState, useEffect } from "react";
import { canHover } from "./Shared";
import { X, AlertCircle, Download, Upload, Trash2, Monitor, Server, Wifi, Loader, RotateCcw, Unplug } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn, Btn } from "./Shared";
import { PullPanel } from "./PullPanel";
import { PushPanel } from "./PushPanel";
import { ErasePanel } from "./ErasePanel";

/**
 * Thin wrapper: renders the connection form / connected-pod card and the
 * Pull / Push / Erase tabs. Connection settings, credentials and the
 * discovered pod devices live in the shared `pod` object (usePodConnection,
 * owned by App) so they survive tab switches and closing the panel.
 *
 * On mobile, rendered inside a BottomSheet — pass inSheet=true to suppress
 * the outer container chrome (border, full-screen positioning, close header).
 *
 * When the panel closes with no pod connected, credentials are cleared from
 * memory (pod.releaseIfIdle). While a pod is connected they are kept in
 * memory until Disconnect.
 */
export function LabPanel({ onClose, onConfigsPulled, files: loadedFiles, vp, inSheet, pod }) {
  const { C } = useTheme();
  const [action, setAction] = useState("pull");  // "pull" | "push" | "erase"
  const { mode, setMode, conn, setConn, apiKey, setApiKey, apiBase, session, connected, discovering, discoverMsg } = pod;
  const [apiOnline, setApiOnline] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [tabHov, setTabHov] = useState(null);   // "pull" | "push"
  const [modeHov, setModeHov] = useState(null); // "direct" | "console"

  // Check backend health on mount
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${apiBase}/api/status`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setApiOnline(true); setNeedsAuth(d.auth === true); })
      .catch(() => setApiOnline(false));
    return () => ctrl.abort();
  }, [apiBase]);

  // Clear credentials from memory when panel closes, unless a pod is connected
  const { releaseIfIdle } = pod;
  useEffect(() => releaseIfIdle, [releaseIfIdle]);

  // Compact input sizes on mobile / in-sheet
  const inp = {
    width: "100%",
    padding: (vp.phone || inSheet) ? "6px 8px" : "7px 10px",
    border: `1px solid ${C.border}`,
    background: C.surface, color: C.text,
    fontSize: 11, outline: "none",
    fontFamily: "inherit", borderRadius: 0,
  };

  const sharedProps = { conn, apiKey, needsAuth, apiOnline, mode, apiBase, inpStyle: inp, pod };

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

        {/* ── Connection (shared across pull / push / erase) ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
            {mode === "console" ? "Console Server" : "Credentials"}
          </div>

          {/* Connected pod card — replaces host/user/password while connected */}
          {mode === "console" && connected && (
            <div style={{ padding: 10, background: C.greenDim, border: "1px solid rgba(52,211,153,0.2)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, background: C.green, flexShrink: 0 }} />
                <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 2, color: C.green, textTransform: "uppercase", fontFamily: mono }}>Connected</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: C.text, fontFamily: mono, marginLeft: "auto" }}>
                  {Object.keys(session.devices).length} device{Object.keys(session.devices).length !== 1 ? "s" : ""}
                </span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textBright }}>{session.pod ? `POD ${session.pod}` : "Console pod"}</div>
                <div title={`${session.username}@${session.host}:${session.port || "22"}`}
                  style={{ fontSize: 10, color: C.muted, fontFamily: mono, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {session.username}@{session.host}:{session.port || "22"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <Btn icon={discovering ? Loader : RotateCcw} onClick={pod.rediscover} disabled={!apiOnline || discovering || pod.busy}
                  style={{ justifyContent: "center", padding: "7px 0", fontSize: 10 }}>
                  {discovering ? "Discovering..." : "Rediscover"}
                </Btn>
                <Btn icon={Unplug} onClick={pod.disconnect} disabled={pod.busy}
                  style={{ justifyContent: "center", padding: "7px 0", fontSize: 10, color: C.red, border: "1px solid rgba(248,113,113,0.3)" }}>
                  Disconnect
                </Btn>
              </div>
              {pod.busy && (
                <div style={{ gridColumn: "1 / -1", fontSize: 9.5, color: C.muted, fontFamily: mono }}>
                  Locked while a pull / push / erase is running
                </div>
              )}
            </div>
          )}

          {/* Direct mode: note that a pod session is still held */}
          {mode === "direct" && connected && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, color: C.muted, fontFamily: mono }}>
              <div style={{ width: 5, height: 5, background: C.green, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.pod ? `POD ${session.pod}` : "Pod"} still connected via Console Server
              </span>
            </div>
          )}

          {mode === "console" && !connected && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 56px", gap: 6 }}>
              <input placeholder="Console server host" style={inp} value={conn.host} onChange={e => setConn(p => ({ ...p, host: e.target.value }))} />
              <input placeholder="Port" style={{ ...inp, textAlign: "center" }} value={conn.port} onChange={e => setConn(p => ({ ...p, port: e.target.value }))} />
            </div>
          )}
          {!(mode === "console" && connected) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <input placeholder="Username" style={inp} value={conn.username} onChange={e => setConn(p => ({ ...p, username: e.target.value }))} autoComplete="off" />
              <input placeholder="Password" type="password" style={inp} value={conn.password} onChange={e => setConn(p => ({ ...p, password: e.target.value }))} autoComplete="off" />
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: mode === "direct" ? "1fr 56px" : "1fr", gap: 6 }}>
            <input placeholder="Enable password (optional)" type="password" style={inp} value={conn.enablePass} onChange={e => setConn(p => ({ ...p, enablePass: e.target.value }))} autoComplete="off" />
            {mode === "direct" && <input placeholder="Port" style={{ ...inp, textAlign: "center" }} value={conn.port} onChange={e => setConn(p => ({ ...p, port: e.target.value }))} />}
          </div>
          {needsAuth && (
            <input placeholder="API Key" type="password" style={{ ...inp, borderColor: apiKey ? C.borderActive : "rgba(248,113,113,0.3)" }} value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" />
          )}

          {/* Discover once — the device list is shared by every tab */}
          {mode === "console" && !connected && (
            <Btn icon={discovering ? Loader : Wifi} onClick={() => pod.discover()} primary disabled={!apiOnline || discovering}
              style={{ justifyContent: "center", padding: "10px 0" }}>
              {discovering ? "Discovering..." : "Connect & Discover Devices"}
            </Btn>
          )}
          {mode === "console" && discoverMsg && !(connected && discoverMsg.status === "done") && (
            <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, background: discoverMsg.status === "error" ? "rgba(248,113,113,0.06)" : C.accentDim, border: `1px solid ${discoverMsg.status === "error" ? "rgba(248,113,113,0.15)" : C.borderActive}`, color: discoverMsg.status === "error" ? C.red : C.accent }}>
              {discoverMsg.text}
            </div>
          )}
        </div>

        {/* ── Panels — all stay mounted so per-tab selections and progress survive tab switches ── */}
        <div style={{ display: action === "pull" ? "block" : "none" }}>
          <PullPanel {...sharedProps} onConfigsPulled={onConfigsPulled} />
        </div>
        <div style={{ display: action === "push" ? "block" : "none" }}>
          <PushPanel {...sharedProps} files={loadedFiles} />
        </div>
        <div style={{ display: action === "erase" ? "block" : "none" }}>
          <ErasePanel {...sharedProps} active={action === "erase"} />
        </div>
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
