/* ══════════════════════════════════════
   ALGORITHMIC ENGINE — zero AI
   Regex + string ops for config cleanup
   ══════════════════════════════════════ */

// ── Pre-compiled module-level patterns ─────────────────────────────────────
// Defining these once at module load time (not inside runCleanup) means they
// are compiled once per page load rather than on every call.

const RX_HOSTNAME = /^hostname\s+(\S+)/m;

// CLI artifact patterns (host-specific ones are built lazily inside runCleanup)
const RX_CLI_BASE = [
  /^[\w][\w.-]*[#>]\s*.*$/gm,
  /^[\w][\w.-]*\([^)]*\)[#>]\s*.*$/gm,
  /^\s*\^+\s*$/gm,
  /^% .*$/gm,
];

// Boilerplate patterns
const RX_BOILERPLATE = [
  /^show\s+run\S*.*$/gm,
  /^Building configuration\.\.\..*$/gm,
  /^Current configuration\s*:.*$/gm,
  /^!?\s*Last configuration change at.*$/gm,
  /^NVRAM config last updated at.*$/gm,
  /^version\s+\d+\.\d+.*$/gm,
  /^! .+$/gm,
];

// Line-level strip patterns per category
const RX_SERVICES  = [/^no service pad/i, /^service timestamps/i, /^service call-home/i, /^service password-encryption/i, /^platform\s/i];
const RX_SECURITY  = [/^no aaa new-model/i, /^aaa\s/i, /^login on-success/i, /^no device-tracking/i];
const RX_LICENSING = [/^license\s/i, /^no license\s/i];
const RX_MGMT      = [/^ip forward-protocol/i, /^ip http/i];
const RX_HARDWARE  = [/^diagnostic\s/i, /^memory\s/i, /^switch\s+\d+\s+provision/i, /^boot-start-marker/i, /^boot-end-marker/i, /^subscriber templating/i, /^multilink\s/i];

// Block-start patterns
const RX_BLOCK_CRYPTO    = [/^crypto pki/i];
const RX_BLOCK_CALLHOME  = [/^call-home/i];
const RX_BLOCK_MGMT_VRF  = [/^vrf definition\s+Mgmt/i, /^control-plane/i];
const RX_BLOCK_QOS       = [/^class-map\s/i, /^policy-map\s/i];
const RX_BLOCK_HARDWARE  = [/^redundancy/i, /^transceiver\s/i];

// ───────────────────────────────────────────────────────────────────────────

function detectHostname(text) {
  const m = text.match(RX_HOSTNAME);
  return m ? m[1] : null;
}

function deduplicateConfig(text) {
  const marker = /^hostname\s+\S+/m;
  const parts = text.split(/(^hostname\s+\S+.*$)/m).filter(Boolean);
  if (parts.filter(p => marker.test(p)).length <= 1) return text;
  let lastIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (marker.test(parts[i])) { lastIdx = i; break; }
  }
  let blockStart = lastIdx;
  for (let i = lastIdx - 1; i >= 0; i--) {
    const chunk = parts[i].trim();
    if (marker.test(chunk) || /^[\w][\w.-]*[#>]/.test(chunk)) break;
    if (chunk && !chunk.startsWith("!")) blockStart = i;
  }
  return parts.slice(blockStart).join("");
}

function removeBlocks(lines, startPatterns) {
  const result = [];
  let skip = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!skip) {
      if (startPatterns.some(rx => rx.test(l))) { skip = true; continue; }
      result.push(l);
    } else {
      if (/^\s/.test(l) || l.trim() === "" || l.trim() === "!") continue;
      skip = false;
      if (startPatterns.some(rx => rx.test(l))) { skip = true; continue; }
      result.push(l);
    }
  }
  return result;
}

function removeMgmtInterfaces(lines) {
  const result = [];
  let i = 0;
  while (i < lines.length) {
    if (/^interface\s+/.test(lines[i])) {
      const block = [lines[i]];
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === "!" || /^\s/.test(lines[j]))) {
        block.push(lines[j]);
        if (lines[j].trim() === "!") { j++; break; }
        j++;
      }
      if (!block.some(l => /^\s+vrf\s+forwarding\s+Mgmt/i.test(l))) {
        block.forEach(l => result.push(l));
      }
      i = j;
    } else {
      result.push(lines[i]);
      i++;
    }
  }
  return result;
}

export function runCleanup(text, opts) {
  let out = text;

  // 1. Custom rules
  (opts.customRules || []).filter(r => r.enabled).forEach(r => {
    try {
      const rx = new RegExp(r.pattern, "gm");
      if (r.target === "all") { out = out.replace(rx, r.replacement); return; }
      out = out.split(/(?=^interface|^router|^line)/m).map(s => {
        const t = s.trimStart();
        const hit = (r.target === "interface" && t.startsWith("interface")) ||
          (r.target === "routing" && t.startsWith("router")) ||
          (r.target === "global" && !/^(interface|router|line)/.test(t));
        return hit ? s.replace(rx, r.replacement) : s;
      }).join("");
    } catch {}
  });

  // 2. CLI artifacts — base patterns are pre-compiled; only host-specific ones built here
  if (opts.stripCliArtifacts) {
    const host = detectHostname(out);
    // Start from the pre-compiled base list (spread so we don't mutate the module constant)
    const pats = [...RX_CLI_BASE];
    if (host) {
      const h = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pats.unshift(new RegExp(`^${h}[#>].*$`, "gm"));
      pats.unshift(new RegExp(`^${h}\\([^)]*\\)[#>].*$`, "gm"));
    }
    pats.forEach(rx => out = out.replace(rx, ""));
  }

  // 3. Deduplicate
  if (opts.deduplicateConfig) out = deduplicateConfig(out);

  // 4. Boilerplate — use pre-compiled constants
  if (opts.removeBoilerplate) {
    RX_BOILERPLATE.forEach(rx => out = out.replace(rx, ""));
  }

  // 5. Granular strip options — use pre-compiled constants
  let lines = out.split("\n");

  if (opts.stripServices) {
    lines = lines.filter(l => !RX_SERVICES.some(r => r.test(l)));
  }
  if (opts.stripSecurity) {
    lines = lines.filter(l => !RX_SECURITY.some(r => r.test(l)));
    lines = removeBlocks(lines, RX_BLOCK_CRYPTO);
  }
  if (opts.stripLicensing) {
    lines = lines.filter(l => !RX_LICENSING.some(r => r.test(l)));
    lines = removeBlocks(lines, RX_BLOCK_CALLHOME);
  }
  if (opts.stripMgmtPlane) {
    lines = lines.filter(l => !RX_MGMT.some(r => r.test(l)));
    lines = removeBlocks(lines, RX_BLOCK_MGMT_VRF);
    lines = removeMgmtInterfaces(lines);
  }
  if (opts.stripQos) {
    lines = removeBlocks(lines, RX_BLOCK_QOS);
  }
  if (opts.stripHardware) {
    lines = lines.filter(l => !RX_HARDWARE.some(r => r.test(l)));
    lines = removeBlocks(lines, RX_BLOCK_HARDWARE);
  }

  out = lines.join("\n");

  // 6. Sort interfaces
  if (opts.sortInterfaces) {
    const ls = out.split("\n"), blocks = [], pre = [], post = [];
    let cur = null, passed = false;
    for (const l of ls) {
      if (/^interface\s+/.test(l)) { if (cur) blocks.push(cur); cur = [l]; passed = true; }
      else if (cur && (/^\s/.test(l) || l === "!")) cur.push(l);
      else { if (cur) { blocks.push(cur); cur = null; } (passed ? post : pre).push(l); }
    }
    if (cur) blocks.push(cur);
    blocks.sort((a, b) => a[0].localeCompare(b[0]));
    out = [...pre, ...blocks.flat(), ...post].join("\n");
  }

  // 7. Normalize whitespace
  if (opts.normalizeWhitespace) {
    const ls = out.split("\n"), result = [];
    let lastWasSep = false;
    for (const l of ls) {
      const trimmed = l.trimEnd();
      const isSep = trimmed === "" || trimmed === "!";
      if (isSep) { if (!lastWasSep) result.push("!"); lastWasSep = true; }
      else { result.push(trimmed); lastWasSep = false; }
    }
    out = result.join("\n").trim();
    if (!/\nend\s*$/.test(out) && /^end\s*$/m.test(out)) {
      out = out.replace(/^end\s*$/m, "").trim() + "\n!\nend";
    }
  }

  return out;
}

export const DEFAULT_OPTS = {
  removeBoilerplate: true, normalizeWhitespace: true, sortInterfaces: false,
  stripCliArtifacts: true, deduplicateConfig: true,
  stripServices: true, stripSecurity: true, stripLicensing: true,
  stripMgmtPlane: true, stripQos: true, stripHardware: true,
  customRules: [],
};

export const SAMPLE = `Router#show runn
             ^
% Invalid input detected at '^' marker.
Router#show running-config
Building configuration...
Current configuration : 1843 bytes
!
! Last configuration change at 14:22:10 UTC Tue Mar 10 2026
!
version 15.2
service timestamps debug datetime msec
service password-encryption
platform punt-keepalive disable-kernel-core
!
hostname Router
!
no aaa new-model
!
call-home
 contact-email-addr sch-smart-licensing@cisco.com
 profile "CiscoTAC-1"
  active
  destination transport-method http
!
no ip domain lookup
ip routing
!
crypto pki trustpoint TP-self-signed-12345
 enrollment selfsigned
 revocation-check none
!
crypto pki certificate chain TP-self-signed-12345
 certificate self-signed 01
!
license boot level network-advantage
diagnostic bootup level minimal
memory free low-watermark processor 67065
!
spanning-tree mode rapid-pvst
spanning-tree extend system-id
!
redundancy
 mode sso
!
interface GigabitEthernet0/0
 vrf forwarding Mgmt-vrf
 ip address dhcp
 shutdown
 negotiation auto
!
interface GigabitEthernet0/1
 description LAN-Internal
 ip address 192.168.10.1 255.255.255.0
 ip ospf cost 1
!
interface GigabitEthernet0/0/0
 description WAN-Primary
 ip address 203.0.113.1 255.255.255.252
 ip ospf cost 10
!
interface Loopback0
 ip address 1.1.1.1 255.255.255.255
!
router ospf 1
 router-id 1.1.1.1
 network 203.0.113.0 0.0.0.3 area 0
 network 192.168.10.0 0.0.0.255 area 1
 passive-interface default
 no passive-interface GigabitEthernet0/0/0
!
ip forward-protocol nd
ip http server
ip http authentication local
ip http secure-server
!
control-plane
!
line con 0
 logging synchronous
line vty 0 4
 login local
 transport input ssh
!
end
Router#`;
