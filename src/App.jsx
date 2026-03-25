import { useState, useRef, useCallback } from "react";
import { Shield, Terminal, FileCode, Trash2, Download, Upload, Settings2, Play, RotateCcw, ShieldCheck, Wifi, PanelLeft, Sun, Moon, Archive } from "lucide-react";
import JSZip from "jszip";
import { useTheme, mono, sans, useViewport } from "./theme";
import { runCleanup, DEFAULT_OPTS, SAMPLE } from "./engine";
import { IcoBtn, Btn } from "./components/Shared";
import { CodePanel } from "./components/CodePanel";
import { SideBar } from "./components/SideBar";
import { RulesPanel } from "./components/RulesPanel";
import { LabPanel } from "./components/LabPanel";

// ── Helpers ──
const detectName = (text) => { const m = text.match(/^hostname\s+(\S+)/m); return m ? m[1] : ""; };
const makeId = () => Math.random().toString(36).slice(2, 8);
const makeFile = (name, raw) => ({ id: makeId(), name: name || detectName(raw) || "config", raw, clean: "" });

export default function App() {
  const { C, mode, toggle: toggleTheme } = useTheme();
  const vp = useViewport();
  const [files, setFiles] = useState([]);       // [{id, name, raw, clean}]
  const [activeId, setActiveId] = useState(null); // which tab is selected
  const [opts, setOpts] = useState(DEFAULT_OPTS);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [showLab, setShowLab] = useState(false);
  const [sideOpen, setSideOpen] = useState(!vp.phone);
  const fileRef = useRef(null);

  // ── Active file getters/setters ──
  const active = files.find(f => f.id === activeId) || null;
  const updateFile = useCallback((id, updates) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, []);

  // ── Add files (deduplicates by name) ──
  const addFiles = useCallback((newFiles) => {
    setFiles(prev => {
      const merged = [...prev];
      for (const nf of newFiles) {
        const existing = merged.findIndex(f => f.name === nf.name);
        if (existing >= 0) merged[existing] = { ...merged[existing], raw: nf.raw, clean: "" };
        else merged.push(nf);
      }
      return merged;
    });
    if (newFiles.length > 0) setActiveId(prev => prev || newFiles[0].id);
  }, []);

  // ── Upload (multi-file) ──
  const upload = (e) => {
    const uploaded = Array.from(e.target.files || []);
    if (!uploaded.length) return;
    const readers = uploaded.map(f => new Promise(resolve => {
      const r = new FileReader();
      r.onload = ev => {
        const text = ev.target.result;
        const name = detectName(text) || f.name.replace(/\.[^.]+$/, "");
        resolve(makeFile(name, text));
      };
      r.readAsText(f);
    }));
    Promise.all(readers).then(newFiles => {
      addFiles(newFiles);
      setActiveId(newFiles[0].id);
    });
    e.target.value = "";
  };

  // ── Load sample ──
  const loadSample = () => {
    const f = makeFile("", SAMPLE);
    addFiles([f]);
    setActiveId(f.id);
  };

  // ── Process current ──
  const processCurrent = () => {
    if (!active) return;
    setProcessing(true);
    setTimeout(() => {
      const cleaned = runCleanup(active.raw, opts);
      updateFile(active.id, { clean: cleaned });
      const rl = active.raw.split("\n").length, cl = cleaned.split("\n").length;
      setDone({ removed: rl - cl, output: cl });
      setProcessing(false);
      setTimeout(() => setDone(null), 4000);
    }, 200);
  };

  // ── Process all ──
  const processAll = () => {
    setProcessing(true);
    setTimeout(() => {
      let totalRemoved = 0, totalOutput = 0;
      setFiles(prev => prev.map(f => {
        const cleaned = runCleanup(f.raw, opts);
        totalRemoved += f.raw.split("\n").length - cleaned.split("\n").length;
        totalOutput += cleaned.split("\n").length;
        return { ...f, clean: cleaned };
      }));
      setDone({ removed: totalRemoved, output: totalOutput, batch: true });
      setProcessing(false);
      setTimeout(() => setDone(null), 4000);
    }, 200);
  };

  // ── Download current ──
  const downloadCurrent = () => {
    if (!active?.clean) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([active.clean], { type: "text/plain" }));
    a.download = `${active.name}-clean.txt`; a.click();
  };

  // ── Download all as zip ──
  const downloadAllZip = async () => {
    const cleaned = files.filter(f => f.clean);
    if (!cleaned.length) return;
    const zip = new JSZip();
    cleaned.forEach(f => zip.file(`${f.name}-clean.txt`, f.clean));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "configrefine-cleaned.zip"; a.click();
  };

  // ── Close tab ──
  const closeTab = (id) => {
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (activeId === id) setActiveId(next.length ? next[0].id : null);
      return next;
    });
  };

  // ── Lab config loader ──
  const loadLabConfig = (configs, deviceName) => {
    if (deviceName && configs[deviceName]) {
      // Single device click — add/update and switch to it
      const f = makeFile(deviceName, configs[deviceName]);
      addFiles([f]);
      setActiveId(f.id);
    } else if (configs && !deviceName) {
      // Batch load from pull
      const newFiles = Object.entries(configs).map(([name, raw]) => makeFile(name, raw));
      addFiles(newFiles);
      if (newFiles.length) setActiveId(newFiles[0].id);
    }
  };

  // ── Reset ──
  const reset = () => { setFiles([]); setActiveId(null); setDone(null); };

  const setCustomRules = fn => {
    const next = typeof fn === "function" ? fn(opts.customRules) : fn;
    setOpts(p => ({ ...p, customRules: next }));
  };

  const hasCleanedFiles = files.some(f => f.clean);

  return (
    <div style={{ fontFamily: sans, height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, overflow: "hidden", transition: "background .2s, color .2s" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* ── HEADER ── */}
      <header style={{ height: vp.phone ? 50 : 52, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: vp.phone ? "0 12px" : "0 20px", background: C.surface, zIndex: 50, transition: "background .2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {vp.phone && <IcoBtn icon={sideOpen ? Terminal : PanelLeft} label="Menu" onClick={() => setSideOpen(!sideOpen)} size={16} />}
          <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: C.accent, borderRadius: 0 }}>
            <Shield style={{ width: 17, height: 17, color: "#0a0e1a" }} />
          </div>
          <div>
            <div style={{ fontSize: vp.phone ? 13 : 15, fontWeight: 800, letterSpacing: -0.5, color: C.textBright }}>Config<span style={{ color: C.accent }}>Refine</span></div>
            {!vp.phone && <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 2.5, textTransform: "uppercase", color: C.muted, fontFamily: mono }}>Network Config Cleaner</div>}
          </div>
        </div>
        <IcoBtn icon={mode === "dark" ? Sun : Moon} label="Toggle theme" onClick={toggleTheme} size={16} />
      </header>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <SideBar opts={opts} setOpts={setOpts} open={sideOpen} setOpen={setSideOpen} vp={vp} />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: vp.phone ? 10 : 16, gap: vp.phone ? 10 : 12, overflow: "hidden" }}>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <span style={{ fontSize: vp.phone ? 14 : 16, fontWeight: 800, letterSpacing: -0.3, color: C.textBright }}>Workspace</span>
              {!vp.phone && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                {files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""} loaded` : "Paste, upload, or pull configs"}
              </div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <input type="file" ref={fileRef} accept=".txt,.cfg,.conf,.log" onChange={upload} style={{ display: "none" }} multiple />
              <Btn icon={Upload} onClick={() => fileRef.current?.click()}>Upload</Btn>
              <Btn icon={Wifi} onClick={() => { setShowLab(!showLab); if (!showLab) setShowRules(false); }} active={showLab}>Lab</Btn>
              <Btn icon={Settings2} onClick={() => { setShowRules(!showRules); if (!showRules) setShowLab(false); }} active={showRules}>Rules</Btn>
              <Btn icon={RotateCcw} onClick={reset}>Reset</Btn>
              {files.length > 1 && <Btn icon={Play} onClick={processAll} disabled={processing}>All</Btn>}
              <Btn icon={processing ? null : Play} onClick={processCurrent} primary disabled={!active?.raw || processing}>{processing ? "Working..." : "Process"}</Btn>
              {hasCleanedFiles && files.length > 1 && <Btn icon={Archive} onClick={downloadAllZip}>Zip</Btn>}
            </div>
          </div>

          {done && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: C.greenDim, border: "1px solid rgba(52,211,153,0.15)", animation: "fadeIn .25s ease" }}>
              <ShieldCheck style={{ width: 15, height: 15, color: C.green }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>{done.batch ? "All processed" : "Done"}</span>
              <div style={{ height: 12, width: 1, background: "rgba(52,211,153,0.2)" }} />
              <span style={{ fontSize: 10, color: C.muted }}>{done.removed} lines removed · {done.output} lines output</span>
            </div>
          )}

          <div style={{ flex: 1, display: "grid", minHeight: 0, gridTemplateColumns: vp.phone ? "1fr" : "1fr 1fr", gridTemplateRows: vp.phone ? "1fr 1fr" : "1fr", gap: vp.phone ? 8 : 12 }}>
            <CodePanel label="Input" value={active?.raw || ""} onChange={v => active && updateFile(active.id, { raw: v })} vp={vp}
              files={files} activeId={activeId} onTabClick={setActiveId} onTabClose={closeTab}
              actions={<>
                <Btn icon={FileCode} onClick={loadSample} style={{ padding: "3px 8px", fontSize: 9 }}>SAMPLE</Btn>
                <IcoBtn icon={Trash2} label="Clear" onClick={() => active && updateFile(active.id, { raw: "", clean: "" })} />
              </>} />
            <CodePanel label="Output" tag="CLEAN" value={active?.clean || ""} readOnly vp={vp}
              actions={<IcoBtn icon={Download} label="Download" onClick={downloadCurrent} disabled={!active?.clean} />} />
          </div>
        </div>

        {showRules && <RulesPanel rules={opts.customRules} setRules={setCustomRules} onClose={() => setShowRules(false)} vp={vp} />}
        {showLab && <LabPanel onClose={() => setShowLab(false)} onConfigsPulled={loadLabConfig} vp={vp} />}
      </main>

      {!vp.phone && (
        <footer style={{ height: 28, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 20px", background: C.surface, transition: "background .2s" }}>
          <span style={{ fontSize: 8, color: C.muted + "66" }}>© 2026 Daniel Okoro · ConfigRefine</span>
        </footer>
      )}

      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${C.muted}33;border-radius:0}
        textarea::placeholder{color:${C.muted}55}button{font-family:${sans}}select{font-family:${sans}}
      `}</style>
    </div>
  );
}