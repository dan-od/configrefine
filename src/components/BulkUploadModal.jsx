import { useState, useRef, useMemo } from "react";
import { Upload, X, FileText, Zap } from "lucide-react";
import { useTheme, mono } from "../theme";
import { Btn } from "./Shared";

function splitByHr(text) {
  return text.split(/^-{3,}\s*$/m).map(p => p.trim()).filter(Boolean);
}

function splitByHeading(text) {
  const chunks = [];
  let current = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^#+\s+(.*)/);
    if (m) {
      if (current) chunks.push(current);
      current = { name: m[1].trim(), lines: [] };
    } else {
      if (!current) current = { name: "", lines: [] };
      current.lines.push(line);
    }
  }
  if (current) chunks.push(current);
  return chunks.map(c => ({
    name: c.name || c.lines.join("\n").match(/^hostname\s+(\S+)/m)?.[1] || "",
    content: c.lines.join("\n").trim(),
  })).filter(c => c.content);
}

function splitByCustom(text, regex) {
  try {
    const re = new RegExp(regex, "m");
    const lines = text.split("\n");
    const chunks = [];
    let current = [];
    for (const line of lines) {
      if (re.test(line) && current.length > 0) {
        chunks.push(current.join("\n").trim());
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length) chunks.push(current.join("\n").trim());
    return chunks.filter(Boolean);
  } catch {
    return [text];
  }
}

function detectName(content) {
  return content.match(/^hostname\s+(\S+)/m)?.[1] || "";
}

function HighlightedLine({ line, C }) {
  if (/^!/.test(line)) return <span style={{ color: C.muted + "88" }}>{line}</span>;

  const kw = /^(hostname|interface|ip address|ip route|router|line|access-list|no shutdown|enable|service|banner|snmp-server|ntp|logging|spanning-tree|vlan|switchport)\b/i;
  const kwMatch = line.match(kw);
  const ipRe = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?)\b/g;

  const parts = [];
  let rest = line;
  if (kwMatch) {
    parts.push(<span key="kw" style={{ color: C.accent }}>{kwMatch[0]}</span>);
    rest = line.slice(kwMatch[0].length);
  }

  let m, last = 0;
  const restParts = [];
  const tmpRe = new RegExp(ipRe.source, "g");
  while ((m = tmpRe.exec(rest)) !== null) {
    if (m.index > last) restParts.push(<span key={`t${last}`}>{rest.slice(last, m.index)}</span>);
    restParts.push(<span key={`ip${m.index}`} style={{ color: C.green }}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < rest.length) restParts.push(<span key={`t${last}`}>{rest.slice(last)}</span>);

  return <>{parts}{restParts.length ? restParts : rest}</>;
}

export function BulkUploadModal({ devices, mode, onImport, onClose }) {
  const { C } = useTheme();
  const fileRef = useRef(null);
  const [fileContent, setFileContent] = useState(null);
  const [fileName, setFileName] = useState("");
  const [splitRule, setSplitRule] = useState("hr");
  const [customRegex, setCustomRegex] = useState("");
  const [mappings, setMappings] = useState({});
  const [dragOver, setDragOver] = useState(false);

  const configs = useMemo(() => {
    if (!fileContent) return [];
    let chunks;
    if (splitRule === "hr") {
      chunks = splitByHr(fileContent).map(c => ({ name: detectName(c), content: c }));
    } else if (splitRule === "heading") {
      chunks = splitByHeading(fileContent);
    } else {
      chunks = splitByCustom(fileContent, customRegex).map(c => ({ name: detectName(c), content: c }));
    }
    return chunks.map((c, i) => ({
      ...c,
      name: c.name || `Config ${i + 1}`,
      lineCount: c.content.split("\n").length,
    }));
  }, [fileContent, splitRule, customRegex]);

  const totalLines = configs.reduce((s, c) => s + c.lineCount, 0);
  const mappedCount = Object.values(mappings).filter(Boolean).length;

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => { setFileContent(e.target.result); setMappings({}); };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  const autoMap = () => {
    if (!devices) return;
    const devEntries = Object.entries(devices);
    const next = { ...mappings };
    configs.forEach((c, i) => {
      if (next[i]) return;
      const match = devEntries.find(([num, name]) =>
        name.toLowerCase() === c.name.toLowerCase() &&
        !Object.values(next).includes(num)
      );
      if (match) next[i] = match[0];
    });
    setMappings(next);
  };

  const handleImport = () => {
    const imported = configs
      .map((c, i) => mappings[i] ? { name: c.name, content: c.content, deviceNum: mappings[i] } : null)
      .filter(Boolean);
    onImport(imported);
    onClose();
  };

  const splitPoints = useMemo(() => {
    if (!fileContent) return new Set();
    const lines = fileContent.split("\n");
    const points = new Set();
    if (splitRule === "hr") {
      lines.forEach((l, i) => { if (/^-{3,}\s*$/.test(l)) points.add(i); });
    } else if (splitRule === "heading") {
      lines.forEach((l, i) => { if (/^#+\s+/.test(l)) points.add(i); });
    } else if (customRegex) {
      try { const re = new RegExp(customRegex); lines.forEach((l, i) => { if (re.test(l)) points.add(i); }); } catch {}
    }
    return points;
  }, [fileContent, splitRule, customRegex]);

  const sec = { fontSize: 9, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono };
  const usedNums = new Set(Object.values(mappings).filter(Boolean));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", border: `1px solid ${C.border}`, background: C.surface }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${C.border}`, background: C.raised, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase", color: C.muted, fontFamily: mono }}>Bulk Upload</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 4, display: "flex" }}>
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Step 1: Upload + split rule */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, minHeight: 0 }}>
          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `1.5px dashed ${dragOver ? C.accent : C.border}`,
              borderRadius: 8, background: C.surface,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: 24, cursor: "pointer", transition: "border-color .15s",
            }}
          >
            <Upload style={{ width: 28, height: 28, color: C.accent, marginBottom: 8 }} />
            <div style={{ fontSize: 12, color: C.muted, textAlign: "center" }}>Drop .md or .txt file here</div>
            <div style={{ fontSize: 10, color: C.muted + "88", marginTop: 4, textAlign: "center" }}>Or click to browse — up to 100 devices</div>
            {fileName && <div style={{ fontSize: 10, color: C.accent, marginTop: 8, fontFamily: mono }}>{fileName}</div>}
            <input ref={fileRef} type="file" accept=".md,.txt,.cfg,.conf" onChange={e => handleFile(e.target.files[0])} style={{ display: "none" }} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={sec}>Split Rule</span>
            <div style={{ display: "flex", gap: 0, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", background: C.surface }}>
              {[
                { id: "hr", label: "--- (hr)" },
                { id: "heading", label: "# heading" },
                { id: "custom", label: "custom" },
              ].map(r => (
                <button key={r.id} onClick={() => setSplitRule(r.id)} style={{
                  flex: 1, padding: "8px 4px", border: "none", cursor: "pointer",
                  background: splitRule === r.id ? C.accentDim : "transparent",
                  borderBottom: splitRule === r.id ? `2px solid ${C.accent}` : "2px solid transparent",
                  color: splitRule === r.id ? C.accent : C.muted,
                  fontSize: 10, fontWeight: 700, fontFamily: mono,
                  transition: "background .15s, color .15s",
                }}>
                  {r.label}
                </button>
              ))}
            </div>
            <input
              placeholder="e.g. ^!split or ^hostname\s+"
              style={{
                background: C.bg, border: `1px solid ${C.border}`, color: C.text,
                padding: "6px 10px", fontSize: 11, fontFamily: mono,
                outline: "none", borderRadius: 0,
                opacity: splitRule === "custom" ? 1 : 0.4,
                pointerEvents: splitRule === "custom" ? "auto" : "none",
              }}
              value={customRegex}
              onChange={e => setCustomRegex(e.target.value)}
            />
            <div style={{ fontSize: 10, color: C.muted + "88", lineHeight: 1.5 }}>
              {splitRule === "hr" && "Splits on lines with three or more dashes (---)"}
              {splitRule === "heading" && "Splits on markdown headings (#), uses heading text as name"}
              {splitRule === "custom" && "Lines matching this regex become split points"}
            </div>
          </div>
        </div>

        {/* Step 2: Preview */}
        {fileContent && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", background: C.raised, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <FileText style={{ width: 12, height: 12, color: C.accent }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: C.textBright, fontFamily: mono }}>{fileName}</span>
              </div>
              <span style={{ fontSize: 10, color: C.muted, fontFamily: mono }}>
                {configs.length} config{configs.length !== 1 ? "s" : ""} detected · {totalLines} lines
              </span>
            </div>
            <div style={{ maxHeight: 200, overflow: "auto", background: C.bg, padding: "8px 0", fontFamily: mono, fontSize: 11, lineHeight: "19px" }}>
              {fileContent.split("\n").map((line, i) => (
                <div key={i} style={{
                  padding: "0 12px",
                  background: splitPoints.has(i) ? C.accentDim : "transparent",
                  color: C.text, whiteSpace: "pre",
                }}>
                  {splitPoints.has(i)
                    ? <span style={{ color: C.accent, fontSize: 10, fontWeight: 700 }}>{"——— split ———"}{splitRule === "heading" ? ` (${line.replace(/^#+\s*/, "")})` : ""}</span>
                    : <HighlightedLine line={line} C={C} />
                  }
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Map configs to devices */}
        {configs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={sec}>Map Configs → Devices</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {configs.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
                }}>
                  <span style={{ fontSize: 10, color: C.muted + "88", fontFamily: mono, minWidth: 20 }}>{i + 1}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.textBright, fontFamily: mono, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span style={{ fontSize: 10, color: C.muted, fontFamily: mono, flexShrink: 0 }}>{c.lineCount} ln</span>
                  <span style={{ color: C.muted + "88", flexShrink: 0 }}>→</span>
                  <select
                    value={mappings[i] || ""}
                    onChange={e => setMappings(p => ({ ...p, [i]: e.target.value }))}
                    disabled={!devices}
                    style={{
                      background: mappings[i] ? C.blueDim : C.bg,
                      border: `0.5px solid ${mappings[i] ? "rgba(88,166,255,0.3)" : C.border}`,
                      color: mappings[i] ? C.blue : C.muted,
                      padding: "4px 8px", fontSize: 10, fontFamily: mono,
                      outline: "none", cursor: devices ? "pointer" : "not-allowed", minWidth: 120,
                    }}
                  >
                    <option value="">Select...</option>
                    {devices && Object.entries(devices).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([num, name]) => {
                      const taken = usedNums.has(num) && mappings[i] !== num;
                      return (
                        <option key={num} value={num} disabled={taken}>
                          [{num}] {name}{taken ? ` → ${configs.find((_, j) => mappings[j] === num)?.name || ""}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              ))}
            </div>

            {/* Summary bar */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
            }}>
              <span style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                <span style={{ color: C.textBright }}>{configs.length}</span> configs ·{" "}
                <span style={{ color: C.textBright }}>{mappedCount}</span>/{configs.length} mapped ·{" "}
                <span style={{ color: C.textBright }}>{totalLines}</span> lines
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                {mode === "console" && devices && (
                  <Btn icon={Zap} onClick={autoMap} style={{ padding: "5px 10px", fontSize: 10 }}>Auto-map</Btn>
                )}
                <button
                  onClick={handleImport}
                  disabled={!mappedCount}
                  style={{
                    background: mappedCount ? C.accent : C.muted + "33",
                    color: mappedCount ? "#000" : C.muted,
                    fontWeight: 500, fontSize: 12,
                    padding: "8px 20px", borderRadius: 6, border: "none",
                    cursor: mappedCount ? "pointer" : "not-allowed",
                    fontFamily: mono,
                  }}
                >
                  Import {mappedCount} mapped
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
