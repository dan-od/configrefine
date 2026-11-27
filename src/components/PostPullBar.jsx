import { X } from "lucide-react";
import { useTheme, mono } from "../theme";
import { Btn } from "./Shared";

export function PostPullBar({ pulledCount, files, setFiles, onDismiss, onCleanAll, onReClean }) {
  const { C } = useTheme();
  const hasClean = files.some(f => f.clean);

  const undoClean = () => {
    setFiles(prev => prev.map(f => ({ ...f, clean: "" })));
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 12px", background: C.surface,
      borderBottom: `0.5px solid ${C.border}`,
      animation: "fadeIn .25s ease", flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: 99, background: hasClean ? C.green : C.accent, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: C.muted }}>
          {hasClean
            ? `Cleaned ${files.filter(f => f.clean).length} configs`
            : `Pulled ${pulledCount} config${pulledCount !== 1 ? "s" : ""}`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {hasClean && (
          <>
            <Btn onClick={undoClean}>Undo clean</Btn>
            <Btn onClick={onReClean}>Re-clean</Btn>
          </>
        )}
        <button onClick={onDismiss} title="Dismiss" style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 24, height: 24, border: "none", background: "transparent",
          color: C.muted, cursor: "pointer", padding: 0,
        }}>
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>
    </div>
  );
}
