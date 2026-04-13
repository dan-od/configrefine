import { useState } from "react";
import { Upload, Terminal, Wifi, FileCode } from "lucide-react";
import { useTheme, mono, sans } from "../theme";
import { useViewport } from "../theme";

/**
 * Shown in the workspace when no config files are loaded.
 * Props:
 *   onPaste   — create an empty tab and focus the input textarea
 *   onUpload  — trigger the hidden file input
 *   onPull    — open the SSH / Lab panel
 *   onSample  — load the built-in sample config
 */
export function EmptyState({ onPaste, onUpload, onPull, onSample }) {
  const { C } = useTheme();
  const vp = useViewport();
  const [hovered, setHovered] = useState(null); // "paste" | "upload" | "pull" | "sample" | null

  const card = (id, icon, iconHover, title, desc, onClick, extraStyle) => {
    const isHovered = hovered === id;
    return (
      <button
        key={id}
        onClick={onClick}
        onMouseEnter={() => setHovered(id)}
        onMouseLeave={() => setHovered(null)}
        title={title}
        style={{
          display: "flex", flexDirection: "column", alignItems: "flex-start",
          gap: 8, padding: vp.phone ? 12 : "16px 16px 14px",
          background: C.surface, textAlign: "left",
          border: `1px solid ${isHovered ? C.borderActive : C.border}`,
          cursor: "pointer", transition: "border-color .15s",
          width: "100%",
          ...extraStyle,
        }}
      >
        <div style={{
          width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          background: isHovered ? C.accentDim : C.raised, transition: "background .15s", flexShrink: 0,
        }}>
          {isHovered ? iconHover : icon}
        </div>
        <div>
          <div style={{ fontSize: vp.phone ? 12 : 12, fontWeight: 700, color: isHovered ? C.accent : C.textBright, transition: "color .15s", marginBottom: 3 }}>
            {title}
          </div>
          <div style={{ fontSize: vp.phone ? 10 : 10.5, color: C.muted, lineHeight: 1.5 }}>{desc}</div>
        </div>
      </button>
    );
  };

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: vp.phone ? "24px 16px" : 32, gap: vp.phone ? 20 : 28,
    }}>
      {/* Headline */}
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div style={{ fontSize: vp.phone ? 18 : 22, fontWeight: 800, color: C.textBright, letterSpacing: -0.5, marginBottom: 8 }}>
          Config<span style={{ color: C.accent }}>Refine</span>
        </div>
        <div style={{ fontSize: vp.phone ? 11 : 12, color: C.muted, lineHeight: 1.6 }}>
          Paste, upload, or pull Cisco device configs — strip boilerplate, crypto noise, and
          management clutter with a single click.
        </div>
      </div>

      {/* Action cards — 2-col grid on mobile (Paste + Upload), Pull full-width below */}
      {vp.phone ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {card(
              "paste",
              <Terminal style={{ width: 15, height: 15, color: C.muted }} />,
              <Terminal style={{ width: 15, height: 15, color: C.accent }} />,
              "Paste a config",
              "Tap here, then paste any raw show running-config output.",
              onPaste,
            )}
            {card(
              "upload",
              <Upload style={{ width: 15, height: 15, color: C.muted }} />,
              <Upload style={{ width: 15, height: 15, color: C.accent }} />,
              "Upload files",
              "Load .txt / .cfg / .conf files from your device.",
              onUpload,
            )}
          </div>
          {card(
            "pull",
            <Wifi style={{ width: 15, height: 15, color: C.muted }} />,
            <Wifi style={{ width: 15, height: 15, color: C.accent }} />,
            "Pull from devices",
            "SSH to a console server or device and pull configs live.",
            onPull,
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12, width: "100%", maxWidth: 560, flexWrap: "wrap" }}>
          {card(
            "paste",
            <Terminal style={{ width: 15, height: 15, color: C.muted }} />,
            <Terminal style={{ width: 15, height: 15, color: C.accent }} />,
            "Paste a config",
            "Click here, then paste any raw show running-config output.",
            onPaste,
            { flex: 1, minWidth: 140 },
          )}
          {card(
            "upload",
            <Upload style={{ width: 15, height: 15, color: C.muted }} />,
            <Upload style={{ width: 15, height: 15, color: C.accent }} />,
            "Upload files",
            "Load .txt / .cfg / .conf files directly from your computer.",
            onUpload,
            { flex: 1, minWidth: 140 },
          )}
          {card(
            "pull",
            <Wifi style={{ width: 15, height: 15, color: C.muted }} />,
            <Wifi style={{ width: 15, height: 15, color: C.accent }} />,
            "Pull from devices",
            "SSH to a console server or device and pull configs live.",
            onPull,
            { flex: 1, minWidth: 140 },
          )}
        </div>
      )}

      {/* Sample shortcut */}
      <button
        onClick={onSample}
        onMouseEnter={() => setHovered("sample")}
        onMouseLeave={() => setHovered(null)}
        style={{
          display: "flex", alignItems: "center", gap: 7, padding: "8px 16px",
          background: "transparent",
          border: `1px solid ${hovered === "sample" ? C.borderActive : C.border}`,
          color: hovered === "sample" ? C.accent : C.muted,
          fontSize: 11, fontWeight: 700, fontFamily: sans,
          cursor: "pointer", letterSpacing: 0.4, transition: "border-color .15s, color .15s",
        }}
      >
        <FileCode style={{ width: 12, height: 12 }} />
        Try with sample config
      </button>
    </div>
  );
}
