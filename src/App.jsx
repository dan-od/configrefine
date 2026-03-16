import { useState, useRef } from "react";
import { Shield, Terminal, FileCode, Trash2, Download, Upload, Settings2, Play, RotateCcw, ShieldCheck, Wifi, PanelLeft } from "lucide-react";
import { C, mono, sans, useViewport } from "./theme";
import { runCleanup, DEFAULT_OPTS, SAMPLE } from "./engine";
import { IcoBtn, Btn } from "./components/Shared";
import { CodePanel } from "./components/CodePanel";
import { SideBar } from "./components/SideBar";
import { RulesPanel } from "./components/RulesPanel";
import { LabPanel } from "./components/LabPanel";

export default function App() {
  const vp = useViewport();
  const [raw, setRaw] = useState("");
  const [clean, setClean] = useState("");
  const [opts, setOpts] = useState(DEFAULT_OPTS);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [showLab, setShowLab] = useState(false);
  const [sideOpen, setSideOpen] = useState(!vp.phone);
  const [deviceName, setDeviceName] = useState(""); // tracks current device for filenames
  const fileRef = useRef(null);

  // Detect hostname from config text
  const detectName = (text) => {
    const m = text.match(/^hostname\s+(\S+)/m);
    return m ? m[1] : "";
  };

  const process = () => {
    if (!raw) return;
    setProcessing(true);
    // Auto-detect device name if not already set
    if (!deviceName) setDeviceName(detectName(raw));
    setTimeout(() => {
      const r = runCleanup(raw, opts);
      setClean(r);
      const rl = raw.split("\n").length, cl = r.split("\n").length;
      setDone({ removed: rl - cl, output: cl });
      setProcessing(false);
      setTimeout(() => setDone(null), 4000);
    }, 300);
  };

  const download = () => {
    if (!clean) return;
    const name = deviceName || detectName(clean) || "cleaned_config";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([clean], { type: "text/plain" }));
    a.download = `${name}-clean.txt`; a.click();
  };

  const upload = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const text = ev.target.result;
      setRaw(text);
      setDeviceName(detectName(text));
    };
    r.readAsText(f);
    e.target.value = "";
  };

  const setCustomRules = fn => {
    const next = typeof fn === "function" ? fn(opts.customRules) : fn;
    setOpts(p => ({ ...p, customRules: next }));
  };

  const loadLabConfig = (configs, name) => {
    if (name && configs[name]) {
      setRaw(configs[name]);
      setDeviceName(name);
      setClean(""); setDone(null);
    }
  };

  return (
    <div style={{ fontFamily: sans, height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* ── HEADER ── */}
      <header style={{ height: vp.phone ? 50 : 52, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: vp.phone ? "0 12px" : "0 20px", background: C.surface, zIndex: 50 }}>
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", border: `1px solid ${C.border}`, background: C.bg }}>
            <Terminal style={{ width: 11, height: 11, color: C.accent }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: C.muted, fontFamily: mono }}>v2</span>
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <SideBar opts={opts} setOpts={setOpts} open={sideOpen} setOpen={setSideOpen} vp={vp} />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: vp.phone ? 10 : 16, gap: vp.phone ? 10 : 12, overflow: "hidden" }}>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: vp.phone ? 14 : 16, fontWeight: 800, letterSpacing: -0.3, color: C.textBright }}>Workspace</span>
              </div>
              {!vp.phone && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Paste or upload → transform → download clean output</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <input type="file" ref={fileRef} accept=".txt,.cfg,.conf,.log" onChange={upload} style={{ display: "none" }} />
              <Btn icon={Upload} onClick={() => fileRef.current?.click()}>Upload</Btn>
              <Btn icon={Wifi} onClick={() => { setShowLab(!showLab); if (!showLab) setShowRules(false); }} active={showLab}>Lab</Btn>
              <Btn icon={Settings2} onClick={() => { setShowRules(!showRules); if (!showRules) setShowLab(false); }} active={showRules}>Rules</Btn>
              <Btn icon={RotateCcw} onClick={() => { setRaw(""); setClean(""); setDone(null); setDeviceName(""); }}>Reset</Btn>
              <Btn icon={processing ? null : Play} onClick={process} primary disabled={!raw || processing}>{processing ? "Working..." : "Process"}</Btn>
            </div>
          </div>

          {done && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: C.greenDim, border: "1px solid rgba(52,211,153,0.15)", animation: "fadeIn .25s ease" }}>
              <ShieldCheck style={{ width: 15, height: 15, color: C.green }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>Done</span>
              <div style={{ height: 12, width: 1, background: "rgba(52,211,153,0.2)" }} />
              <span style={{ fontSize: 10, color: C.muted }}>{done.removed} lines removed · {done.output} lines output</span>
            </div>
          )}

          <div style={{ flex: 1, display: "grid", minHeight: 0, gridTemplateColumns: vp.phone ? "1fr" : "1fr 1fr", gridTemplateRows: vp.phone ? "1fr 1fr" : "1fr", gap: vp.phone ? 8 : 12 }}>
            <CodePanel label="Input" value={raw} onChange={setRaw} vp={vp}
              actions={<><Btn icon={FileCode} onClick={() => setRaw(SAMPLE)} style={{ padding: "3px 8px", fontSize: 9 }}>SAMPLE</Btn><IcoBtn icon={Trash2} label="Clear" onClick={() => setRaw("")} /></>} />
            <CodePanel label="Output" tag="CLEAN" value={clean} readOnly vp={vp}
              actions={<IcoBtn icon={Download} label="Download" onClick={download} disabled={!clean} />} />
          </div>
        </div>

        {showRules && <RulesPanel rules={opts.customRules} setRules={setCustomRules} onClose={() => setShowRules(false)} vp={vp} />}
        {showLab && <LabPanel onClose={() => setShowLab(false)} onConfigsPulled={loadLabConfig} vp={vp} />}
      </main>

      {/* ── FOOTER ── */}
      {!vp.phone && (
        <footer style={{ height: 28, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 20px", background: C.surface }}>
          <span style={{ fontSize: 8, color: C.muted + "66" }}>ConfigRefine · 2026</span>
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
