import { useState } from "react";
import { useTheme, sans } from "../theme";

// True on mouse/trackpad devices; false on touch-only screens.
// Evaluated once at module load — no re-renders needed.
// Exported so any component can guard its own hover state changes.
export const canHover =
  typeof window !== "undefined" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// ── Robust clipboard copy ──
export function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
}

// ── Icon button ──
export function IcoBtn({ icon: Icon, label, onClick, active, danger, size = 14, style: sx, disabled }) {
  const { C } = useTheme();
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      onMouseEnter={() => canHover && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 6, border: "none", cursor: disabled ? "default" : "pointer",
        background: active ? C.accentDim : hov ? C.border : "transparent",
        borderRadius: 3,
        color: danger ? C.red : active ? C.accent : hov ? C.text : C.muted,
        opacity: disabled ? 0.3 : 1, transition: "background .12s, color .12s",
        ...sx,
      }}
    >
      <Icon style={{ width: size, height: size }} />
    </button>
  );
}

// ── Labeled button ──
export function Btn({ icon: Icon, children, onClick, primary, active, disabled, style: sx }) {
  const { C } = useTheme();
  const [hov, setHov] = useState(false);

  const isLit = active || hov;
  const bg  = primary ? C.accent : isLit ? C.accentDim : "transparent";
  const fg  = primary ? "#0a0e1a" : isLit ? C.accent : C.muted;
  const bd  = primary ? "none" : `1px solid ${isLit ? C.borderActive : C.border}`;
  // Primary button brightens its glow on hover; non-primary has no shadow
  const shadow = primary
    ? (hov ? `0 2px 28px ${C.accentGlow}, 0 0 0 1px ${C.accent}33` : `0 2px 20px ${C.accentGlow}`)
    : undefined;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => canHover && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
        borderRadius: 2, border: bd, background: bg, color: fg,
        fontSize: 11, fontWeight: 700, fontFamily: sans,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1, letterSpacing: 0.5,
        transition: "background .15s, color .15s, border-color .15s, box-shadow .15s",
        ...(shadow ? { boxShadow: shadow } : {}),
        ...sx,
      }}
    >
      {Icon && <Icon style={{ width: 13, height: 13 }} />}
      {children}
    </button>
  );
}

// ── Toggle switch ──
export function Toggle({ on, onToggle, label, desc, compact }) {
  const { C } = useTheme();
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => canHover && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12, padding: compact ? "8px 12px" : "10px 12px",
        border: `1px solid ${on ? C.borderActive : hov ? C.border : "transparent"}`,
        borderRadius: 2,
        background: on ? C.accentDim : hov ? C.raised : "transparent",
        cursor: "pointer", textAlign: "left",
        transition: "background .15s, border-color .15s",
      }}
    >
      <div style={{
        width: 28, height: 14, borderRadius: 1,
        background: on ? C.accent : C.muted + "55",
        position: "relative", transition: "background .2s", flexShrink: 0,
      }}>
        <div style={{
          width: 10, height: 10, borderRadius: 1,
          background: on ? "#0a0e1a" : C.muted,
          position: "absolute", top: 2, left: on ? 16 : 2, transition: "left .15s",
        }} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: on ? C.accent : C.text, transition: "color .15s" }}>{label}</div>
        {desc && <div style={{ fontSize: 9.5, color: C.muted, marginTop: 1, lineHeight: 1.3 }}>{desc}</div>}
      </div>
    </button>
  );
}
