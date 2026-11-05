import { useState, useEffect, useMemo, useRef } from "react";
import { Loader, Upload, X } from "lucide-react";
import { useTheme, mono } from "../theme";
import { Btn, canHover } from "./Shared";
import { useStream } from "../hooks/useStream";
import { useReportBusy } from "../hooks/usePodConnection";

export function PushPanel({ conn, apiKey, apiOnline, offline, mode, apiBase, inpStyle, pod, pushTabs }) {
  const { C } = useTheme();
  const { devices, directHosts } = pod;
  const { tabs, updateTab, lastPush, setLastPush, resetStatuses } = pushTabs;

  const { status, message, results, pulling, busy, readStream, reset, initResults, setStatus, setMessage } =
    useStream("push");
  useReportBusy(pod, "push", busy);

  const [expandedErrors, setExpandedErrors] = useState(new Set());
  const [rowHov, setRowHov] = useState(null);
  const pushingTabsRef = useRef([]);

  const mappedTabs = tabs.filter(t =>
    mode === "console" ? t.deviceNum : t.deviceTarget.trim()
  );
  const readyCount = mappedTabs.filter(t => t.content.trim()).length;

  const usedDeviceNums = {};
  tabs.forEach(t => { if (t.deviceNum) usedDeviceNums[t.deviceNum] = t.name; });

  // Save persistent results when push completes
  useEffect(() => {
    if ((status === "done" || status === "error") && results && pushingTabsRef.current.length) {
      const snapshot = pushingTabsRef.current.map(t => ({
        tabId: t.id, name: t.name,
        device: mode === "console" ? t.deviceNum : t.deviceTarget,
        status: results.configs[t.name] ? "success"
          : results.errors.includes(t.name) ? "failed"
          : "pending",
        error: results.deviceErrors?.[t.name]?.join("; ") || null,
        info: results.configs[t.name] || null,
      }));
      setLastPush({ timestamp: new Date(), devices: snapshot });
      snapshot.forEach(s => updateTab(s.tabId, { status: s.status }));
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const authHeaders = () => {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  };

  const doPush = async (retryTabIds) => {
    const targets = retryTabIds
      ? tabs.filter(t => retryTabIds.includes(t.id) && (mode === "console" ? t.deviceNum : t.deviceTarget.trim()))
      : mappedTabs.filter(t => t.content.trim());

    if (!targets.length) { setMessage("Map at least one tab to a device"); return; }

    pushingTabsRef.current = targets;
    if (!retryTabIds) { resetStatuses(); setLastPush(null); }
    initResults(targets.length);

    if (mode === "console") {
      const creds = pod.consoleCreds();
      if (!creds) { setMessage("Connect to a pod first"); return; }
      const mappings = targets.map(t => ({ num: t.deviceNum, name: t.name, config: t.content }));
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
      const mappings = targets.map(t => ({
        host: t.deviceTarget.trim(), port: parseInt(conn.port || "22"),
        username: conn.username, password: conn.password, enablePass: conn.enablePass,
        config: t.content, name: t.name,
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

  // Derive live device statuses during push
  const liveDevices = useMemo(() => {
    if (!busy && status !== "pulling") return null;
    return pushingTabsRef.current.map(t => {
      const name = t.name;
      const isDone = results?.configs?.[name];
      const isFailed = results?.errors?.includes(name);
      const isPushing = pulling && (pulling === name || pulling.startsWith(name));
      return {
        tabId: t.id, name,
        device: mode === "console" ? t.deviceNum : t.deviceTarget,
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

  const successCount = tabs.filter(t => t.status === "success").length;
  const failedCount = tabs.filter(t => t.status === "failed").length;
  const pendingCount = mappedTabs.filter(t => t.status === "pending" && t.content.trim()).length;

  const formatTime = (d) => d?.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).replace(",", "") || "";

  const sec = { fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* TAB → DEVICE MAPPING */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={sec}>
          TAB → DEVICE {mode === "direct" ? "IPS" : "MAPPING"}
        </div>

        {mode === "console" && !devices && (
          <div style={{ fontSize: 10, color: C.muted, textAlign: "center", padding: "4px 0 6px" }}>
            Connect to a pod above to choose target devices.
          </div>
        )}

        {tabs.map(t => {
          const hov = rowHov === t.id;
          return (
            <div key={t.id}
              onMouseEnter={() => canHover && setRowHov(t.id)}
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
                borderRadius: 4, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap", flexShrink: 0,
              }}>
                {t.name}
              </span>
              <span style={{ color: C.muted + "88", fontSize: 11, flexShrink: 0 }}>→</span>
              {mode === "direct" ? (
                <input
                  placeholder="IP address"
                  list="cr-direct-hosts"
                  style={{ ...inpStyle, flex: 1, minWidth: 0, padding: "4px 8px", fontSize: 10 }}
                  value={t.deviceTarget}
                  onChange={e => updateTab(t.id, { deviceTarget: e.target.value })}
                />
              ) : (
                <select
                  disabled={!devices}
                  style={{
                    ...inpStyle, flex: 1, minWidth: 0, padding: "4px 8px", fontSize: 10,
                    cursor: devices ? "pointer" : "not-allowed",
                    ...(t.deviceNum && {
                      background: C.blueDim,
                      borderColor: "rgba(88,166,255,0.3)",
                      color: C.blue,
                    }),
                  }}
                  value={t.deviceNum}
                  onChange={e => updateTab(t.id, { deviceNum: e.target.value })}
                >
                  <option value="">Select device...</option>
                  {devices && Object.entries(devices).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([num, name]) => {
                    const takenBy = usedDeviceNums[num];
                    const isTaken = takenBy && takenBy !== t.name;
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

      {/* Push all button */}
      <button
        onClick={() => doPush()}
        disabled={!apiOnline || busy || !readyCount || (mode === "console" && !devices)}
        style={{
          width: "100%", padding: 10, borderRadius: 6, border: "none",
          background: (!apiOnline || busy || !readyCount) ? C.muted + "33" : C.accent,
          color: (!apiOnline || busy || !readyCount) ? C.muted : "#000",
          fontSize: 12, fontWeight: 500, fontFamily: mono,
          cursor: (!apiOnline || busy || !readyCount) ? "not-allowed" : "pointer",
          transition: "background .15s",
        }}
      >
        {offline ? "Push unavailable" : busy ? "Pushing..." : `Push all (${readyCount} device${readyCount !== 1 ? "s" : ""})`}
      </button>
      {(successCount > 0 || failedCount > 0 || pendingCount > 0) && (
        <div style={{ textAlign: "center", fontSize: 10, color: C.muted + "88", fontFamily: mono, marginTop: -6 }}>
          {successCount > 0 && <span style={{ color: C.green }}>{successCount} pushed</span>}
          {successCount > 0 && (pendingCount > 0 || failedCount > 0) && " · "}
          {pendingCount > 0 && <span>{pendingCount} pending</span>}
          {pendingCount > 0 && failedCount > 0 && " · "}
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
              <div key={d.tabId} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                background: c.bg, borderRadius: 6,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: 99, background: c.dot, flexShrink: 0,
                  ...(d.status === "pushing" && { animation: "pushPulse 1s ease infinite" }),
                }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: C.textBright, fontFamily: mono, flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 9, color: c.text, fontFamily: mono }}>{c.label}</span>
              </div>
            );
          })}
          {results && (
            <>
              <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%", background: C.green, borderRadius: 2,
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
            const isExpanded = expandedErrors.has(d.tabId);
            return (
              <div key={d.tabId}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                  background: c.bg, borderRadius: 6,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: 99, background: c.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.textBright, fontFamily: mono, flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 9, color: c.text, fontFamily: mono }}>{c.label}</span>
                  {d.status === "failed" && (
                    <button
                      onClick={() => doPush([d.tabId])}
                      disabled={busy}
                      style={{
                        fontSize: 10, color: C.accent, padding: "2px 8px",
                        border: `0.5px solid ${C.borderActive}`, borderRadius: 4,
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
                        isExpanded ? next.delete(d.tabId) : next.add(d.tabId);
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
                        background: "rgba(0,0,0,0.3)", borderRadius: 4,
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
            onClick={() => { setLastPush(null); resetStatuses(); reset(); }}
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

      {/* Status message (shown when no progress/lastPush visible) */}
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
