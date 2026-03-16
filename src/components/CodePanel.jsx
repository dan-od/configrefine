import { useState } from "react";
import { Terminal, Copy } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn, copyToClipboard } from "./Shared";

export function CodePanel({ label, tag, value, onChange, readOnly, actions, vp }) {
  const { C } = useTheme();
  const [copied, setCopied] = useState(false);
  const lines = value ? value.split("\n").length : 0;
  const nums = Array.from({ length: Math.max(lines, 1) }, (_, i) => i + 1);
  const copy = () => { copyToClipboard(value); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: vp.phone ? 260 : 0, border: `1px solid ${C.border}`, overflow: "hidden", background: C.surface, borderRadius: "0 0 2px 2px" }}>
      <div style={{ height: 38, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 0 14px", background: C.raised }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase", color: C.muted, fontFamily: mono }}>{label}</span>
          {tag && <span style={{ padding: "1px 7px", background: C.greenDim, color: C.green, fontSize: 8, fontWeight: 800, letterSpacing: 1.5, borderRadius: 1 }}>{tag}</span>}
        </div>
        <div style={{ display: "flex", gap: 1 }}>
          {actions}
          <IcoBtn icon={Copy} label="Copy" onClick={copy} active={copied} />
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {!vp.phone && (
          <div style={{ width: 40, overflowY: "hidden", paddingTop: 14, background: C.bg, borderRight: `1px solid ${C.border}`, userSelect: "none" }}>
            {nums.map(n => <div key={n} style={{ height: 19, lineHeight: "19px", textAlign: "right", paddingRight: 8, fontSize: 10, fontFamily: mono, color: C.muted + "44" }}>{n}</div>)}
          </div>
        )}
        <textarea value={value} onChange={e => onChange?.(e.target.value)} readOnly={readOnly} spellCheck={false}
          placeholder={readOnly ? "Output renders here..." : "Paste raw config..."}
          style={{ flex: 1, padding: "10px 14px", fontFamily: mono, fontSize: vp.phone ? 11 : 12, lineHeight: "19px", background: "transparent", resize: "none", border: "none", outline: "none", color: C.text, width: "100%" }} />
        {!readOnly && !value && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", opacity: 0.03 }}>
            <Terminal style={{ width: 100, height: 100, color: C.text }} />
          </div>
        )}
      </div>
      <div style={{ height: 24, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 14px", background: C.bg }}>
        <span style={{ fontSize: 9.5, fontFamily: mono, color: C.muted + "88" }}>{value ? `${lines} ln · ${value.length} ch` : "—"}</span>
      </div>
    </div>
  );
}
