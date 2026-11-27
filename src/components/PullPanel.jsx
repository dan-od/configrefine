import { useState, useEffect, useRef, useCallback } from "react";
import { Loader, Check, X, Play, Download, Plus, RotateCcw, Square, ChevronDown, AlertTriangle, Trash2 } from "lucide-react";
import { useTheme, mono, sans } from "../theme";
import { IcoBtn, Btn, canHover } from "./Shared";
import { useStream } from "../hooks/useStream";
import { useReportBusy } from "../hooks/usePodConnection";
import { pooledExec, withTimeout } from "../utils/pooledExec";
import { downloadBackupZip } from "../utils/downloads";
import { validatePull } from "../engine";

const PULL_TIMEOUT = 30000;
const ERASE_TIMEOUT = 60000;
const DIRECT_CONCURRENCY = 6;

export function PullPanel({ conn, apiKey, apiOnline, offline, mode, onConfigsPulled, apiBase, inpStyle, pod, persistence }) {
  const { C } = useTheme();
  const { devices, directHosts, setDirectHosts } = pod;
  const [selected, setSelected] = useState(() => devices ? Object.keys(devices) : []);

  useEffect(() => { setSelected(devices ? Object.keys(devices) : []); }, [devices]);

  const [pullBusy, setPullBusy] = useState(false);
  const stream = useStream("pull");
  useReportBusy(pod, "pull", stream.busy || pullBusy);

  const [rowHov, setRowHov] = useState(null);
  const [selHov, setSelHov] = useState(null);
  const [deviceStatuses, setDeviceStatuses] = useState({});
  const [pullProgress, setPullProgress] = useState(null);
  const abortRef = useRef(null);
  const deviceOrderRef = useRef([]);
  const [pullResults, setPullResults] = useState({});

  // Pull & Erase state
  const [pullDropOpen, setPullDropOpen] = useState(false);
  const pullDropRef = useRef(null);
  const [eraseMode, setEraseMode] = useState(false);
  const [erasePhase, setErasePhase] = useState(null); // null | "confirming" | "erasing" | "done"
  const [eraseDevices, setEraseDevices] = useState([]);
  const [eraseCountdown, setEraseCountdown] = useState(3);
  const [eraseStatuses, setEraseStatuses] = useState({});
  const [eraseMessage, setEraseMessage] = useState(null);
  const pullResultsRef = useRef({});

  const authHeaders = () => {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  };

  const toggleDevice = n =>
    setSelected(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);

  // Close pull dropdown on outside click
  useEffect(() => {
    if (!pullDropOpen) return;
    const onClick = e => { if (pullDropRef.current && !pullDropRef.current.contains(e.target)) setPullDropOpen(false); };
    const onKey = e => { if (e.key === "Escape") setPullDropOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [pullDropOpen]);

  // Erase countdown
  useEffect(() => {
    if (erasePhase !== "confirming") { setEraseCountdown(3); return; }
    if (eraseCountdown <= 0) return;
    const id = setTimeout(() => setEraseCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [erasePhase, eraseCountdown]);

  const cancelPull = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Parallel pull via direct SSH ──
  const pullDirect = async (andErase = false) => {
    const hosts = directHosts.filter(h => h.trim());
    if (!hosts.length || !conn.username || !conn.password) return;

    if (andErase) { setEraseMode(true); setErasePhase(null); setEraseStatuses({}); setEraseMessage(null); }
    else setEraseMode(false);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPullBusy(true);
    setPullResults({});
    pullResultsRef.current = {};
    setPullProgress({ done: 0, total: hosts.length });

    const initial = {};
    hosts.forEach(h => { initial[h.trim()] = { status: "queued", name: h.trim() }; });
    deviceOrderRef.current = hosts.map(h => h.trim());
    setDeviceStatuses(initial);

    const tasks = hosts.map(host => {
      const h = host.trim();
      return (signal) => withTimeout(
        fetch(`${apiBase}/api/pull-single`, {
          method: "POST",
          headers: authHeaders(),
          signal,
          body: JSON.stringify({
            host: h, port: parseInt(conn.port || "22"),
            username: conn.username, password: conn.password,
            enablePass: conn.enablePass,
          }),
        }).then(async res => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Request failed" }));
            throw new Error(err.error || `HTTP ${res.status}`);
          }
          return res.json();
        }),
        PULL_TIMEOUT,
        h
      );
    });

    hosts.forEach(h => {
      setDeviceStatuses(prev => ({ ...prev, [h.trim()]: { ...prev[h.trim()], status: "pulling" } }));
    });

    await pooledExec(tasks, {
      concurrency: DIRECT_CONCURRENCY,
      signal: ctrl.signal,
      onSettled: (result, settled, total) => {
        const h = hosts[result.index].trim();
        setPullProgress({ done: settled, total });

        if (result.status === "fulfilled") {
          const data = result.value;
          setDeviceStatuses(prev => ({
            ...prev,
            [h]: { status: "done", name: data.name, host: h, lines: data.config?.split("\n").length || 0 },
          }));
          pullResultsRef.current[data.name] = { config: data.config, host: h, expectedName: null };
          setPullResults(prev => ({ ...prev, [data.name]: data.config }));
          onConfigsPulled?.({ [data.name]: data.config }, data.name);
          persistence?.savePullResults(pod.session?.pod, {
            ...pullResults, [data.name]: data.config,
          });
        } else if (result.status === "cancelled") {
          setDeviceStatuses(prev => ({ ...prev, [h]: { status: "cancelled", name: h, error: "Cancelled" } }));
        } else {
          setDeviceStatuses(prev => ({ ...prev, [h]: { status: "failed", name: h, error: result.reason } }));
        }
      },
    });

    abortRef.current = null;
    setPullBusy(false);
  };

  const retryDevice = async (host) => {
    const h = host.trim();
    setDeviceStatuses(prev => ({ ...prev, [h]: { ...prev[h], status: "pulling" } }));
    try {
      const res = await withTimeout(
        fetch(`${apiBase}/api/pull-single`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            host: h, port: parseInt(conn.port || "22"),
            username: conn.username, password: conn.password,
            enablePass: conn.enablePass,
          }),
        }).then(async r => {
          if (!r.ok) {
            const err = await r.json().catch(() => ({ error: "Request failed" }));
            throw new Error(err.error || `HTTP ${r.status}`);
          }
          return r.json();
        }),
        PULL_TIMEOUT,
        h
      );
      setDeviceStatuses(prev => ({
        ...prev,
        [h]: { status: "done", name: res.name, host: h, lines: res.config?.split("\n").length || 0 },
      }));
      pullResultsRef.current[res.name] = { config: res.config, host: h, expectedName: null };
      setPullResults(prev => ({ ...prev, [res.name]: res.config }));
      onConfigsPulled?.({ [res.name]: res.config }, res.name);
    } catch (e) {
      setDeviceStatuses(prev => ({ ...prev, [h]: { status: "failed", name: h, error: e.message } }));
    }
  };

  // ── Console server pull ──
  const pullConsole = async (andErase = false) => {
    const creds = pod.consoleCreds();
    if (!creds || !devices) return;
    const devMap = {};
    selected.forEach(k => { if (devices[k]) devMap[k] = devices[k]; });
    if (!Object.keys(devMap).length) return;

    if (andErase) { setEraseMode(true); setErasePhase(null); setEraseStatuses({}); setEraseMessage(null); }
    else setEraseMode(false);

    const initial = {};
    Object.entries(devMap).forEach(([num, name]) => { initial[num] = { status: "queued", name }; });
    deviceOrderRef.current = Object.keys(devMap);
    setDeviceStatuses(initial);
    setPullProgress({ done: 0, total: Object.keys(devMap).length });
    setPullResults({});
    pullResultsRef.current = {};
    setPullBusy(true);

    stream.initResults(Object.keys(devMap).length);
    stream.setMessage("Connecting...");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 300000);
    try {
      const res = await fetch(`${apiBase}/api/pull`, {
        method: "POST", headers: authHeaders(), signal: ctrl.signal,
        body: JSON.stringify({ ...creds, devices: devMap }),
      });
      clearTimeout(timer);
      if (res.status === 401 || res.status === 429) {
        stream.setStatus("error");
        stream.setMessage(res.status === 401 ? "Invalid API key" : "Rate limited");
        setPullBusy(false);
        return;
      }
      await readConsoleStream(res, devMap);
    } catch (e) {
      clearTimeout(timer);
      stream.setStatus("error");
      stream.setMessage(e.name === "AbortError" ? "Pull timed out" : "Connection lost");
    }
    setPullBusy(false);
  };

  const readConsoleStream = async (res, devMap) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pulled = 0;
    const total = Object.keys(devMap).length;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }

          if (msg.type === "pulling" && msg.num) {
            setDeviceStatuses(prev => ({ ...prev, [msg.num]: { ...prev[msg.num], status: "pulling" } }));
            stream.setMessage(`Pulling ${msg.device}...`);
          } else if (msg.type === "device" && msg.num) {
            pulled++;
            setPullProgress({ done: pulled, total });
            setDeviceStatuses(prev => ({
              ...prev,
              [msg.num]: { status: "done", name: msg.name, num: msg.num, lines: msg.config?.split("\n").length || 0 },
            }));
            pullResultsRef.current[msg.name] = { config: msg.config, num: msg.num, expectedName: devMap[msg.num] || null };
            setPullResults(prev => ({ ...prev, [msg.name]: msg.config }));
            onConfigsPulled?.({ [msg.name]: msg.config }, msg.name);
            stream.setMessage(`Pulled ${msg.name}`);
          } else if (msg.type === "device_error" && msg.num) {
            pulled++;
            setPullProgress({ done: pulled, total });
            setDeviceStatuses(prev => ({
              ...prev,
              [msg.num]: { status: "failed", name: msg.name || devMap[msg.num], error: msg.message || "Failed" },
            }));
            stream.setMessage(`Failed: ${msg.name || msg.device}`);
          } else if (msg.type === "error") {
            stream.setStatus("error");
            stream.setMessage(msg.message || "Unknown error");
          } else if (msg.type === "done") {
            stream.setStatus("done");
            stream.setMessage(`Done — ${msg.pulled}/${msg.total} pulled`);
          } else if (msg.type === "status") {
            stream.setMessage(msg.message);
          }
        }
      }
    } catch {
      stream.setStatus("error");
      stream.setMessage("Connection interrupted — partial results may be available.");
    }
  };

  // ── Pull & Erase: transition to erase after pull completes ──
  const isBusy = pullBusy || stream.busy;
  const hasDeviceStatuses = Object.keys(deviceStatuses).length > 0;
  const doneCount = Object.values(deviceStatuses).filter(d => d.status === "done").length;
  const failedCount = Object.values(deviceStatuses).filter(d => d.status === "failed").length;
  const pullingCount = Object.values(deviceStatuses).filter(d => d.status === "pulling").length;
  const queuedCount = Object.values(deviceStatuses).filter(d => d.status === "queued").length;
  const totalDevices = Object.keys(deviceStatuses).length;
  const pullComplete = hasDeviceStatuses && !isBusy && (doneCount + failedCount) === totalDevices;

  useEffect(() => {
    if (!eraseMode || !pullComplete || erasePhase) return;
    const results = pullResultsRef.current;
    if (!Object.keys(results).length) return;

    const validated = Object.entries(results).map(([name, { config, host, num, expectedName }]) => {
      const v = validatePull(config, expectedName);
      return { name, config, host, num, ...v };
    });

    downloadBackupZip(Object.fromEntries(validated.map(d => [d.name, d.config])));
    setEraseDevices(validated);
    setErasePhase("confirming");
    setEraseCountdown(3);
  }, [pullComplete, eraseMode, erasePhase]);

  // ── Execute erase ──
  const validEraseCount = eraseDevices.filter(d => d.valid).length;

  const executeEraseDirect = async () => {
    setErasePhase("erasing");
    const targets = eraseDevices.filter(d => d.valid);
    const initial = {};
    targets.forEach(d => { initial[d.name] = { status: "erasing" }; });
    setEraseStatuses(initial);

    const tasks = targets.map(d => {
      return (signal) => withTimeout(
        fetch(`${apiBase}/api/erase-single`, {
          method: "POST",
          headers: authHeaders(),
          signal,
          body: JSON.stringify({
            host: d.host, port: parseInt(conn.port || "22"),
            username: conn.username, password: conn.password,
            enablePass: conn.enablePass,
          }),
        }).then(async res => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Request failed" }));
            throw new Error(err.error || `HTTP ${res.status}`);
          }
          return res.json();
        }),
        ERASE_TIMEOUT,
        d.host
      );
    });

    await pooledExec(tasks, {
      concurrency: DIRECT_CONCURRENCY,
      onSettled: (result, settled, total) => {
        const d = targets[result.index];
        if (result.status === "fulfilled") {
          const data = result.value;
          setEraseStatuses(prev => ({ ...prev, [d.name]: { status: "done", summary: data.summary } }));
        } else {
          setEraseStatuses(prev => ({ ...prev, [d.name]: { status: "failed", error: String(result.reason) } }));
        }
      },
    });

    setErasePhase("done");
    setEraseMessage("Erase complete");
  };

  const executeEraseConsole = async () => {
    setErasePhase("erasing");
    const targets = eraseDevices.filter(d => d.valid);
    const creds = pod.consoleCreds();
    if (!creds) return;

    const devMap = {};
    targets.forEach(d => { if (d.num) devMap[d.num] = d.name; });
    const initial = {};
    targets.forEach(d => { initial[d.name] = { status: "erasing" }; });
    setEraseStatuses(initial);

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 300000);
      const res = await fetch(`${apiBase}/api/erase-console`, {
        method: "POST", headers: authHeaders(), signal: ctrl.signal,
        body: JSON.stringify({ ...creds, devices: devMap }),
      });
      clearTimeout(timer);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.type === "device" && msg.name) {
            setEraseStatuses(prev => ({ ...prev, [msg.name]: { status: "done", summary: msg.status || "erased" } }));
          } else if (msg.type === "device_error" && msg.name) {
            setEraseStatuses(prev => ({ ...prev, [msg.name]: { status: "failed", error: msg.message || "Failed" } }));
          } else if (msg.type === "pulling" && msg.device) {
            setEraseStatuses(prev => ({ ...prev, [msg.device]: { status: "erasing" } }));
          }
        }
      }
    } catch (e) {
      targets.forEach(d => {
        setEraseStatuses(prev => {
          if (prev[d.name]?.status === "done") return prev;
          return { ...prev, [d.name]: { status: "failed", error: e.message || "Connection lost" } };
        });
      });
    }
    setErasePhase("done");
    setEraseMessage("Erase complete");
  };

  const confirmErase = () => {
    if (mode === "direct") executeEraseDirect();
    else executeEraseConsole();
  };

  const downloadFile = (name, content) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    a.download = `${name}.txt`; a.click();
  };

  const downloadAll = () => {
    Object.entries(pullResults).forEach(([name, config], i) =>
      setTimeout(() => downloadFile(name, config), i * 100));
  };

  const statusStyle = (s) => ({
    queued: { dot: C.muted + "88", text: C.muted, bg: "transparent", label: "Queued" },
    pulling: { dot: C.accent, text: C.accent, bg: "rgba(232,178,80,0.06)", label: "Pulling..." },
    done: { dot: C.green, text: C.green, bg: "rgba(52,211,153,0.06)", label: null },
    failed: { dot: C.red, text: C.red, bg: "rgba(248,113,113,0.06)", label: null },
    cancelled: { dot: C.accent, text: C.accent, bg: "rgba(232,178,80,0.06)", label: "Cancelled" },
  }[s] || { dot: C.muted, text: C.muted, bg: "transparent", label: s });

  const resetAll = () => {
    setDeviceStatuses({});
    setPullProgress(null);
    setPullResults({});
    pullResultsRef.current = {};
    setEraseMode(false);
    setErasePhase(null);
    setEraseDevices([]);
    setEraseStatuses({});
    setEraseMessage(null);
    stream.reset();
  };

  const sec = { fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono };

  // ── Split button: Pull / Pull & Erase ──
  const renderPullButton = (onClick, count, disabled) => {
    const isDisabled = disabled || !count;
    return (
      <div ref={pullDropRef} style={{ position: "relative" }}>
        <div style={{ display: "flex" }}>
          <button
            onClick={onClick}
            disabled={isDisabled}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "10px 0", border: `1px solid ${isDisabled ? C.muted + "33" : C.accent}`,
              borderRight: "none",
              background: isDisabled ? "transparent" : C.accentDim,
              color: isDisabled ? C.muted : C.accent,
              fontSize: 12, fontWeight: 500, fontFamily: mono,
              cursor: isDisabled ? "not-allowed" : "pointer",
            }}
          >
            <Play style={{ width: 12, height: 12 }} />
            {offline ? "Pull unavailable" : `Pull ${count} Device${count !== 1 ? "s" : ""}`}
          </button>
          <button
            onClick={() => !isDisabled && setPullDropOpen(o => !o)}
            disabled={isDisabled}
            style={{
              width: 32, display: "flex", alignItems: "center", justifyContent: "center",
              border: `1px solid ${isDisabled ? C.muted + "33" : C.accent}`,
              background: isDisabled ? "transparent" : pullDropOpen ? C.accent : C.accentDim,
              color: isDisabled ? C.muted : pullDropOpen ? "#000" : C.accent,
              cursor: isDisabled ? "not-allowed" : "pointer",
            }}
          >
            <ChevronDown style={{ width: 12, height: 12 }} />
          </button>
        </div>
        {pullDropOpen && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2, zIndex: 50,
            background: C.surface, border: `1px solid ${C.border}`,
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          }}>
            {[
              { label: "Pull", desc: "Pull configs only", action: () => { setPullDropOpen(false); onClick(); } },
              { label: "Pull & Erase", desc: "Pull, backup, then erase & reload", danger: true, action: () => {
                setPullDropOpen(false);
                if (mode === "direct") pullDirect(true);
                else pullConsole(true);
              }},
            ].map(opt => (
              <button key={opt.label} onClick={opt.action} style={{
                display: "flex", flexDirection: "column", gap: 2, width: "100%", textAlign: "left",
                padding: "8px 12px", border: "none", cursor: "pointer",
                background: "transparent", color: opt.danger ? C.red : C.text,
              }}
                onMouseEnter={e => { e.currentTarget.style.background = C.raised; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: mono }}>{opt.label}</span>
                <span style={{ fontSize: 9, color: C.muted }}>{opt.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Direct SSH — host list */}
      {mode === "direct" && !hasDeviceStatuses && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={sec}>Devices</span>
            <button onClick={() => setDirectHosts(p => [...p, ""])} title="Add device" style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: offline ? "not-allowed" : "pointer", opacity: offline ? 0.45 : 1, fontFamily: mono, display: "flex", alignItems: "center", gap: 3 }}>
              <Plus style={{ width: 10, height: 10 }} /> Add
            </button>
          </div>
          {directHosts.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 4 }}>
              <input placeholder="Device IP or hostname" style={{ ...inpStyle, flex: 1 }} value={h}
                onChange={e => { const n = [...directHosts]; n[i] = e.target.value; setDirectHosts(n); }} />
              {directHosts.length > 1 && (
                <IcoBtn icon={X} label="Remove" onClick={() => setDirectHosts(p => p.filter((_, j) => j !== i))} size={12} style={{ padding: 6 }} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Console server — select devices */}
      {mode === "console" && !devices && !hasDeviceStatuses && (
        <div style={{ fontSize: 10, color: C.muted, textAlign: "center", padding: "4px 0" }}>
          Connect to a pod above to list its devices.
        </div>
      )}
      {mode === "console" && devices && !hasDeviceStatuses && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={sec}>
              Devices{pod.session?.pod ? ` · POD ${pod.session.pod}` : ""}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {["All", "None"].map(lbl => (
                <button key={lbl}
                  onClick={() => setSelected(lbl === "All" ? Object.keys(devices) : [])}
                  onMouseEnter={() => canHover && setSelHov(lbl)}
                  onMouseLeave={() => setSelHov(null)}
                  style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", opacity: selHov === lbl ? 1 : 0.7, transition: "opacity .12s", fontFamily: mono }}
                >{lbl}</button>
              ))}
            </div>
          </div>
          {Object.entries(devices).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([num, name]) => {
            const on = selected.includes(num);
            const hov = !on && rowHov === num;
            return (
              <button key={num} onClick={() => toggleDevice(num)}
                onMouseEnter={() => canHover && setRowHov(num)}
                onMouseLeave={() => setRowHov(null)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: `1px solid ${on ? C.borderActive : hov ? C.border : "transparent"}`, background: on ? C.accentDim : hov ? C.raised : "transparent", cursor: "pointer", textAlign: "left", transition: "background .12s, border-color .12s" }}>
                <div style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", background: on ? C.accent : C.muted + "33", transition: "background .12s" }}>
                  {on && <Check style={{ width: 10, height: 10, color: "#0a0e1a" }} />}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: on ? C.accent : hov ? C.textBright : C.text }}>[{num}]</span>
                <span style={{ fontSize: 10, color: C.muted }}>{name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Live device status list */}
      {hasDeviceStatuses && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={sec}>
              {eraseMode ? "Pull & Erase" : "Pull Status"}{pod.session?.pod ? ` · POD ${pod.session.pod}` : ""}
            </span>
            {pullComplete && Object.keys(pullResults).length > 1 && !eraseMode && (
              <button onClick={downloadAll} title="Save all as .txt files" style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", opacity: 0.7, fontFamily: mono }}>Save All</button>
            )}
          </div>
          {Object.entries(deviceStatuses).sort((a, b) => {
            const ord = deviceOrderRef.current;
            const ia = ord.indexOf(a[0]); const ib = ord.indexOf(b[0]);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
          }).map(([key, d]) => {
            const s = statusStyle(d.status);
            const es = eraseStatuses[d.name];
            return (
              <div key={key} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                borderLeft: `2px solid ${es ? (es.status === "done" ? C.green : es.status === "failed" ? C.red : C.accent) : s.dot}`,
                background: s.bg, transition: "background .2s",
              }}>
                <div style={{ width: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {d.status === "pulling" ? (
                    <Loader style={{ width: 12, height: 12, color: s.dot, animation: "spin 1s linear infinite" }} />
                  ) : d.status === "done" ? (
                    <Check style={{ width: 12, height: 12, color: s.dot }} />
                  ) : d.status === "failed" ? (
                    <X style={{ width: 12, height: 12, color: s.dot }} />
                  ) : (
                    <div style={{ width: 6, height: 6, borderRadius: 99, background: s.dot }} />
                  )}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.textBright, fontFamily: mono, flex: 1 }}>
                  {d.name || key}
                </span>
                {d.status === "done" && !es && (
                  <span style={{ fontSize: 9, color: s.text, fontFamily: mono }}>{d.lines} lines</span>
                )}
                {es && (
                  <span style={{ fontSize: 9, fontFamily: mono, color: es.status === "done" ? C.green : es.status === "failed" ? C.red : C.accent }}>
                    {es.status === "done" ? "Erased" : es.status === "failed" ? "Erase failed" : "Erasing..."}
                  </span>
                )}
                {d.status === "failed" && (
                  <>
                    <span style={{ fontSize: 9, color: s.text, fontFamily: mono, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.error || "Failed"}
                    </span>
                    {mode === "direct" && !isBusy && !eraseMode && (
                      <button onClick={() => retryDevice(key)} style={{
                        fontSize: 10, color: C.accent, padding: "2px 8px",
                        border: `0.5px solid ${C.borderActive}`, borderRadius: 4,
                        background: "transparent", cursor: "pointer", fontFamily: mono,
                      }}>Retry</button>
                    )}
                  </>
                )}
                {d.status === "cancelled" && (
                  <span style={{ fontSize: 9, color: s.text, fontFamily: mono }}>Cancelled</span>
                )}
                {(s.label && d.status !== "cancelled") && (
                  <span style={{ fontSize: 9, color: s.text, fontFamily: mono }}>{s.label}</span>
                )}
              </div>
            );
          })}

          {pullProgress && (
            <>
              <div style={{ height: 4, background: C.border, overflow: "hidden", marginTop: 4 }}>
                <div style={{ height: "100%", background: C.green, width: `${(pullProgress.done / pullProgress.total) * 100}%`, transition: "width .3s ease" }} />
              </div>
              <div style={{ fontSize: 10, color: C.muted + "88", fontFamily: mono, textAlign: "center" }}>
                {doneCount} of {totalDevices} pulled
                {pullingCount > 0 && ` · ${pullingCount} pulling`}
                {queuedCount > 0 && ` · ${queuedCount} queued`}
                {failedCount > 0 && ` · ${failedCount} failed`}
              </div>
            </>
          )}

          {pullComplete && !eraseMode && (
            <button onClick={resetAll}
              style={{ fontSize: 10, color: C.muted + "88", background: "none", border: "none", cursor: "pointer", fontFamily: mono, textAlign: "center", padding: "4px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <X style={{ width: 10, height: 10 }} /> Clear & select again
            </button>
          )}
        </div>
      )}

      {/* ── Pull & Erase: Confirmation ── */}
      {erasePhase === "confirming" && (
        <div style={{ padding: 14, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: C.red, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>
              Confirm: Erase & Reload {validEraseCount} Device{validEraseCount !== 1 ? "s" : ""}
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
            Configs have been pulled and a ZIP backup was downloaded. This will run{" "}
            <code style={{ fontFamily: mono, color: C.accent }}>write erase</code>, delete{" "}
            <code style={{ fontFamily: mono, color: C.accent }}>flash:vlan.dat</code> on switches, and{" "}
            <code style={{ fontFamily: mono, color: C.accent }}>reload</code>.{" "}
            <strong style={{ color: C.textBright }}>This cannot be undone.</strong>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {eraseDevices.map(d => (
              <div key={d.name} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                background: d.valid ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.04)",
                border: `1px solid ${d.valid ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}`,
              }}>
                {d.valid ? (
                  <Check style={{ width: 12, height: 12, color: C.green, flexShrink: 0 }} />
                ) : (
                  <X style={{ width: 12, height: 12, color: C.red, flexShrink: 0 }} />
                )}
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: mono, color: C.textBright, flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 9, fontFamily: mono, color: d.valid ? C.green : C.red }}>
                  {d.valid ? "Will erase" : `Skip: ${d.reason}`}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setErasePhase(null); setEraseMode(false); }}
              style={{
                flex: 1, padding: "9px 0", border: `1px solid ${C.border}`, background: "transparent",
                color: C.text, cursor: "pointer", fontWeight: 700, fontSize: 11, fontFamily: sans,
              }}
            >
              Cancel
            </button>
            <button
              onClick={eraseCountdown === 0 ? confirmErase : undefined}
              disabled={eraseCountdown > 0 || !validEraseCount}
              style={{
                flex: 1, padding: "9px 0", border: "none",
                background: (eraseCountdown > 0 || !validEraseCount) ? "rgba(248,113,113,0.3)" : C.red,
                color: "white", cursor: (eraseCountdown > 0 || !validEraseCount) ? "default" : "pointer",
                fontWeight: 700, fontSize: 11, fontFamily: sans, transition: "background .2s",
              }}
            >
              {!validEraseCount ? "No valid devices" : `Erase ${validEraseCount} Device${validEraseCount !== 1 ? "s" : ""}${eraseCountdown > 0 ? ` (${eraseCountdown})` : ""}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Erase status ── */}
      {(erasePhase === "erasing" || erasePhase === "done") && Object.keys(eraseStatuses).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={sec}>Erase Status</span>
          {Object.entries(eraseStatuses).map(([name, es]) => (
            <div key={name} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
              borderLeft: `2px solid ${es.status === "done" ? C.green : es.status === "failed" ? C.red : C.accent}`,
              background: es.status === "done" ? "rgba(52,211,153,0.06)" : es.status === "failed" ? "rgba(248,113,113,0.06)" : "rgba(232,178,80,0.06)",
            }}>
              <div style={{ width: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {es.status === "erasing" ? (
                  <Loader style={{ width: 12, height: 12, color: C.accent, animation: "spin 1s linear infinite" }} />
                ) : es.status === "done" ? (
                  <Check style={{ width: 12, height: 12, color: C.green }} />
                ) : (
                  <X style={{ width: 12, height: 12, color: C.red }} />
                )}
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.textBright, fontFamily: mono, flex: 1 }}>{name}</span>
              <span style={{ fontSize: 9, fontFamily: mono, color: es.status === "done" ? C.green : es.status === "failed" ? C.red : C.accent }}>
                {es.status === "done" ? (es.summary || "Erased") : es.status === "failed" ? (es.error || "Failed") : "Erasing..."}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Erase complete: clear ── */}
      {erasePhase === "done" && (
        <button onClick={resetAll}
          style={{ fontSize: 10, color: C.muted + "88", background: "none", border: "none", cursor: "pointer", fontFamily: mono, textAlign: "center", padding: "4px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
        >
          <X style={{ width: 10, height: 10 }} /> Clear & select again
        </button>
      )}

      {/* Pull / Cancel button */}
      {!erasePhase && (
        mode === "direct" ? (
          isBusy ? (
            <Btn icon={Square} onClick={cancelPull} style={{ justifyContent: "center", padding: "10px 0", color: C.red, borderColor: "rgba(248,113,113,0.3)" }}>
              Cancel pull
            </Btn>
          ) : (
            renderPullButton(() => pullDirect(false), directHosts.filter(h => h.trim()).length, !apiOnline)
          )
        ) : mode === "console" && devices ? (
          isBusy ? (
            <Btn icon={Square} onClick={cancelPull} style={{ justifyContent: "center", padding: "10px 0", color: C.red, borderColor: "rgba(248,113,113,0.3)" }}>
              Cancel pull
            </Btn>
          ) : (
            renderPullButton(() => pullConsole(false), selected.length, !apiOnline || !selected.length)
          )
        ) : null
      )}
    </div>
  );
}
