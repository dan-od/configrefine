import { useState, useCallback } from "react";
import { X, Sparkles, Download, Undo2 } from "lucide-react";
import { useTheme, mono } from "../theme";

export function PostPullBar({ pulledCount, files, setFiles, opts, onDismiss, runInWorker }) {
  const { C } = useTheme();
  const [cleaning, setCleaning] = useState(false);
  const [cleaned, setCleaned] = useState(false);
  const [cleanStats, setCleanStats] = useState(null);
  const [originals, setOriginals] = useState(null);

  const cleanAll = useCallback(async () => {
    setCleaning(true);
    const backups = {};
    let totalRemoved = 0;

    try {
      const updated = await Promise.all(files.map(async f => {
        if (!f.raw) return f;
        backups[f.id] = f.raw;
        const cleaned = await runInWorker(f.raw, opts);
        totalRemoved += f.raw.split("\n").length - cleaned.split("\n").length;
        return { ...f, raw: cleaned, clean: "" };
      }));
      setOriginals(backups);
      setFiles(updated);
      setCleanStats({ count: Object.keys(backups).length, removed: totalRemoved });
      setCleaned(true);
    } catch (e) {
      console.error("[PostPullBar] cleanAll failed:", e);
    } finally {
      setCleaning(false);
    }
  }, [files, setFiles, opts, runInWorker]);

  const undoClean = useCallback(() => {
    if (!originals) return;
    setFiles(prev => prev.map(f => originals[f.id] ? { ...f, raw: originals[f.id], clean: "" } : f));
    setOriginals(null);
    setCleaned(false);
    setCleanStats(null);
  }, [originals, setFiles]);

  const reClean = useCallback(async () => {
    if (originals) {
      setFiles(prev => prev.map(f => originals[f.id] ? { ...f, raw: originals[f.id], clean: "" } : f));
    }
    setOriginals(null);
    setCleaned(false);
    setCleanStats(null);
    setTimeout(() => cleanAll(), 50);
  }, [originals, setFiles, cleanAll]);

  const btnStyle = {
    fontSize: 11, padding: "5px 12px", borderRadius: 6,
    border: `0.5px solid ${C.border}`, background: C.surface,
    fontFamily: mono, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
    transition: "background .12s",
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 12px", background: C.surface,
      borderBottom: `0.5px solid ${C.border}`,
      animation: "fadeIn .25s ease", flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: 99, background: cleaned ? C.green : C.accent, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: C.muted }}>
          {cleaned && cleanStats
            ? `Cleaned ${cleanStats.count} configs — ${cleanStats.removed} lines removed`
            : `Pulled ${pulledCount} config${pulledCount !== 1 ? "s" : ""}`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {!cleaned ? (
          <button onClick={cleanAll} disabled={cleaning}
            style={{ ...btnStyle, color: C.accent, borderColor: C.borderActive }}>
            {cleaning ? (
              <>
                <Sparkles style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                Cleaning...
              </>
            ) : (
              <>
                <Sparkles style={{ width: 12, height: 12 }} />
                Clean all
              </>
            )}
          </button>
        ) : (
          <>
            {originals && (
              <button onClick={undoClean} style={{ ...btnStyle, color: C.muted }}>
                <Undo2 style={{ width: 12, height: 12 }} />
                Undo clean
              </button>
            )}
            <button onClick={reClean} style={{ ...btnStyle, color: C.accent, borderColor: C.borderActive }}>
              <Sparkles style={{ width: 12, height: 12 }} />
              Re-clean
            </button>
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
