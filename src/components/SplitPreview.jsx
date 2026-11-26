import { useState } from "react";
import { useTheme, mono, sans } from "../theme";
import { Btn } from "./Shared";
import { Check, X, Merge } from "lucide-react";

export function SplitPreview({ devices, onAccept, onCancel }) {
  const { C } = useTheme();
  const [items, setItems] = useState(() => devices.map((d, i) => ({ ...d, id: i, merged: false })));

  const rename = (id, name) => setItems(prev => prev.map(it => it.id === id ? { ...it, name } : it));

  const mergeWithNext = (id) => {
    setItems(prev => {
      const idx = prev.findIndex(it => it.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const a = prev[idx], b = prev[idx + 1];
      const merged = {
        ...a,
        content: a.content + "\n\n" + b.content,
        warnings: [...a.warnings, `Merged with "${b.name}"`],
      };
      return [...prev.slice(0, idx), merged, ...prev.slice(idx + 2)];
    });
  };

  const accept = () => {
    onAccept(items.map(({ name, content, warnings }) => ({ name, content, warnings })));
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        width: "min(560px, 90vw)", maxHeight: "80vh",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: "14px 16px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.textBright }}>Split Preview</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
              {items.length} device{items.length !== 1 ? "s" : ""} detected — rename or merge before creating tabs
            </div>
          </div>
          <button onClick={onCancel} style={{
            background: "none", border: "none", cursor: "pointer",
            color: C.muted, padding: 4,
          }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 16px",
              borderBottom: idx < items.length - 1 ? `1px solid ${C.border}` : "none",
            }}>
              <span style={{ fontSize: 10, color: C.muted, fontFamily: mono, width: 20, textAlign: "right", flexShrink: 0 }}>
                {idx + 1}
              </span>
              <input
                value={it.name}
                onChange={e => rename(it.id, e.target.value)}
                style={{
                  flex: 1, fontSize: 11, fontWeight: 700, fontFamily: mono,
                  background: C.raised, color: C.textBright,
                  border: `1px solid ${C.border}`, padding: "4px 8px",
                  outline: "none", minWidth: 0,
                }}
              />
              <span style={{ fontSize: 9, color: C.muted, fontFamily: mono, flexShrink: 0 }}>
                {it.content.split("\n").length} ln
              </span>
              {it.warnings.length > 0 && (
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: "2px 6px",
                  background: "rgba(248,113,113,0.12)", color: C.red,
                  fontFamily: mono, flexShrink: 0,
                }}>
                  {it.warnings.length} warning{it.warnings.length !== 1 ? "s" : ""}
                </span>
              )}
              {idx < items.length - 1 && (
                <button onClick={() => mergeWithNext(it.id)} title="Merge with next device" style={{
                  background: "none", border: `1px solid ${C.border}`,
                  cursor: "pointer", color: C.muted, padding: "2px 6px",
                  fontSize: 9, fontFamily: mono, flexShrink: 0,
                }}>
                  Merge ↓
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{
          padding: "10px 16px", borderTop: `1px solid ${C.border}`,
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn icon={Check} primary onClick={accept}>
            Create {items.length} tab{items.length !== 1 ? "s" : ""}
          </Btn>
        </div>
      </div>
    </div>
  );
}
