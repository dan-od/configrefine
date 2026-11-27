import { useState, useEffect, useMemo, useRef } from "react";
import { Loader, Upload, X, Check } from "lucide-react";
import { useTheme, mono } from "../theme";
import { Btn, canHover } from "./Shared";
import { useStream } from "../hooks/useStream";
import { useReportBusy } from "../hooks/usePodConnection";

export function PushPanel({ conn, apiKey, apiOnline, offline, mode, apiBase, inpStyle, pod, files, updateFile, persistence }) {
  const { C } = useTheme();
  const { devices, directHosts } = pod;

  const { status, message, results, pulling, busy, readStream, reset, initResults, setStatus, setMessage } =
    useStream("push");
  useReportBusy(pod, "push", busy);

  const [lastPush, setLastPush] = useState(null);
  const [statusMap, setStatusMap] = useState({});
  const [expandedErrors, setExpandedErrors] = useState(new Set());
  const [rowHov, setRowHov] = useState(null);
  const pushingFilesRef = useRef([]);

  const mappedFiles = files.filter(f =>
    mode === "console" ? f.deviceNum : f.deviceTarget?.trim()
  );
  const readyCount = mappedFiles.filter(f => f.raw.trim()).length;

  const usedDeviceNums = {};
  files.forEach(f => { if (f.deviceNum) usedDeviceNums[f.deviceNum] = f.name; });

  useEffect(() => {
    if ((status === "done" || status === "error") && results && pushingFilesRef.current.length) {
      const snapshot = pushingFilesRef.current.map(f => ({
        fileId: f.id, name: f.name,
        device: mode === "console" ? f.deviceNum : f.deviceTarget,
        status: results.configs[f.name] ? "success"
          : results.errors.includes(f.name) ? "failed"
          : "pending",
        error: results.deviceErrors?.[f.name]?.join("; ") || null,
        info: results.configs[f.name] || null,
      }));
      setLastPush({ timestamp: new Date(), devices: snapshot });
      const next = {};
      snapshot.forEach(s => { next[s.fileId] = s.status; });
      setStatusMap(next);
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const authHeaders = () => {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  };

  const doPush = async (retryFileIds) => {
    const targets = retryFileIds
      ? files.filter(f => retryFileIds.includes(f.id) && (mode === "console" ? f.deviceNum : f.deviceTarget?.trim()))
      : mappedFiles.filter(f => f.raw.trim());

    if (!targets.length) { setMessage("Map at least one file to a device"); return; }

    pushingFilesRef.current = targets;
    if (!retryFileIds) { setStatusMap({}); setLastPush(null); }
    initResults(targets.length);

    if (mode === "console") {
      const creds = pod.consoleCreds();
      if (!creds) { setMessage("Connect to a pod first"); return; }
      const mappings = targets.map(f => ({ num: f.deviceNum, name: f.name, config: f.raw }));
      setMessage("Connecting to console server...");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 300000);
      try {
        const res = await fetch(`${apiBase}/api/push-console`, {
          method: "POST", headers: authHeaders(), signal: ctrl.signal,
          body: JSON.stringify({ ...creds, mappings }),
        });
        clearTimeout(timer);
        if (res.status === 401 || res.status === 429) {
          setStatus("error"); setMessage(res.status === 401 ? "Invalid API key" : "Rate limited"); return;
        }
        await readStream(res);
      } catch (e) {
        clearTimeout(timer);
        setStatus("error");
        setMessage(e.name === "AbortError" ? "Push timed out" : "Connection lost");
      }
    } else {
      if (!conn.username || !conn.password) { setMessage("Enter credentials"); return; }
      const mappings = targets.map(f => ({
        host: f.deviceTarget.trim(), port: parseInt(conn.port || "22"),
        username: conn.username, password: conn.password, enablePass: conn.enablePass,
        config: f.raw, name: f.name,
      }));
      setMessage("Pushing configs...");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 300000);
      try {
        const res = await fetch(`${apiBase}/api/push-direct`, {
          method: "POST", headers: authHeaders(), signal: ctrl.signal,
          body: JSON.stringify({ mappings }),
        });
        clearTimeout(timer);
        if (res.status === 401 || res.status === 429) {
          setStatus("error"); setMessage(res.status === 401 ? "Invalid API key" : "Rate limited"); return;
        }
        await readStream(res);
      } catch (e) {
        clearTimeout(timer);
        setStatus("error");
        setMessage(e.name === "AbortError" ? "Push timed out" : "Connection lost");
      }
    }
  };

  const liveDevices = useMemo(() => {
    if (!busy && status !== "pulling") return null;
    return pushingFilesRef.current.map(f => {
      const name = f.name;
      const isDone = results?.configs?.[name];
      const isFailed = results?.errors?.includes(name);
      const isPushing = pulling && (pulling === name || pulling.startsWith(name));
      return {
        fileId: f.id, name,
        device: mode === "console" ? f.deviceNum : f.deviceTarget,
        status: isDone ? "success" : isFailed ? "failed" : isPushing ? "pushing" : "waiting",
      };
    });
  }, [results, pulling, busy, status, mode]);

  const showProgress = (busy || status === "pulling") && liveDevices?.length > 0;
  const showLastPush = !showProgress && lastPush && !busy;

  const statusColors = (s) => ({
    success: { bg: "rgba(52,211,153,0.12)", dot: C.green, text: C.green, label: "Done" },
    pushing: { bg: C.accentDim, dot: C.accent, text: C.accent, label: "Pushing..." },
    waiting: { bg: `${C.muted}10`, dot: C.muted + "88", text: C.muted, label: "Waiting" },
    failed:  { bg: "rgba(248,113,113,0.12)", dot: C.red, text: C.red, label: "Failed" },
    pending: { bg: `${C.muted}10`, dot: C.muted + "88", text: C.muted, label: "Skipped" },
  }[s] || { bg: `${C.muted}10`, dot: C.muted + "88", text: C.muted, label: s });

  const successCount = Object.values(statusMap).filter(s => s === "success").length;
  const failedCount = Object.values(statusMap).filter(s => s === "failed").length;

  const formatTime = (d) => d?.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).replace(",", "") || "";

  const sec = { fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* FILE → DEVICE MAPPING */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={sec}>
            FILE → DEVICE {mode === "direct" ? "IPS" : "MAPPING"}
          </div>

          {mode === "console" && !devices && (
            <div style={{ fontSize: 10, color: C.muted, textAlign: "center", padding: "4px 0 6px" }}>
              Connect to a pod above to choose target devices.
            </div>
          )}

          {files.map(f => {
            const hov = rowHov === f.id;
            return (
              <div key={f.id}
                onMouseEnter={() => canHover && setRowHov(f.id)}
                onMouseLeave={() => setRowHov(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
                  border: `1px solid ${hov ? C.borderActive : C.border}`,
                  background: hov ? C.surface : C.raised,
                  transition: "background .12s, border-color .12s",
                }}
              >
                <span style={{
                  fontSize: 11, fontWeight: 700, color: C.textBright, fontFamily: mono,
                  padding: "2px 6px", background: C.bg, border: `1px solid ${C.border}`,
                  maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {f.name}
                </span>
                <span style={{ color: C.muted + "88", fontSize: 11, flexShrink: 0 }}>→</span>
                {mode === "direct" ? (
                  <input
                    placeholder="IP address"
                    list="cr-direct-hosts"
                    style={{ ...inpStyle, flex: 1, minWidth: 0, padding: "4px 8px", fontSize: 10 }}
                    value={f.deviceTarget || ""}
                    onChange={e => updateFile(f.id, { deviceTarget: e.target.value })}
                  />
                ) : (
                  <select
                    disabled={!devices}
                    style={{
                      ...inpStyle, flex: 1, minWidth: 0, padding: "4px 8px", fontSize: 10,
                      cursor: devices ? "pointer" : "not-allowed",
                      ...(f.deviceNum && {
                        background: C.blueDim,
                        borderColor: "rgba(88,166,255,0.3)",
                        color: C.blue,
                      }),
                    }}
                    value={f.deviceNum}
                    onChange={e => {
                      updateFile(f.id, { deviceNum: e.target.value });
                      if (e.target.value && f.name) persistence?.saveDeviceMapping(pod.session?.pod, f.name, e.target.value);
                    }}
                  >
                    <option value="">Select device...</option>
                    {devices && Object.entries(devices).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([num, name]) => {
                      const takenBy = usedDeviceNums[num];
                      const isTaken = takenBy && takenBy !== f.name;
                      return (
                        <option key={num} value={num} disabled={isTaken}>
                          [{num}] {name}{isTaken ? ` → ${takenBy}` : ""}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            );
          })}

          {mode === "direct" && (
            <datalist id="cr-direct-hosts">
              {[...new Set(directHosts.map(h => h.trim()).filter(Boolean))].map(h => <option key={h} value={h} />)}
            </datalist>
          )}
        </div>
      )}

      {files.length === 0 && (
        <div style={{ fontSize: 10, color: C.muted, textAlign: "center", padding: "12px 0" }}>
          Upload or paste configs in the workspace to push them.
        </div>
      )}

      {/* Push all button */}
      <button
        onClick={() => doPush()}
        disabled={!apiOnline || busy || !readyCount || (mode === "console" && !devices)}
        style={{
          width: "100%", padding: 10, border: "none",
          background: (!apiOnline || busy || !readyCount) ? C.muted + "33" : C.accent,
          color: (!apiOnline || busy || !readyCount) ? C.muted : "#000",
          fontSize: 12, fontWeight: 500, fontFamily: mono,
          cursor: (!apiOnline || busy || !readyCount) ? "not-allowed" : "pointer",
          transition: "background .15s",
        }}
      >
        {offline ? "Push unavailable" : busy ? "Pushing..." : `Push all (${readyCount} device${readyCount !== 1 ? "s" : ""})`}
      </button>
      {(successCount > 0 || failedCount > 0) && (
        <div style={{ textAlign: "center", fontSize: 10, color: C.muted + "88", fontFamily: mono, marginTop: -6 }}>
          {successCount > 0 && <span style={{ color: C.green }}>{successCount} pushed</span>}
          {successCount > 0 && failedCount > 0 && " · "}
          {failedCount > 0 && <span style={{ color: C.red }}>{failedCount} failed</span>}
        </div>
      )}

      {/* PUSH PROGRESS (live) */}
      {showProgress && liveDevices && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={sec}>PUSH PROGRESS</div>
          {liveDevices.map(d => {
            const c = statusColors(d.status);
            return (
              <div key={d.fileId} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                background: c.bg,
              }}>
                <div style={{ width: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {d.status === "pushing" ? (
                    <Loader style={{ width: 12, height: 12, color: c.dot, animation: "spin 1s linear infinite" }} />
                  ) : d.status === "success" ? (
                    <Check style={{ width: 12, height: 12, color: c.dot }} />
                  ) : d.status === "failed" ? (
                    <X style={{ width: 12, height: 12, color: c.dot }} />
                  ) : (
                    <div style={{ width: 6, height: 6, borderRadius: 99, background: c.dot }} />
                  )}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.textBright, fontFamily: mono, flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 9, color: c.text, fontFamily: mono }}>{c.label}</span>
              </div>
            );
          })}
          {results && (
            <>
              <div style={{ height: 4, background: C.border, overflow: "hidden" }}>
                <div style={{
                  height: "100%", background: C.green,
                  width: `${((results.pulled || 0) / (results.total || 1)) * 100}%`,
                  transition: "width .3s ease",
                }} />
              </div>
              <div style={{ textAlign: "center", fontSize: 10, color: C.muted + "88", fontFamily: mono }}>
                {results.pulled || 0} of {results.total || 0} complete
              </div>
            </>
          )}
        </div>
      )}

      {/* LAST PUSH (persistent) */}
      {showLastPush && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={sec}>LAST PUSH — {formatTime(lastPush.timestamp)}</div>
          {lastPush.devices.map(d => {
            const c = statusColors(d.status);
            const isExpanded = expandedErrors.has(d.fileId);
            return (
              <div key={d.fileId}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                  background: c.bg,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: 99, background: c.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.textBright, fontFamily: mono, flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 9, color: c.text, fontFamily: mono }}>{c.label}</span>
                  {d.status === "failed" && (
                    <button
                      onClick={() => doPush([d.fileId])}
                      disabled={busy}
                      style={{
                        fontSize: 10, color: C.accent, padding: "2px 8px",
                        border: `0.5px solid ${C.borderActive}`,
                        background: "transparent", cursor: busy ? "not-allowed" : "pointer",
                        fontFamily: mono, opacity: busy ? 0.4 : 1,
                      }}
                    >Retry</button>
                  )}
                </div>
                {d.status === "failed" && d.error && (
                  <div style={{ margin: "2px 0 2px 14px" }}>
                    <button
                      onClick={() => setExpandedErrors(p => {
                        const next = new Set(p);
                        isExpanded ? next.delete(d.fileId) : next.add(d.fileId);
                        return next;
                      })}
                      style={{ fontSize: 9, color: C.muted, background: "none", border: "none", cursor: "pointer", fontFamily: mono, padding: "2px 0" }}
                    >
                      {isExpanded ? "▾ Hide error" : "▸ Show error"}
                    </button>
                    {isExpanded && (
                      <div style={{
                        marginTop: 4, padding: "6px 10px",
                        borderLeft: `2px solid ${C.red}`,
                        background: "rgba(0,0,0,0.3)",
                        fontSize: 10, color: C.muted, fontFamily: mono,
                        whiteSpace: "pre-wrap", lineHeight: 1.5,
                      }}>
                        {d.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <button
            onClick={() => { setLastPush(null); setStatusMap({}); reset(); }}
            style={{
              fontSize: 10, color: C.muted + "88", background: "none", border: "none",
              cursor: "pointer", fontFamily: mono, textAlign: "center", padding: "4px 0",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            }}
          >
            <X style={{ width: 10, height: 10 }} /> Clear status
          </button>
        </div>
      )}

      {/* Status message */}
      {message && !showProgress && !showLastPush && (
        <div style={{
          padding: "8px 12px", fontSize: 10, fontWeight: 600,
          background: status === "error" ? "rgba(248,113,113,0.06)" : status === "done" ? C.greenDim : C.accentDim,
          border: `1px solid ${status === "error" ? "rgba(248,113,113,0.15)" : status === "done" ? "rgba(52,211,153,0.15)" : C.borderActive}`,
          color: status === "error" ? C.red : status === "done" ? C.green : C.accent,
        }}>
          {message}
        </div>
      )}

      <style>{`@keyframes pushPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
