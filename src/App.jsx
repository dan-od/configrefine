import { useRef, useState, useEffect } from "react";
import {
  Shield, FileCode, Trash2, Download, Upload, Settings2, Play,
  RotateCcw, ShieldCheck, Wifi, Sun, Moon, Archive, Terminal, X, Check,
} from "lucide-react";
import { useTheme, mono, sans, useViewport } from "./theme";
import { DEFAULT_OPTS } from "./engine";
import { IcoBtn, Btn, Toggle } from "./components/Shared";
import { CodePanel } from "./components/CodePanel";
import { SideBar } from "./components/SideBar";
import { RulesPanel } from "./components/RulesPanel";
import { LabPanel } from "./components/LabPanel";
import { EmptyState } from "./components/EmptyState";
import { BottomNav } from "./components/BottomNav";
import { BottomSheet } from "./components/BottomSheet";
import { useFiles } from "./hooks/useFiles";
import { useProcessor } from "./hooks/useProcessor";
import { downloadSingle, downloadAllZip } from "./utils/downloads";

export default function App() {
  const { C, mode, toggle: toggleTheme } = useTheme();
  const vp = useViewport();
  const [opts, setOpts] = useState(DEFAULT_OPTS);

  // Desktop panel states
  const [showRules, setShowRules] = useState(false);
  const [showLab, setShowLab] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);

  // Mobile states
  const [mobileTab, setMobileTab] = useState("work"); // "work" | "rules" | "ssh"
  const [mobileView, setMobileView] = useState("input"); // "input" | "output"
  const [mobileTabHov, setMobileTabHov] = useState(null);

  const fileRef = useRef(null);
  const textareaRef = useRef(null);

  const {
    files, setFiles, activeId, setActiveId, active,
    updateFile, addFiles, handleUpload, loadSample,
    closeTab, reset, loadLabConfig,
  } = useFiles();

  const { processing, done, processCurrent, processAll } =
    useProcessor(files, setFiles, active, updateFile);

  // Auto-switch to output view when processing completes on mobile
  useEffect(() => {
    if (done && vp.phone) setMobileView("output");
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasCleanedFiles = files.some(f => f.clean);

  // Toggle helper for rules opts (used both in SideBar and mobile rules sheet)
  const toggleOpt = k => setOpts(p => ({ ...p, [k]: !p[k] }));

  const openLab = () => {
    if (vp.phone) { setMobileTab("ssh"); }
    else { setShowLab(true); setShowRules(false); }
  };
  const openRules = () => {
    if (vp.phone) { setMobileTab("rules"); }
    else { setShowRules(true); setShowLab(false); }
  };

  // ── MOBILE LAYOUT ────────────────────────────────────────────────────────
  if (vp.phone) {
    return (
      <div style={{ fontFamily: sans, height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, overflow: "hidden", transition: "background .2s, color .2s" }}>

        {/* ── HEADER ── */}
        <header style={{ height: 50, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", background: C.surface, zIndex: 50, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: C.accent, borderRadius: 0 }}>
              <Shield style={{ width: 17, height: 17, color: "#0a0e1a" }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: -0.5, color: C.textBright }}>
              Config<span style={{ color: C.accent }}>Refine</span>
            </div>
            {files.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, color: C.green, fontFamily: mono }}>
                {files.length} file{files.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <IcoBtn icon={mode === "dark" ? Sun : Moon} label="Toggle theme" onClick={toggleTheme} size={16} />
        </header>

        {/* ── MAIN CONTENT ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", paddingBottom: "calc(56px + env(safe-area-inset-bottom, 0px))" }}>

          {/* File tabs — horizontal scroll, only when files exist */}
          {files.length > 0 && (
            <div
              data-scroll
              style={{
                display: "flex", alignItems: "center",
                borderBottom: `1px solid ${C.border}`,
                background: C.bg, overflowX: "auto", flexShrink: 0,
                WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
              }}
            >
              {files.map(f => {
                const isActive = f.id === activeId;
                return (
                  <div key={f.id} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "6px 8px 6px 10px",
                    borderRight: `1px solid ${C.border}`,
                    background: isActive ? C.surface : "transparent",
                    borderBottom: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
                    cursor: "pointer", flexShrink: 0, maxWidth: 160,
                  }}>
                    <span
                      onClick={() => setActiveId(f.id)}
                      style={{
                        fontSize: 10, fontWeight: isActive ? 700 : 500,
                        color: isActive ? C.textBright : C.muted,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        fontFamily: mono, flex: 1,
                      }}
                    >
                      {f.name}
                    </span>
                    {f.clean && (
                      <div style={{ width: 4, height: 4, borderRadius: 99, background: C.green, flexShrink: 0 }} title="Processed" />
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); closeTab(f.id); }}
                      title="Close"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 20, height: 20, minWidth: 20, border: "none",
                        background: "transparent", color: C.muted, cursor: "pointer",
                        padding: 0, touchAction: "manipulation",
                      }}
                    >
                      <X style={{ width: 10, height: 10 }} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Input / Output segmented toggle — only when files exist */}
          {files.length > 0 && (
            <div style={{ display: "flex", padding: 2, background: C.bg, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              {["input", "output"].map(v => {
                const isActive = mobileView === v;
                return (
                  <button
                    key={v}
                    onClick={() => setMobileView(v)}
                    style={{
                      flex: 1, textAlign: "center", fontSize: 10, fontWeight: 700,
                      fontFamily: mono, padding: 6, border: "none", cursor: "pointer",
                      background: isActive ? C.accentDim : "transparent",
                      color: isActive ? C.accent : C.muted,
                      borderBottom: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
                      transition: "background .15s, color .15s",
                    }}
                  >
                    {v.toUpperCase()}
                  </button>
                );
              })}
            </div>
          )}

          {/* Done banner */}
          {done && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", background: C.greenDim, border: "none", borderBottom: `1px solid rgba(52,211,153,0.15)`, flexShrink: 0 }}>
              <Check style={{ width: 13, height: 13, color: C.green, flexShrink: 0 }} />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: C.green }}>Done</span>
              <span style={{ fontSize: 9.5, color: C.muted }}>· {done.removed} lines removed · {done.output} lines output</span>
            </div>
          )}

          {/* Editor area — fills remaining height */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {files.length === 0 ? (
              <EmptyState
                onPaste={() => {
                  const id = Math.random().toString(36).slice(2, 8);
                  addFiles([{ id, name: "config", raw: "", clean: "" }]);
                  setActiveId(id);
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }}
                onUpload={() => fileRef.current?.click()}
                onPull={openLab}
                onSample={loadSample}
              />
            ) : mobileView === "input" ? (
              <CodePanel
                label="Input" value={active?.raw || ""} vp={vp}
                hideHeader
                textareaRef={textareaRef}
                onChange={v => {
                  if (active) {
                    updateFile(active.id, { raw: v, name: (v.match(/^hostname\s+(\S+)/m)?.[1]) || active.name });
                  } else {
                    const name = v.match(/^hostname\s+(\S+)/m)?.[1] || "config";
                    const id = Math.random().toString(36).slice(2, 8);
                    const f = { id, name, raw: v, clean: "" };
                    addFiles([f]);
                    setActiveId(f.id);
                  }
                }}
              />
            ) : (
              <CodePanel
                label="Output" tag="CLEAN" value={active?.clean || ""} readOnly vp={vp}
                hideHeader
                onSave={() => active && downloadSingle(active.name, active.clean)}
              />
            )}
          </div>
        </div>

        {/* Hidden file input */}
        <input type="file" ref={fileRef} accept=".txt,.cfg,.conf,.log" onChange={handleUpload} style={{ display: "none" }} multiple />

        {/* ── Bottom Nav ── */}
        <BottomNav
          mobileTab={mobileTab}
          setMobileTab={setMobileTab}
          processing={processing}
          done={done}
          onGo={() => files.length > 1 ? processAll(opts) : processCurrent(opts)}
        />

        {/* ── Rules bottom sheet ── */}
        {mobileTab === "rules" && (
          <BottomSheet onClose={() => setMobileTab("work")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", padding: "4px 12px 4px", fontFamily: mono }}>Terminal</div>
              <Toggle compact on={opts.stripCliArtifacts} onToggle={() => toggleOpt("stripCliArtifacts")} label="CLI Artifacts" desc="Prompts, errors, ^ markers" />
              <Toggle compact on={opts.deduplicateConfig} onToggle={() => toggleOpt("deduplicateConfig")} label="Deduplicate" desc="Repeated config from retries" />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 12px 4px" }}>
                <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>Strip Sections</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {["All", "None"].map(lbl => (
                    <button key={lbl}
                      onClick={() => {
                        const v = lbl === "All";
                        setOpts(p => ({ ...p, stripServices: v, stripSecurity: v, stripLicensing: v, stripMgmtPlane: v, stripQos: v, stripHardware: v }));
                      }}
                      style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", fontFamily: mono }}
                    >{lbl}</button>
                  ))}
                </div>
              </div>
              <Toggle compact on={opts.stripServices}   onToggle={() => toggleOpt("stripServices")}   label="Service & Platform"  desc="Timestamps, call-home svc, platform" />
              <Toggle compact on={opts.stripSecurity}   onToggle={() => toggleOpt("stripSecurity")}   label="Security & Crypto"   desc="AAA, PKI trustpoints, certificates" />
              <Toggle compact on={opts.stripLicensing}  onToggle={() => toggleOpt("stripLicensing")}  label="Smart Licensing"     desc="Call-home block, license lines" />
              <Toggle compact on={opts.stripMgmtPlane}  onToggle={() => toggleOpt("stripMgmtPlane")}  label="Management Plane"    desc="Mgmt VRF, mgmt interfaces, HTTP" />
              <Toggle compact on={opts.stripQos}        onToggle={() => toggleOpt("stripQos")}        label="QoS Policies"        desc="Class-maps, policy-maps" />
              <Toggle compact on={opts.stripHardware}   onToggle={() => toggleOpt("stripHardware")}   label="Hardware & Infra"    desc="Redundancy, transceiver, diagnostic" />

              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", padding: "12px 12px 4px", fontFamily: mono }}>Formatting</div>
              <Toggle compact on={opts.removeBoilerplate}    onToggle={() => toggleOpt("removeBoilerplate")}    label="Boilerplate"      desc="'Building config...', version line" />
              <Toggle compact on={opts.normalizeWhitespace}  onToggle={() => toggleOpt("normalizeWhitespace")}  label="Normalize Space"  desc="Collapse blank & consecutive ! lines" />
              <Toggle compact on={opts.sortInterfaces}       onToggle={() => toggleOpt("sortInterfaces")}       label="Sort Interfaces"  desc="Alphabetize interface blocks" />
            </div>
          </BottomSheet>
        )}

        {/* ── SSH bottom sheet ── */}
        {mobileTab === "ssh" && (
          <BottomSheet onClose={() => setMobileTab("work")}>
            <LabPanel
              inSheet
              onClose={() => setMobileTab("work")}
              onConfigsPulled={(configs, name) => { loadLabConfig(configs, name); setMobileTab("work"); }}
              files={files}
              vp={vp}
            />
          </BottomSheet>
        )}

        <style>{`
          @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
          @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
          *{box-sizing:border-box;margin:0;padding:0}
          ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}
          ::-webkit-scrollbar-thumb{background:${C.muted}33;border-radius:0}
          textarea::placeholder{color:${C.muted}55}button{font-family:${sans}}select{font-family:${sans}}
          [data-scroll]::-webkit-scrollbar{display:none}
        `}</style>
      </div>
    );
  }

  // ── DESKTOP LAYOUT ───────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: sans, height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, overflow: "hidden", transition: "background .2s, color .2s" }}>

      {/* ── HEADER ── */}
      <header style={{ height: 52, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", background: C.surface, zIndex: 50, flexShrink: 0, transition: "background .2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: C.accent, borderRadius: 0 }}>
            <Shield style={{ width: 17, height: 17, color: "#0a0e1a" }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.5, color: C.textBright }}>
              Config<span style={{ color: C.accent }}>Refine</span>
            </div>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 2.5, textTransform: "uppercase", color: C.muted, fontFamily: mono }}>
              Network Config Cleaner
            </div>
          </div>
        </div>
        <IcoBtn icon={mode === "dark" ? Sun : Moon} label="Toggle theme" onClick={toggleTheme} size={16} />
      </header>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        <SideBar opts={opts} setOpts={setOpts} open={sideOpen} setOpen={setSideOpen} vp={vp} />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 12, overflow: "hidden", minWidth: 0 }}>

          {/* ── Toolbar ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
            <div style={{ flexShrink: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.3, color: C.textBright }}>Workspace</span>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                {files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""} loaded` : "Paste, upload, or pull configs"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <input type="file" ref={fileRef} accept=".txt,.cfg,.conf,.log" onChange={handleUpload} style={{ display: "none" }} multiple />
              <Btn icon={Upload} onClick={() => fileRef.current?.click()} title="Upload config files">Upload</Btn>
              <Btn icon={Wifi} onClick={openLab} active={showLab} title="Pull or push configs via SSH">SSH</Btn>
              <Btn icon={Settings2} onClick={openRules} active={showRules} title="Add custom regex rules">Rules</Btn>
              <Btn icon={RotateCcw} onClick={reset} title="Clear all files">Reset</Btn>
              {files.length > 1 && (
                <Btn icon={Play} onClick={() => processAll(opts)} disabled={processing} title="Process all files">All</Btn>
              )}
              <Btn icon={processing ? null : Play} onClick={() => processCurrent(opts)} primary
                disabled={!active?.raw || processing} title="Process active file">
                {processing ? "Working..." : "Process"}
              </Btn>
              {hasCleanedFiles && files.length > 1 && (
                <Btn icon={Archive} onClick={() => downloadAllZip(files)} title="Download all cleaned configs as zip">Zip</Btn>
              )}
            </div>
          </div>

          {/* ── Done banner ── */}
          {done && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: C.greenDim, border: "1px solid rgba(52,211,153,0.15)", animation: "fadeIn .25s ease", flexShrink: 0 }}>
              <ShieldCheck style={{ width: 15, height: 15, color: C.green }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>{done.batch ? "All processed" : "Done"}</span>
              <div style={{ height: 12, width: 1, background: "rgba(52,211,153,0.2)" }} />
              <span style={{ fontSize: 10, color: C.muted }}>{done.removed} lines removed · {done.output} lines output</span>
            </div>
          )}

          {/* ── Workspace area ── */}
          {files.length === 0 ? (
            <EmptyState
              onPaste={() => {
                const id = Math.random().toString(36).slice(2, 8);
                addFiles([{ id, name: "config", raw: "", clean: "" }]);
                setActiveId(id);
                setTimeout(() => textareaRef.current?.focus(), 0);
              }}
              onUpload={() => fileRef.current?.click()}
              onPull={openLab}
              onSample={loadSample}
            />
          ) : (
            <div style={{ flex: 1, display: "grid", minHeight: 0, gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <CodePanel
                label="Input" value={active?.raw || ""} vp={vp}
                textareaRef={textareaRef}
                onChange={v => {
                  if (active) {
                    updateFile(active.id, { raw: v, name: (v.match(/^hostname\s+(\S+)/m)?.[1]) || active.name });
                  } else {
                    const name = v.match(/^hostname\s+(\S+)/m)?.[1] || "config";
                    const id = Math.random().toString(36).slice(2, 8);
                    const f = { id, name, raw: v, clean: "" };
                    addFiles([f]);
                    setActiveId(f.id);
                  }
                }}
                files={files} activeId={activeId} onTabClick={setActiveId} onTabClose={closeTab}
                actions={<>
                  <Btn icon={FileCode} onClick={loadSample} title="Load sample config" style={{ padding: "3px 8px", fontSize: 9 }}>SAMPLE</Btn>
                  <IcoBtn icon={Trash2} label="Clear input" onClick={() => active && updateFile(active.id, { raw: "", clean: "" })} />
                </>}
              />
              <CodePanel
                label="Output" tag="CLEAN" value={active?.clean || ""} readOnly vp={vp}
                actions={<IcoBtn icon={Download} label="Download cleaned config" onClick={() => active && downloadSingle(active.name, active.clean)} disabled={!active?.clean} />}
              />
            </div>
          )}
        </div>

        {showRules && (
          <RulesPanel rules={opts.customRules} setRules={fn => {
            const next = typeof fn === "function" ? fn(opts.customRules) : fn;
            setOpts(p => ({ ...p, customRules: next }));
          }} onClose={() => setShowRules(false)} vp={vp} />
        )}
        {showLab && (
          <LabPanel onClose={() => setShowLab(false)} onConfigsPulled={loadLabConfig} files={files} vp={vp} />
        )}
      </main>

      <footer style={{ height: 28, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 20px", background: C.surface, flexShrink: 0, transition: "background .2s" }}>
        <span style={{ fontSize: 8, color: C.muted + "66" }}>© 2026 Daniel Okoro · ConfigRefine</span>
      </footer>

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
