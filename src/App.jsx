import { useRef, useState, useEffect, useCallback } from "react";
import {
  FileCode, Trash2, Download, Upload, Settings2, Play,
  RotateCcw, ShieldCheck, Wifi, Sun, Moon, Terminal, X, Check,
  ChevronDown,
} from "lucide-react";
import { useTheme, mono, sans, useViewport } from "./theme";
import { DEFAULT_OPTS, isClean } from "./engine";
import { IcoBtn, Btn, Toggle } from "./components/Shared";
import { CodePanel } from "./components/CodePanel";
import { SideBar } from "./components/SideBar";
import { RulesPanel } from "./components/RulesPanel";
import { LabPanel } from "./components/LabPanel";
import { EmptyState } from "./components/EmptyState";
import { BottomNav } from "./components/BottomNav";
import { BottomSheet } from "./components/BottomSheet";
import { BulkUploadModal } from "./components/BulkUploadModal";
import { PostPullBar } from "./components/PostPullBar";
import { SplitPreview } from "./components/SplitPreview";
import { Logo } from "./components/Logo";
import { useFiles, makeFile } from "./hooks/useFiles";
import { useProcessor } from "./hooks/useProcessor";
import { usePodConnection } from "./hooks/usePodConnection";
import { useSessionPersistence } from "./hooks/useSessionPersistence";
import { downloadSingle, downloadIndividually, downloadAllZip } from "./utils/downloads";

export default function App() {
  const { C, mode, toggle: toggleTheme } = useTheme();
  const vp = useViewport();
  const [opts, setOpts] = useState(DEFAULT_OPTS);
  const persistence = useSessionPersistence();

  // Desktop panel states
  const [showRules, setShowRules] = useState(false);
  const [showLab, setShowLab] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const [labAction, setLabAction] = useState("pull");
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  // Post-pull action bar
  const [showPostPull, setShowPostPull] = useState(false);
  const [pullCount, setPullCount] = useState(0);
  const prevFileCount = useRef(0);

  // Mobile states
  const [mobileTab, setMobileTab] = useState("work"); // "work" | "rules" | "ssh"
  const [mobileView, setMobileView] = useState("input"); // "input" | "output"
  const [mobileTabHov, setMobileTabHov] = useState(null);

  const fileRef = useRef(null);
  const textareaRef = useRef(null);

  const {
    files, setFiles, activeId, setActiveId, active,
    updateFile, addFiles, handleUpload, loadSample,
    closeTab, reset, loadLabConfig, autoMap,
    pendingSplit, confirmSplit, cancelSplit,
  } = useFiles();

  // Output tab state — independent of input tabs
  const [outputActiveId, setOutputActiveId] = useState(null);
  const [dlOpen, setDlOpen] = useState(false);
  const dlRef = useRef(null);

  const { processing, done, setDone, processCurrent, processAll, runInWorker } =
    useProcessor(files, setFiles, active, updateFile);

  // Derived: output files are files with clean content; output active tracks independently
  const outputFiles = files.filter(f => f.clean);
  const outputActive = outputFiles.find(f => f.id === outputActiveId) ?? outputFiles[0] ?? null;
  // Files with isClean badge for input tabs
  const inputFilesWithBadge = files.map(f => ({ ...f, badge: isClean(f.raw) ? "Clean" : null }));

  const pod = usePodConnection(persistence);
  const podLabel = pod.connected ? (pod.session.pod ? `POD ${pod.session.pod}` : "POD") : null;

  // Track when configs are pulled to show post-pull bar
  const onConfigsPulled = useCallback((configs, name) => {
    const count = name ? 1 : Object.keys(configs).length;
    loadLabConfig(configs, name);
    setPullCount(prev => prev + count);
    setShowPostPull(true);
    if (pod.devices) {
      const remembered = persistence.loadDeviceMapping(pod.session?.pod);
      autoMap(pod.devices, remembered);
    }
  }, [loadLabConfig, autoMap, pod.devices, persistence, pod.session?.pod]);

  // Restore toast — shown briefly when session is restored from storage
  const [restoreToast, setRestoreToast] = useState(null);
  useEffect(() => {
    if (pod.restored) {
      setRestoreToast("Session restored");
      const t = setTimeout(() => setRestoreToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [pod.restored]);

  // Workspace persistence — save on meaningful changes (debounced in the hook)
  useEffect(() => {
    if (files.length === 0) return;
    persistence.saveWorkspace(pod.session?.pod, {
      files: files.map(f => ({ id: f.id, name: f.name, raw: f.raw, clean: f.clean })),
      activeId,
      labAction,
    });
  }, [files, activeId, labAction, pod.session?.pod, persistence]);

  // Rehydrate workspace from localStorage on mount
  useEffect(() => {
    const saved = persistence.loadWorkspace(pod.session?.pod);
    if (!saved?.files?.length) return;
    const restoredFiles = saved.files.filter(f => f.raw);
    if (restoredFiles.length === 0) return;
    addFiles(restoredFiles);
    if (saved.activeId) setActiveId(saved.activeId);
    if (saved.labAction) setLabAction(saved.labAction);
    setRestoreToast(`Restored ${restoredFiles.length} config${restoredFiles.length !== 1 ? "s" : ""} from last session`);
    const t = setTimeout(() => setRestoreToast(null), 5000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-map files to devices when device list loads
  useEffect(() => {
    if (pod.devices && files.some(f => !f.deviceNum)) {
      const remembered = persistence.loadDeviceMapping(pod.session?.pod);
      autoMap(pod.devices, remembered);
    }
  }, [pod.devices]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-switch to output view when processing completes
  useEffect(() => {
    if (done) {
      if (vp.phone) setMobileView("output");
      if (done.batch && outputFiles.length > 0 && !outputActiveId) {
        setOutputActiveId(outputFiles[0].id);
      }
    }
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close download dropdown on outside click / Esc
  useEffect(() => {
    if (!dlOpen) return;
    const onKey = e => { if (e.key === "Escape") setDlOpen(false); };
    const onClick = e => { if (dlRef.current && !dlRef.current.contains(e.target)) setDlOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [dlOpen]);

  // Callback for Clean All — sets output active to first file
  const handleCleanAll = useCallback(() => {
    processAll(opts, (updated) => {
      if (updated.length) setOutputActiveId(updated[0].id);
    });
  }, [processAll, opts]);

  const handleBulkImport = useCallback((configs) => {
    const newFiles = configs.map(c => {
      const f = makeFile(c.name, c.content);
      if (c.deviceNum) f.deviceNum = c.deviceNum;
      return f;
    });
    addFiles(newFiles);
    if (newFiles.length) setActiveId(newFiles[0].id);
    if (pod.devices) {
      const remembered = persistence.loadDeviceMapping(pod.session?.pod);
      autoMap(pod.devices, remembered);
    }
  }, [addFiles, setActiveId, autoMap, pod.devices, persistence, pod.session?.pod]);

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
            <Logo size={32} />
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
                label="Output" tag="CLEAN" value={outputActive?.clean || ""} readOnly vp={vp}
                hideHeader
                onSave={() => outputActive && downloadSingle(outputActive.name, outputActive.clean)}
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
          podConnected={pod.connected}
          processing={processing}
          done={done}
          onGo={() => files.length > 1 ? handleCleanAll() : processCurrent(opts)}
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
              onConfigsPulled={(configs, name) => { onConfigsPulled(configs, name); setMobileTab("work"); }}
              files={files}
              updateFile={updateFile}
              vp={vp}
              pod={pod}
              action={labAction}
              setAction={setLabAction}
              persistence={persistence}
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
          <Logo size={32} />
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
              <Btn icon={Upload} onClick={() => setShowBulkUpload(true)} title="Upload config files">Upload</Btn>
              <Btn icon={Wifi} onClick={openLab} active={showLab} title={podLabel ? `SSH — connected to ${podLabel} (${pod.session.host})` : "Pull or push configs via SSH"}>
                SSH
                {podLabel && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, fontFamily: mono, color: C.green }}>
                    <span style={{ width: 5, height: 5, background: C.green }} />{podLabel}
                  </span>
                )}
              </Btn>
              <Btn icon={Settings2} onClick={openRules} active={showRules} title="Add custom regex rules">Rules</Btn>
              <Btn icon={RotateCcw} onClick={reset} title="Clear all files">Reset</Btn>
              {files.length > 1 && (
                <Btn onClick={handleCleanAll} disabled={processing} title="Clean all loaded files">Clean All</Btn>
              )}
              <Btn icon={processing ? null : Play} onClick={() => processCurrent(opts, (id) => setOutputActiveId(id))} primary
                disabled={!active?.raw || processing} title="Process active file">
                {processing ? "Working..." : "Process"}
              </Btn>
            </div>
          </div>

          {/* ── Done banner ── */}
          {done && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: C.greenDim, border: "1px solid rgba(52,211,153,0.15)", animation: "fadeIn .25s ease", flexShrink: 0 }}>
              <ShieldCheck style={{ width: 15, height: 15, color: C.green }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>
                {done.batch ? `${done.count} device${done.count !== 1 ? "s" : ""} cleaned` : "Done"}
              </span>
              <div style={{ height: 12, width: 1, background: "rgba(52,211,153,0.2)" }} />
              <span style={{ fontSize: 10, color: C.muted }}>
                {done.removed > 0 ? `${done.removed} lines removed · ` : ""}{done.output} lines output
              </span>
            </div>
          )}

          {/* ── Post-pull action bar ── */}
          {showPostPull && pullCount > 0 && files.length > 0 && (
            <PostPullBar
              pulledCount={pullCount}
              files={files}
              setFiles={setFiles}
              onCleanAll={handleCleanAll}
              onReClean={handleCleanAll}
              onDismiss={() => { setShowPostPull(false); setPullCount(0); }}
            />
          )}

          {/* ── Workspace area ── */}
          {showBulkUpload ? (
            <BulkUploadModal
              devices={pod.devices}
              onImport={handleBulkImport}
              onClose={() => setShowBulkUpload(false)}
            />
          ) : files.length === 0 ? (
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
                files={inputFilesWithBadge} activeId={activeId} onTabClick={setActiveId} onTabClose={closeTab}
                actions={<>
                  <Btn icon={Upload} onClick={() => setShowBulkUpload(true)} title="Bulk upload multi-device config file" style={{ padding: "3px 8px", fontSize: 9 }}>BULK</Btn>
                  <Btn icon={FileCode} onClick={loadSample} title="Load sample config" style={{ padding: "3px 8px", fontSize: 9 }}>SAMPLE</Btn>
                  <IcoBtn icon={Trash2} label="Clear input" onClick={() => active && updateFile(active.id, { raw: "", clean: "" })} />
                </>}
              />
              <CodePanel
                label="Output" tag="CLEAN"
                value={outputActive?.clean || ""}
                readOnly vp={vp}
                files={outputFiles.length > 0 ? outputFiles : undefined}
                activeId={outputActive?.id}
                onTabClick={setOutputActiveId}
                actions={
                  outputFiles.length > 0 ? (
                    <div ref={dlRef} style={{ position: "relative" }}>
                      <Btn icon={Download} onClick={() => setDlOpen(o => !o)}
                        disabled={!outputActive?.clean}
                        style={{ padding: "3px 8px", fontSize: 9, gap: 4 }}>
                        Download <ChevronDown style={{ width: 10, height: 10 }} />
                      </Btn>
                      {dlOpen && (
                        <div style={{
                          position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 100,
                          background: C.surface, border: `1px solid ${C.border}`,
                          boxShadow: `0 4px 20px rgba(0,0,0,0.3)`, minWidth: 180,
                        }}>
                          {[
                            { label: "Save individually", action: () => { downloadIndividually(files); setDlOpen(false); } },
                            { label: "Download as ZIP", action: () => { downloadAllZip(files); setDlOpen(false); } },
                          ].map(opt => (
                            <button key={opt.label} onClick={opt.action} style={{
                              display: "block", width: "100%", textAlign: "left",
                              padding: "8px 14px", border: "none", cursor: "pointer",
                              background: "transparent", color: C.text, fontSize: 11,
                              fontWeight: 600, fontFamily: sans,
                            }}
                              onMouseEnter={e => { e.currentTarget.style.background = C.raised; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <IcoBtn icon={Download} label="Download cleaned config"
                      onClick={() => outputActive && downloadSingle(outputActive.name, outputActive.clean)}
                      disabled={!outputActive?.clean} />
                  )
                }
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
          <LabPanel onClose={() => setShowLab(false)} onConfigsPulled={onConfigsPulled} files={files} updateFile={updateFile} vp={vp} pod={pod} action={labAction} setAction={setLabAction} persistence={persistence} />
        )}
        {pendingSplit && (
          <SplitPreview devices={pendingSplit} onAccept={confirmSplit} onCancel={cancelSplit} />
        )}
      </main>

      <footer style={{ height: 28, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", background: C.surface, flexShrink: 0, transition: "background .2s" }}>
        {restoreToast ? (
          <span style={{ fontSize: 10, color: C.muted, fontFamily: mono, animation: "fadeIn .25s ease" }}>{restoreToast}</span>
        ) : <span />}
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
