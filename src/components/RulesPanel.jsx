import { useState } from "react";
import { memo } from "react";
import { Plus, X, Minus, Info, Code2 } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn, Btn } from "./Shared";

export const RulesPanel = memo(function RulesPanel({ rules, setRules, onClose, vp }) {
  const { C } = useTheme();
  const [adding, setAdding] = useState(false);
  const [nr, setNr] = useState({ name: "", pattern: "", replacement: "", target: "all" });
  const inp = { width: "100%", padding: "6px 10px", border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 11, outline: "none", fontFamily: "inherit", borderRadius: 0 };

  const add = () => {
    if (!nr.name || !nr.pattern) return;
    setRules(p => [...p, { id: Date.now().toString(36), ...nr, enabled: true }]);
    setNr({ name: "", pattern: "", replacement: "", target: "all" });
    setAdding(false);
  };

  return (
    <div style={{
      width: vp.phone ? "100%" : 320, minWidth: vp.phone ? 0 : 320,
      display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.border}`, background: C.bg, overflowY: "auto",
      ...(vp.phone && { position: "fixed", inset: 0, zIndex: 100 })
    }}>
      <div style={{ padding: "16px 14px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted, textTransform: "uppercase", fontFamily: mono }}>Custom</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textBright, marginTop: 2 }}>Regex Rules</div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <IcoBtn icon={Plus} label="Add rule" onClick={() => setAdding(true)} style={{ background: C.accent, color: "#0a0e1a", borderRadius: 1 }} />
          <IcoBtn icon={X} label="Close" onClick={onClose} />
        </div>
      </div>

      <div style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {adding && (
          <div style={{ padding: 12, border: `1px solid ${C.borderActive}`, background: C.accentDim, display: "flex", flexDirection: "column", gap: 8 }}>
            <input placeholder="Rule name" style={inp} value={nr.name} onChange={e => setNr({ ...nr, name: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <input placeholder="Regex pattern" style={{ ...inp, fontFamily: mono }} value={nr.pattern} onChange={e => setNr({ ...nr, pattern: e.target.value })} />
              <input placeholder="Replacement" style={{ ...inp, fontFamily: mono }} value={nr.replacement} onChange={e => setNr({ ...nr, replacement: e.target.value })} />
            </div>
            <select style={{ ...inp, cursor: "pointer" }} value={nr.target} onChange={e => setNr({ ...nr, target: e.target.value })}>
              <option value="all">All sections</option>
              <option value="interface">Interfaces only</option>
              <option value="routing">Routing blocks</option>
              <option value="global">Global config</option>
            </select>
            <div style={{ display: "flex", gap: 6 }}>
              <Btn icon={null} onClick={add} primary style={{ flex: 1, justifyContent: "center" }}>Save</Btn>
              <IcoBtn icon={X} label="Cancel" onClick={() => setAdding(false)} />
            </div>
          </div>
        )}

        {rules.length === 0 && !adding && (
          <div style={{ padding: "36px 16px", textAlign: "center", opacity: 0.3 }}>
            <Code2 style={{ width: 28, height: 28, color: C.muted, margin: "0 auto 10px" }} />
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: C.text }}>No rules yet</div>
            <div style={{ fontSize: 9.5, color: C.muted, marginTop: 3 }}>Add regex rules for targeted cleanup</div>
          </div>
        )}

        {rules.map(r => (
          <div key={r.id} style={{ padding: 10, border: `1px solid ${r.enabled ? C.border : C.border + "44"}`, background: r.enabled ? C.raised : "transparent", opacity: r.enabled ? 1 : 0.4, transition: "all .2s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setRules(p => p.map(x => x.id === r.id ? { ...x, enabled: !x.enabled } : x))} style={{
                  width: 26, height: 13, borderRadius: 1, border: "none", cursor: "pointer",
                  background: r.enabled ? C.accent : C.muted + "44", position: "relative"
                }}>
                  <div style={{ width: 9, height: 9, borderRadius: 1, background: r.enabled ? "#0a0e1a" : C.muted, position: "absolute", top: 2, left: r.enabled ? 15 : 2, transition: "left .15s" }} />
                </button>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.textBright }}>{r.name}</span>
              </div>
              <IcoBtn icon={Minus} label="Remove" onClick={() => setRules(p => p.filter(x => x.id !== r.id))} danger size={12} />
            </div>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.green }}>{r.pattern}</div>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginTop: 2 }}>{r.replacement ? `→ ${r.replacement}` : "→ (delete)"}</div>
            <span style={{ display: "inline-block", marginTop: 6, padding: "1px 6px", fontSize: 8, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", background: C.surface, color: C.muted, border: `1px solid ${C.border}` }}>{r.target}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <Info style={{ width: 12, height: 12, color: C.accent, marginTop: 1, flexShrink: 0 }} />
          <span style={{ fontSize: 9, color: C.muted, lineHeight: 1.5 }}>Rules execute <span style={{ color: C.accent, fontWeight: 700 }}>before</span> built-in transforms. Supports JS regex syntax.</span>
        </div>
      </div>
    </div>
  );
});
