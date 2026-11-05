import { useState, useEffect, useRef, useCallback } from "react";
import { Loader, Check, X, Play, Download, Plus, RotateCcw, Square } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn, Btn, canHover } from "./Shared";
import { useStream } from "../hooks/useStream";
import { useReportBusy } from "../hooks/usePodConnection";
import { pooledExec, withTimeout } from "../utils/pooledExec";

const PULL_TIMEOUT = 30000;
const DIRECT_CONCURRENCY = 6;

export function PullPanel({ conn, apiKey, apiOnline, offline, mode, onConfigsPulled, apiBase, inpStyle, pod, persistence }) {
  const { C } = useTheme();
  const { devices, directHosts, setDirectHosts } = pod;
  const [selected, setSelected] = useState(() => devices ? Object.keys(devices) : []);

  useEffect(() => { setSelected(devices ? Object.keys(devices) : []); }, [devices]);

  // Parallel pull state (direct SSH mode)
  const [pullBusy, setPullBusy] = useState(false);

  // Console-server pull still uses streaming (serial, single SSH channel)
  const stream = useStream("pull");
  useReportBusy(pod, "pull", stream.busy || pullBusy);

  const [rowHov, setRowHov] = useState(null);
  const [selHov, setSelHov] = useState(null);
  const [deviceStatuses, setDeviceStatuses] = useState({});
  const [pullProgress, setPullProgress] = useState(null);
  const abortRef = useRef(null);
  const [pullResults, setPullResults] = useState({});

  const authHeaders = () => {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  };

  const toggleDevice = n =>
    setSelected(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);

  const extractDeviceName = (fullName) => {
    const m = fullName.match(/\(([^)]+)\)/);
    return m ? m[1] : fullName;
  };

  // ── Cancel ──
  const cancelPull = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Parallel pull via direct SSH ──
  const pullDirect = async () => {
    const hosts = directHosts.filter(h => h.trim());
    if (!hosts.length || !conn.username || !conn.password) return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPullBusy(true);
    setPullResults({});
    setPullProgress({ done: 0, total: hosts.length });

    const initial = {};
    hosts.forEach(h => { initial[h.trim()] = { status: "queued", name: h.trim() }; });
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

    // Mark all as pulling initially
    hosts.forEach(h => {
      setDeviceStatuses(prev => ({
        ...prev,
        [h.trim()]: { ...prev[h.trim()], status: "pulling" },
      }));
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
            [h]: { status: "done", name: data.name, lines: data.config?.split("\n").length || 0 },
          }));
          setPullResults(prev => ({ ...prev, [data.name]: data.config }));
          onConfigsPulled?.({ [data.name]: data.config }, data.name);
          persistence?.savePullResults(pod.session?.pod, {
            ...pullResults, [data.name]: data.config,
          });
        } else if (result.status === "cancelled") {
          setDeviceStatuses(prev => ({
            ...prev,
            [h]: { status: "cancelled", name: h, error: "Cancelled" },
          }));
        } else {
          setDeviceStatuses(prev => ({
            ...prev,
            [h]: { status: "failed", name: h, error: result.reason },
          }));
        }
      },
    });

    abortRef.current = null;
    setPullBusy(false);
  };

  // ── Retry a single failed direct-SSH device ──
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
        [h]: { status: "done", name: res.name, lines: res.config?.split("\n").length || 0 },
      }));
      setPullResults(prev => ({ ...prev, [res.name]: res.config }));
      onConfigsPulled?.({ [res.name]: res.config }, res.name);
    } catch (e) {
      setDeviceStatuses(prev => ({
        ...prev,
        [h]: { status: "failed", name: h, error: e.message },
      }));
    }
  };

  // ── Console server pull (serial, streaming — unchanged architecture) ──
  const pullConsole = async () => {
    const creds = pod.consoleCreds();
    if (!creds || !devices) return;
    const devMap = {};
    selected.forEach(k => { if (devices[k]) devMap[k] = devices[k]; });
    if (!Object.keys(devMap).length) return;

    const initial = {};
    Object.entries(devMap).forEach(([num, name]) => {
      initial[num] = { status: "queued", name };
    });
    setDeviceStatuses(initial);
    setPullProgress({ done: 0, total: Object.keys(devMap).length });
    setPullResults({});
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

  // Enhanced stream reader that updates per-device statuses
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
            setDeviceStatuses(prev => ({
              ...prev,
              [msg.num]: { ...prev[msg.num], status: "pulling" },
            }));
            stream.setMessage(`Pulling ${msg.device}...`);
          } else if (msg.type === "device" && msg.num) {
            pulled++;
            setPullProgress({ done: pulled, total });
            setDeviceStatuses(prev => ({
              ...prev,
              [msg.num]: {
                status: "done",
                name: msg.name,
                lines: msg.config?.split("\n").length || 0,
              },
            }));
            setPullResults(prev => ({ ...prev, [msg.name]: msg.config }));
            onConfigsPulled?.({ [msg.name]: msg.config }, msg.name);
            stream.setMessage(`Pulled ${msg.name}`);
          } else if (msg.type === "device_error" && msg.num) {
            pulled++;
            setPullProgress({ done: pulled, total });
            setDeviceStatuses(prev => ({
              ...prev,
              [msg.num]: {
                status: "failed",
                name: msg.name || devMap[msg.num],
                error: msg.message || "Failed",
              },
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

  const downloadFile = (name, content) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    a.download = `${name}.txt`; a.click();
  };

  const downloadAll = () => {
    Object.entries(pullResults).forEach(([name, config], i) =>
      setTimeout(() => downloadFile(name, config), i * 100));
  };

  const isBusy = pullBusy || stream.busy;
  const hasDeviceStatuses = Object.keys(deviceStatuses).length > 0;
  const doneCount = Object.values(deviceStatuses).filter(d => d.status === "done").length;
  const failedCount = Object.values(deviceStatuses).filter(d => d.status === "failed").length;
  const pullingCount = Object.values(deviceStatuses).filter(d => d.status === "pulling").length;
  const queuedCount = Object.values(deviceStatuses).filter(d => d.status === "queued").length;
  const totalDevices = Object.keys(deviceStatuses).length;
  const pullComplete = hasDeviceStatuses && !isBusy && (doneCount + failedCount) === totalDevices;

  // Status colors for device rows
  const statusStyle = (s) => ({
    queued: { dot: C.muted + "88", text: C.muted, bg: "transparent", label: "Queued" },
    pulling: { dot: C.accent, text: C.accent, bg: "rgba(232,178,80,0.06)", label: "Pulling..." },
    done: { dot: C.green, text: C.green, bg: "rgba(52,211,153,0.06)", label: null },
    failed: { dot: C.red, text: C.red, bg: "rgba(248,113,113,0.06)", label: null },
    cancelled: { dot: C.accent, text: C.accent, bg: "rgba(232,178,80,0.06)", label: "Cancelled" },
  }[s] || { dot: C.muted, text: C.muted, bg: "transparent", label: s });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Direct SSH — host list */}
      {mode === "direct" && !hasDeviceStatuses && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>Devices</span>
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

      {/* Console server — select from the shared device list */}
      {mode === "console" && !devices && !hasDeviceStatuses && (
        <div style={{ fontSize: 10, color: C.muted, textAlign: "center", padding: "4px 0" }}>
          Connect to a pod above to list its devices.
        </div>
      )}
      {mode === "console" && devices && !hasDeviceStatuses && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
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

      {/* Live device status list (shown during/after pull) */}
      {hasDeviceStatuses && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
              Pull Status{pod.session?.pod ? ` · POD ${pod.session.pod}` : ""}
            </span>
            {pullComplete && Object.keys(pullResults).length > 1 && (
              <button onClick={downloadAll} title="Save all as .txt files" style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", opacity: 0.7, fontFamily: mono }}>Save All</button>
            )}
          </div>
          {Object.entries(deviceStatuses).sort((a, b) => {
            const order = { pulling: 0, queued: 1, done: 2, failed: 3, cancelled: 4 };
            return (order[a[1].status] ?? 5) - (order[b[1].status] ?? 5);
          }).map(([key, d]) => {
            const s = statusStyle(d.status);
            return (
              <div key={key} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                borderLeft: `2px solid ${s.dot}`,
                background: s.bg,
                transition: "background .2s",
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: 99, background: s.dot, flexShrink: 0,
                  ...(d.status === "pulling" && { animation: "spin 1s linear infinite" }),
                }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: C.textBright, fontFamily: mono, flex: 1 }}>
                  {d.name || key}
                </span>
                {d.status === "done" && (
                  <span style={{ fontSize: 9, color: s.text, fontFamily: mono }}>
                    Done — {d.lines} lines
                  </span>
                )}
                {d.status === "failed" && (
                  <>
                    <span style={{ fontSize: 9, color: s.text, fontFamily: mono, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.error || "Failed"}
                    </span>
                    {!isBusy && (
                      <button
                        onClick={() => mode === "direct" ? retryDevice(key) : null}
                        style={{
                          fontSize: 10, color: C.accent, padding: "2px 8px",
                          border: `0.5px solid ${C.borderActive}`, borderRadius: 4,
                          background: "transparent", cursor: "pointer", fontFamily: mono,
                        }}
                      >Retry</button>
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

          {/* Progress bar */}
          {pullProgress && (
            <>
              <div style={{ height: 4, background: C.border, overflow: "hidden", marginTop: 4 }}>
                <div style={{
                  height: "100%", background: C.green,
                  width: `${(pullProgress.done / pullProgress.total) * 100}%`,
                  transition: "width .3s ease",
                }} />
              </div>
              <div style={{ fontSize: 10, color: C.muted + "88", fontFamily: mono, textAlign: "center" }}>
                {doneCount} of {totalDevices} pulled
                {pullingCount > 0 && ` · ${pullingCount} pulling`}
                {queuedCount > 0 && ` · ${queuedCount} queued`}
                {failedCount > 0 && ` · ${failedCount} failed`}
              </div>
            </>
          )}

          {/* Clear status to go back to device selection */}
          {pullComplete && (
            <button
              onClick={() => {
                setDeviceStatuses({});
                setPullProgress(null);
                setPullResults({});
                stream.reset();
              }}
              style={{ fontSize: 10, color: C.muted + "88", background: "none", border: "none", cursor: "pointer", fontFamily: mono, textAlign: "center", padding: "4px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <X style={{ width: 10, height: 10 }} /> Clear & select again
            </button>
          )}
        </div>
      )}

      {/* Pull / Cancel button */}
      {mode === "direct" && (
        isBusy ? (
          <Btn icon={Square} onClick={cancelPull} style={{ justifyContent: "center", padding: "10px 0", color: C.red, borderColor: "rgba(248,113,113,0.3)" }}>
            Cancel pull
          </Btn>
        ) : (
          <Btn icon={Play} onClick={pullDirect} primary disabled={!apiOnline || !directHosts.some(h => h.trim())} style={{ justifyContent: "center", padding: "10px 0" }}>
            {offline ? "Pull unavailable" : `Pull ${directHosts.filter(h => h.trim()).length} Device${directHosts.filter(h => h.trim()).length !== 1 ? "s" : ""}`}
          </Btn>
        )
      )}
      {mode === "console" && devices && (
        isBusy ? (
          <Btn icon={Square} onClick={cancelPull} style={{ justifyContent: "center", padding: "10px 0", color: C.red, borderColor: "rgba(248,113,113,0.3)" }}>
            Cancel pull
          </Btn>
        ) : (
          <Btn icon={Play} onClick={pullConsole} primary disabled={!selected.length} style={{ justifyContent: "center", padding: "10px 0" }}>
            {offline ? "Pull unavailable" : `Pull ${selected.length} Device${selected.length !== 1 ? "s" : ""}`}
          </Btn>
        )
      )}
    </div>
  );
}
