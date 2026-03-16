import { X, PanelLeft, PanelLeftClose } from "lucide-react";
import { useTheme, mono } from "../theme";
import { IcoBtn, Toggle } from "./Shared";

export function SideBar({ opts, setOpts, open, setOpen, vp }) {
  const { C } = useTheme();
  const toggle = k => setOpts(p => ({ ...p, [k]: !p[k] }));

  if (!open) return vp.phone ? null : (
    <div style={{ width: 40, minWidth: 40, borderRight: `1px solid ${C.border}`, background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 10 }}>
      <IcoBtn icon={PanelLeft} label="Expand" onClick={() => setOpen(true)} size={16} />
    </div>
  );

  return (
    <div style={{
      width: vp.phone ? "100%" : 260, minWidth: vp.phone ? 0 : 260, display: "flex", flexDirection: "column",
      borderRight: vp.phone ? "none" : `1px solid ${C.border}`, background: C.bg, overflowY: "auto",
      ...(vp.phone && { position: "fixed", inset: 0, zIndex: 100, background: C.bg })
    }}>
      <div style={{ padding: "16px 14px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted, textTransform: "uppercase", fontFamily: mono }}>Config</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textBright, marginTop: 2 }}>Cleanup Rules</div>
        </div>
        <IcoBtn icon={vp.phone ? X : PanelLeftClose} label="Collapse" onClick={() => setOpen(false)} size={15} />
      </div>

      <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", padding: "8px 12px 4px", fontFamily: mono }}>Terminal</div>
        <Toggle on={opts.stripCliArtifacts} onToggle={() => toggle("stripCliArtifacts")} label="CLI Artifacts" desc="Prompts, errors, ^ markers" />
        <Toggle on={opts.deduplicateConfig} onToggle={() => toggle("deduplicateConfig")} label="Deduplicate" desc="Repeated config from retries" />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 12px 4px" }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", fontFamily: mono }}>Strip Sections</span>
          <div style={{ display: "flex", gap: 6 }}>
            {["All", "None"].map(lbl => (
              <button key={lbl} onClick={() => {
                const v = lbl === "All";
                setOpts(p => ({ ...p, stripServices: v, stripSecurity: v, stripLicensing: v, stripMgmtPlane: v, stripQos: v, stripHardware: v }));
              }} style={{ fontSize: 8, fontWeight: 700, color: C.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", opacity: 0.7, fontFamily: mono }}>{lbl}</button>
            ))}
          </div>
        </div>
        <Toggle on={opts.stripServices} onToggle={() => toggle("stripServices")} label="Service & Platform" desc="Timestamps, call-home svc, platform" />
        <Toggle on={opts.stripSecurity} onToggle={() => toggle("stripSecurity")} label="Security & Crypto" desc="AAA, PKI trustpoints, certificates" />
        <Toggle on={opts.stripLicensing} onToggle={() => toggle("stripLicensing")} label="Smart Licensing" desc="Call-home block, license lines" />
        <Toggle on={opts.stripMgmtPlane} onToggle={() => toggle("stripMgmtPlane")} label="Management Plane" desc="Mgmt VRF, mgmt interfaces, HTTP" />
        <Toggle on={opts.stripQos} onToggle={() => toggle("stripQos")} label="QoS Policies" desc="Class-maps, policy-maps" />
        <Toggle on={opts.stripHardware} onToggle={() => toggle("stripHardware")} label="Hardware & Infra" desc="Redundancy, transceiver, diagnostic" />

        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 3, color: C.muted + "88", textTransform: "uppercase", padding: "12px 12px 4px", fontFamily: mono }}>Formatting</div>
        <Toggle on={opts.removeBoilerplate} onToggle={() => toggle("removeBoilerplate")} label="Boilerplate" desc="'Building config...', version line" />
        <Toggle on={opts.normalizeWhitespace} onToggle={() => toggle("normalizeWhitespace")} label="Normalize Space" desc="Collapse blank & consecutive ! lines" />
        <Toggle on={opts.sortInterfaces} onToggle={() => toggle("sortInterfaces")} label="Sort Interfaces" desc="Alphabetize interface blocks" />
      </div>

      <div style={{ marginTop: "auto", padding: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ padding: "12px 14px", background: C.raised, border: `1px solid ${C.border}`, borderRadius: 0 }}>
          <div style={{ fontSize: 9.5, color: C.muted, lineHeight: 1.6 }}>
            All transforms run locally in your browser. Nothing is sent to any server.
          </div>
        </div>
      </div>
    </div>
  );
}
