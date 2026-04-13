import { useState } from "react";
import { Terminal, Copy, X } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn, copyToClipboard, canHover } from "./Shared";

// Rendering thousands of line-number divs tanks scroll performance.
// Cap at this limit — the textarea itself can hold unlimited lines.
const LINE_NUMBER_CAP = 2000;

export function CodePanel({ label, tag, value, onChange, readOnly, actions, vp, files, activeId, onTabClick, onTabClose, textareaRef, hideHeader, onSave }) {
  const { C } = useTheme();
  const [copied, setCopied] = useState(false);
  const [tabHov, setTabHov] = useState(null);   // hovered tab id
  const [closeHov, setCloseHov] = useState(null); // hovered close-btn tab id
  const lines = value ? value.split("\n").length : 0;
  // Only render up to LINE_NUMBER_CAP numbers so large configs don't create thousands of DOM nodes
  const visibleLines = Math.min(Math.max(lines, 1), LINE_NUMBER_CAP);
  const nums = Array.from({ length: visibleLines }, (_, i) => i + 1);

  const copy = () => {
    copyToClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const hasTabs = files && files.length > 0 && !readOnly;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: vp.phone ? 260 : 0, border: `1px solid ${C.border}`, overflow: "hidden", background: C.surface }}>
      {/* Header — hidden on mobile (segmented toggle takes its place) */}
      {!hideHeader && (
        <div style={{ height: 38, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 0 14px", background: C.raised, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase", color: C.muted, fontFamily: mono }}>{label}</span>
            {tag && <span style={{ padding: "1px 7px", background: C.greenDim, color: C.green, fontSize: 8, fontWeight: 800, letterSpacing: 1.5, borderRadius: 1 }}>{tag}</span>}
          </div>
          <div style={{ display: "flex", gap: 1 }}>
            {actions}
            <IcoBtn icon={Copy} label="Copy to clipboard" onClick={copy} active={copied} />
          </div>
        </div>
      )}

      {/* Tab bar — input panel only; horizontal scroll with touch momentum */}
      {hasTabs && (
        <div
          data-scroll
          style={{
            display: "flex", alignItems: "center", borderBottom: `1px solid ${C.border}`,
            background: C.bg, overflowX: "auto", flexShrink: 0,
            // Touch momentum scrolling (iOS)
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none", // hide scrollbar on Firefox
          }}
        >
          {files.map(f => {
            const isActive = f.id === activeId;
            const isTabHov = !isActive && tabHov === f.id;
            const isCloseHov = closeHov === f.id;
            return (
              <div key={f.id}
                onMouseEnter={() => canHover && setTabHov(f.id)}
                onMouseLeave={() => setTabHov(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "6px 8px 6px 12px",
                  borderRight: `1px solid ${C.border}`,
                  background: isActive ? C.surface : isTabHov ? C.raised : "transparent",
                  borderBottom: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
                  cursor: "pointer", transition: "background .12s", flexShrink: 0, maxWidth: 160,
                }}>
                <span onClick={() => onTabClick(f.id)} style={{
                  fontSize: 10, fontWeight: isActive ? 700 : 500,
                  color: isActive ? C.textBright : isTabHov ? C.text : C.muted,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  fontFamily: mono, flex: 1, transition: "color .12s",
                }}>{f.name}</span>
                {f.clean && (
                  <div style={{ width: 5, height: 5, borderRadius: 99, background: C.green, flexShrink: 0 }} title="Processed" />
                )}
                {/* 44px min touch target via padding */}
                <button
                  onClick={e => { e.stopPropagation(); onTabClose(f.id); }}
                  onMouseEnter={() => canHover && setCloseHov(f.id)}
                  onMouseLeave={() => setCloseHov(null)}
                  title="Close tab"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, border: "none",
                    background: isCloseHov ? "rgba(248,113,113,0.15)" : "transparent",
                    color: isCloseHov ? C.red : C.muted,
                    cursor: "pointer", flexShrink: 0, padding: 0,
                    transition: "background .12s, color .12s",
                    // Enlarge the tap area on touch devices without changing visible size
                    touchAction: "manipulation",
                  }}
                >
                  <X style={{ width: 10, height: 10 }} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {!vp.phone && (
          <div style={{ width: 40, overflowY: "hidden", paddingTop: 14, background: C.bg, borderRight: `1px solid ${C.border}`, userSelect: "none", flexShrink: 0 }}>
            {nums.map(n => (
              <div key={n} style={{ height: 19, lineHeight: "19px", textAlign: "right", paddingRight: 8, fontSize: 10, fontFamily: mono, color: C.muted + "44" }}>{n}</div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange?.(e.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          placeholder={readOnly ? "Output renders here after processing..." : files?.length ? "Select a tab or paste a config..." : "Paste your raw show running-config output here..."}
          style={{ flex: 1, padding: "10px 14px", fontFamily: mono, fontSize: vp.phone ? 11 : 12, lineHeight: "19px", background: "transparent", resize: "none", border: "none", outline: "none", color: C.text, width: "100%" }}
        />
        {!readOnly && !value && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", opacity: 0.03 }}>
            <Terminal style={{ width: 100, height: 100, color: C.text }} />
          </div>
        )}
      </div>

      {/* Status bar — on mobile output view also shows Save + Copy text links */}
      <div style={{ height: 28, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 14px", background: C.bg, flexShrink: 0 }}>
        <span style={{ fontSize: 9.5, fontFamily: mono, color: C.muted + "88" }}>
          {value ? `${lines}${lines > LINE_NUMBER_CAP ? "+" : ""} ln · ${value.length} ch` : "—"}
        </span>
        {onSave && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
            <button onClick={copy} style={{ fontSize: 9, fontWeight: 700, color: copied ? C.green : C.accent, background: "none", border: "none", cursor: "pointer", fontFamily: mono, letterSpacing: 0.5 }}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={onSave} style={{ fontSize: 9, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", fontFamily: mono, letterSpacing: 0.5 }}>
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
