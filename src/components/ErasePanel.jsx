import { useState, useEffect } from "react";
import { Wifi, Loader, Check, X, Play, RotateCcw, Plus, AlertTriangle, Trash2 } from "lucide-react";
import { useTheme, mono, sans } from "../theme";
import { useViewport } from "../theme";
import { IcoBtn, Btn, canHover } from "./Shared";
import { useStream } from "../hooks/useStream";

/**
 * Erase & Reload panel — wipes selected devices back to factory defaults.
 * Supports the same direct-SSH and console-server modes as Pull/Push.
 */
export function ErasePanel({ conn, apiKey, apiOnline, mode, apiBase, inpStyle }) {
  const { C } = useTheme();
  const vp = useViewport();

  // Console-server device discovery
  const [devices, setDevices] = useState(null);
  const [pod, setPod] = useState("");
  const [selected, setSelected] = useState([]);
  const [discoverStatus, setDiscoverStatus] = useState("idle");

  // Direct-SSH host list
  const [directHosts, setDirectHosts] = useState([""]);

  // Confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // Hover states
  const [rowHov, setRowHov] = useState(null);
  const [selHov, setSelHov] = useState(null);

  const { status, message, results, pulling, busy, readStream, reset, initResults, setStatus, setMessage } =
    useStream("erase");

  // Countdown timer — starts when confirm dialog opens
  useEffect(() => {
    if (!confirmOpen) { setCountdown(3); return; }
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [confirmOpen, countdown]);

  const authHeaders = () => {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  };

  const withTimeout = (ms) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return { signal: ctrl.signal, clearTimeout: () => clearTimeout(id) };
  };

  const toggleDevice = n =>
    setSelected(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);

  // ── Discover console devices ──
  const discover = async () => {
    if (!conn.host || !conn.username || !conn.password) {
      setMessage("Enter console server credentials"); return;
    }
    setDiscoverStatus("discovering");
    setMessage("Connecting & reading device menu...");
    setDevices(null);
    const { signal, clearTimeout: clear } = withTimeout(30000);
    try {
      const res = await fetch(`${apiBase}/api/discover`, {
        method: "POST", headers: authHeaders(), signal,
        body: JSON.stringify({ host: conn.host, port: parseInt(conn.port || "22"), username: conn.username, password: conn.password }),
      });
      clear();
      if (res.status === 401) { setStatus("error"); setMessage("Invalid API key"); return; }
      const data = await res.json();
      if (data.error) { setStatus("error"); setMessage(data.error); }
      else {
        setDevices(data.devices);
        setPod(data.pod || "");
        setSelected(Object.keys(data.devices));
        setMessage(`Found ${Object.keys(data.devices).length} device${Object.keys(data.devices).length !== 1 ? "s" : ""}`);
      }
    } catch (e) {
      clear();
      setStatus("error");
      setMessage(e.name === "AbortError" ? "Discovery timed out (30s)" : "Cannot reach backend");
    } finally {
      setDiscoverStatus("idle");
    }
  };

  // ── Execute erase — called after confirmation ──
  const eraseCount = mode === "direct"
    ? directHosts.filter(h => h.trim()).length
    : selected.length;

  const executeDirect = async () => {
    const hosts = directHosts.filter(h => h.trim());
    if (!hosts.length || !conn.username || !conn.password) {
      setMessage("Enter credentials and device IPs"); return;
    }
    const devices = hosts.map(h => ({
      host: h.trim(), port: parseInt(conn.port || "22"),
      username: conn.username, password: conn.password, enablePass: conn.enablePass,
    }));
    initResults(hosts.length);
    setMessage("Erasing devices...");
    const { signal, clearTimeout: clear } = withTimeout(300000);
    try {
      const res = await fetch(`${apiBase}/api/erase-direct`, {
        method: "POST", headers: authHeaders(), signal,
        body: JSON.stringify({ devices }),
      });
      clear();
      if (res.status === 401 || res.status === 429) {
        setStatus("error"); setMessage(res.status === 401 ? "Invalid API key" : "Rate limited"); return;
      }
      await readStream(res);
    } catch (e) {
      clear();
      setStatus("error");
      setMessage(e.name === "AbortError" ? "Erase timed out" : "Connection lost");
    }
  };

  const executeConsole = async () => {
    if (!selected.length) return;
    const devMap = {};
    selected.forEach(k => { if (devices[k]) devMap[k] = devices[k]; });
    initResults(selected.length);
    setMessage("Connecting to console server...");
    const { signal, clearTimeout: clear } = withTimeout(300000);
    try {
      const res = await fetch(`${apiBase}/api/erase-console`, {
        method: "POST", headers: authHeaders(), signal,
        body: JSON.stringify({
          host: conn.host, port: parseInt(conn.port || "22"),
          username: conn.username, password: conn.password,
          enablePass: conn.enablePass, devices: devMap,
        }),
      });
      clear();
      if (res.status === 401 || res.status === 429) {
        setStatus("error"); setMessage(res.status === 401 ? "Invalid API key" : "Rate limited"); return;
      }
      await readStream(res);
    } catch (e) {
      clear();
      setStatus("error");
      setMessage(e.name === "AbortError" ? "Erase timed out" : "Connection lost");
    }
  };

  const openConfirm = () => {
    if (!eraseCount) return;
    setConfirmOpen(true);
    setCountdown(3);
  };

  const confirmErase = () => {
    setConfirmOpen(false);
    if (mode === "direct") executeDirect();
    else executeConsole();
  };

  const discovering = discoverStatus === "discovering";
  const btnLabel = busy ? "Erasing..." : `Erase & Reload ${eraseCount} Device${eraseCount !== 1 ? "s" : ""}`;

  // ── Confirmation dialog (inline on desktop, second sheet on mobile) ──
  const confirmDialog = confirmOpen && (
    vp.phone ? (
      // Mobile: full bottom sheet with higher zIndex, sits above the SSH sheet
      <>
        <div
          onClick={() => setConfirmOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 95 }}
        />
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0,
          background: C.surface, borderTop: "2px solid rgba(248,113,113,0.4)",
          borderRadius: "12px 12px 0 0", padding: "24px 20px 32px", zIndex: 96,
        }}>
          <AlertTriangle style={{ width: 32, height: 32, color: C.red, display: "block", margin: "0 auto 14px" }} />
          <div style={{ fontSize: 15, fontWeight: 800, color: C.textBright, textAlign: "center", marginBottom: 10 }}>
            Erase & Reload {eraseCount} Device{eraseCount !== 1 ? "s" : ""}?
          </div>
          <div style={{
            fontSize: 12, color: C.muted, lineHeight: 1.6, textAlign: "center",
            padding: "10px 14px", background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.15)", marginBottom: 20,
          }}>
            This will run <span style={{ fontFamily: mono, color: C.accent }}>write erase</span> and{" "}
            <span style={{ fontFamily: mono, color: C.accent }}>reload</span> on {eraseCount} device{eraseCount !== 1 ? "s" : ""}.
            All configurations will be permanently deleted. <strong style={{ color: C.textBright }}>This cannot be undone.</strong>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setConfirmOpen(false)}
              style={{
                flex: 1, height: 48, border: `1px solid ${C.border}`, background: "transparent",
                color: C.text, cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: sans,
              }}
            >
              Cancel
            </button>
            <button
              onClick={countdown === 0 ? confirmErase : undefined}
              disabled={countdown > 0}
              style={{
                flex: 1, height: 48, border: "none",
                background: countdown > 0 ? "rgba(248,113,113,0.3)" : C.red,
                color: "white", cursor: countdown > 0 ? "default" : "pointer",
                fontWeight: 700, fontSize: 13, fontFamily: sans, transition: "background .2s",
              }}
            >
              Yes, Erase All{countdown > 0 ? ` (${countdown})` : ""}
            </button>
          </div>
        </div>
      </>
    ) : (
      // Desktop: inline warning block
      <div style={{ padding: 14, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle style={{ width: 14, height: 14, color: C.red, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>
            Confirm: Erase & Reload {eraseCount} Device{eraseCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
          This will run{" "}
          <code style={{ fontFamily: mono, color: C.accent }}>write erase</code> and{" "}
          <code style={{ fontFamily: mono, color: C.accent }}>reload</code> on {eraseCount} device{eraseCount !== 1 ? "s" : ""}.
          All configurations will be permanently deleted.{" "}
          <strong style={{ color: C.textBright }}>This cannot be undone.</strong>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setConfirmOpen(false)}
            style={{
              flex: 1, padding: "9px 0", border: `1px solid ${C.border}`, background: "transparent",
              color: C.text, cursor: "pointer", fontWeight: 700, fontSize: 11, fontFamily: sans,
            }}
          >
            Cancel
          </button>
          <button
            onClick={countdown === 0 ? confirmErase : undefined}
            disabled={countdown > 0}
            style={{
              flex: 1, padding: "9px 0", border: "none",
              background: countdown > 0 ? "rgba(248,113,113,0.3)" : C.red,
              color: "white", cursor: countdown > 0 ? "default" : "pointer",
              fontWeight: 700, fontSize: 11, fontFamily: sans, transition: "background .2s",
            }}
          >
            Yes, Erase All{countdown > 0 ? ` (${countdown})` : ""}
          </button>
        </div>
      </div>
    )
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Direct SSH — host list */}
      {mode === "direct" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>Devices</span>
            <button
              onClick={() => setDirectHosts(p => [...p, ""])}
              title="Add device"
              style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", fontFamily: mono, display: "flex", alignItems: "center", gap: 3 }}
            >
              <Plus style={{ width: 10, height: 10 }} /> Add
            </button>
          </div>
          {directHosts.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 4 }}>
              <input
                placeholder="Device IP or hostname"
                style={{ ...inpStyle, flex: 1 }}
                value={h}
                onChange={e => { const n = [...directHosts]; n[i] = e.target.value; setDirectHosts(n); }}
              />
              {directHosts.length > 1 && (
                <IcoBtn icon={X} label="Remove" onClick={() => setDirectHosts(p => p.filter((_, j) => j !== i))} size={12} style={{ padding: 6 }} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Console server — discover then select */}
      {mode === "console" && !devices && (
        <Btn icon={discovering ? Loader : Wifi} onClick={discover} primary disabled={!apiOnline || discovering} style={{ justifyContent: "center", padding: "10px 0" }}>
          {discovering ? "Discovering..." : "Connect & Discover Devices"}
        </Btn>
      )}
      {mode === "console" && devices && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
              Devices{pod ? ` · POD ${pod}` : ""}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {["All", "None"].map(lbl => (
                <button
                  key={lbl}
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
              <button
                key={num}
                onClick={() => toggleDevice(num)}
                onMouseEnter={() => canHover && setRowHov(num)}
                onMouseLeave={() => setRowHov(null)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: `1px solid ${on ? "rgba(248,113,113,0.3)" : hov ? C.border : "transparent"}`, background: on ? "rgba(248,113,113,0.06)" : hov ? C.raised : "transparent", cursor: "pointer", textAlign: "left", transition: "background .12s, border-color .12s" }}
              >
                <div style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", background: on ? C.red : C.muted + "33", transition: "background .12s" }}>
                  {on && <Check style={{ width: 10, height: 10, color: "white" }} />}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: on ? C.red : hov ? C.textBright : C.text }}>[{num}]</span>
                <span style={{ fontSize: 10, color: C.muted }}>{name}</span>
              </button>
            );
          })}
          <Btn icon={RotateCcw} onClick={() => { setDevices(null); reset(); }} style={{ justifyContent: "center", fontSize: 9, padding: "6px 0" }}>Re-scan</Btn>
        </div>
      )}

      {/* Confirmation dialog (desktop inline, mobile second sheet) */}
      {confirmDialog}

      {/* Action button — only visible when dialog is NOT open */}
      {!confirmOpen && (
        <button
          onClick={openConfirm}
          disabled={!apiOnline || busy || !eraseCount || (mode === "console" && !devices)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: vp.phone ? "0 0" : "10px 0",
            height: vp.phone ? 48 : "auto",
            width: "100%",
            background: (!apiOnline || busy || !eraseCount || (mode === "console" && !devices)) ? "rgba(248,113,113,0.3)" : C.red,
            color: "white", border: "none",
            cursor: (!apiOnline || busy || !eraseCount) ? "not-allowed" : "pointer",
            fontSize: 11, fontWeight: 700, fontFamily: sans, letterSpacing: 0.5,
            opacity: (!apiOnline || !eraseCount || (mode === "console" && !devices)) ? 0.5 : 1,
            transition: "background .15s, opacity .15s",
          }}
        >
          {busy
            ? <><Loader style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />{" Erasing..."}</>
            : <><Trash2 style={{ width: 13, height: 13 }} />{` ${btnLabel}`}</>
          }
        </button>
      )}

      {/* Status bar */}
      {message && (
        <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, background: status === "error" ? "rgba(248,113,113,0.06)" : status === "done" ? C.greenDim : "rgba(248,113,113,0.06)", border: `1px solid ${status === "error" ? "rgba(248,113,113,0.15)" : status === "done" ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}`, color: status === "error" ? C.red : status === "done" ? C.green : C.red }}>
          {message}
        </div>
      )}

      {/* Results */}
      {results && (Object.keys(results.configs).length > 0 || pulling || results.errors.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>
            Erased {results.pulled}/{results.total}
          </span>
          {pulling && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid rgba(248,113,113,0.15)", background: "rgba(248,113,113,0.06)" }}>
              <Loader style={{ width: 12, height: 12, color: C.red, animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>{pulling}</span>
            </div>
          )}
          {Object.entries(results.configs).map(([name, info]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", border: `1px solid ${C.border}`, background: C.raised }}>
              <Check style={{ width: 12, height: 12, color: C.green }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.textBright }}>{name}</span>
              <span style={{ fontSize: 9, color: C.muted, marginLeft: "auto", fontFamily: mono }}>{info}</span>
            </div>
          ))}
          {results.errors.map(name => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", border: "1px solid rgba(248,113,113,0.15)", background: "rgba(248,113,113,0.04)" }}>
              <X style={{ width: 12, height: 12, color: C.red }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>{name}</span>
              <span style={{ fontSize: 9, color: C.muted, marginLeft: "auto" }}>failed</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
