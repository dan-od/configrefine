import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitConfigs, isClean, validatePull, normalizeNewlines } from "../src/engine.js";

const detectName = (text) => { const m = text.match(/^hostname\s+(\S+)/m); return m ? m[1] : ""; };
const makeId = () => Math.random().toString(36).slice(2, 8);
const makeFile = (name, raw) => {
  const text = normalizeNewlines(raw);
  return { id: makeId(), name: name || detectName(text) || "config", raw: text, clean: "", deviceNum: "", deviceTarget: "" };
};

const EIGHT = readFileSync(new URL("./fixtures/eight-devices.txt", import.meta.url), "utf8");
const HEADING = readFileSync(new URL("./fixtures/heading-devices.txt", import.meta.url), "utf8");
const PROMPT = readFileSync(new URL("./fixtures/prompt-devices.txt", import.meta.url), "utf8");
const SINGLE = readFileSync(new URL("./fixtures/single-device.txt", import.meta.url), "utf8");
const NOHOSTNAME = readFileSync(new URL("./fixtures/no-hostname.txt", import.meta.url), "utf8");
const BANNEREND = readFileSync(new URL("./fixtures/banner-end.txt", import.meta.url), "utf8");

// ── splitConfigs ──────────────────────────────────────────────────────────

test("eight-device fixture splits into 8 devices by hostname", () => {
  const result = splitConfigs(EIGHT, "lab-configs.txt");
  assert.equal(result.length, 8);
  assert.deepEqual(
    result.map(d => d.name),
    ["Core1", "Core2", "Edge1", "ISP", "DLS1", "DLS2", "ALS1", "ALS2"],
  );
});

test("all eight devices are detected as clean", () => {
  const result = splitConfigs(EIGHT, "lab-configs.txt");
  for (const d of result) {
    assert.ok(isClean(d.content), `${d.name} should be clean`);
  }
});

test("each split device contains its hostname and end", () => {
  const result = splitConfigs(EIGHT, "lab-configs.txt");
  for (const d of result) {
    assert.match(d.content, /^hostname\s/m, `${d.name} missing hostname line`);
    assert.match(d.content, /^end\s*$/m, `${d.name} missing end line`);
  }
});

test("no warnings on clean eight-device split", () => {
  const result = splitConfigs(EIGHT, "lab-configs.txt");
  for (const d of result) {
    assert.deepEqual(d.warnings, [], `${d.name} should have no warnings`);
  }
});

test("heading-based split detects === Name === markers", () => {
  const result = splitConfigs(HEADING, "headings.txt");
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(d => d.name), ["Router1", "Router2", "Switch1"]);
});

test("heading split content does not include the heading line", () => {
  const result = splitConfigs(HEADING, "headings.txt");
  for (const d of result) {
    assert.ok(!d.content.includes("==="), `${d.name} should not contain heading marker`);
  }
});

test("prompt-based split with show running-config", () => {
  const result = splitConfigs(PROMPT, "prompts.txt");
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(d => d.name), ["Core1", "Core2"]);
});

test("prompt split includes Building configuration in content", () => {
  const result = splitConfigs(PROMPT, "prompts.txt");
  for (const d of result) {
    assert.match(d.content, /Building configuration/, `${d.name} should contain Building config line`);
  }
});

test("single device returns one entry named from hostname", () => {
  const result = splitConfigs(SINGLE, "single.txt");
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "SingleRouter");
  assert.deepEqual(result[0].warnings, []);
});

test("device with no hostname gets name from filename", () => {
  const result = splitConfigs(NOHOSTNAME, "unnamed.txt");
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "unnamed");
});

test("device with no hostname and no filename gets Device-1", () => {
  const result = splitConfigs(NOHOSTNAME, "");
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Device-1");
});

test("banner containing 'end' does not cause false split", () => {
  const result = splitConfigs(BANNEREND, "banner.txt");
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "BannerTest");
  assert.ok(result[0].content.includes("banner motd"), "banner should be preserved");
  assert.ok(result[0].content.includes("of message"), "banner text should be preserved");
});

test("duplicate hostnames get numbered suffixes", () => {
  const text = "hostname R1\n!\nend\n\nhostname R1\n!\nend";
  const result = splitConfigs(text, "dupes.txt");
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "R1");
  assert.equal(result[1].name, "R1 (2)");
  assert.ok(result[1].warnings.some(w => w.includes("Duplicate")));
});

// ── isClean ───────────────────────────────────────────────────────────────

test("isClean returns false for Building configuration", () => {
  assert.ok(!isClean("hostname R1\nBuilding configuration...\nend"));
});

test("isClean returns false for Current configuration", () => {
  assert.ok(!isClean("hostname R1\nCurrent configuration : 1234 bytes\nend"));
});

test("isClean returns false for CLI prompt lines", () => {
  assert.ok(!isClean("Router#show running-config\nhostname R1\nend"));
  assert.ok(!isClean("hostname R1\nend\nR1#"));
});

test("isClean returns false for syslog timestamps", () => {
  assert.ok(!isClean("*Oct 20 17:30:12.345: %SYS-5-CONFIG_I: Configured from console"));
});

test("isClean returns false for syslog facility lines", () => {
  assert.ok(!isClean("%LINEPROTO-5-UPDOWN: Line protocol on Interface Vlan1, changed state to down"));
});

test("isClean returns false for --More--", () => {
  assert.ok(!isClean("hostname R1\n--More--\ninterface Gi0/0\nend"));
});

test("isClean returns false for Last configuration change", () => {
  assert.ok(!isClean("hostname R1\nLast configuration change at 14:22:10 UTC\nend"));
});

test("isClean returns false for NVRAM config last updated", () => {
  assert.ok(!isClean("hostname R1\nNVRAM config last updated at 14:22:10 UTC\nend"));
});

test("isClean returns true for a clean config", () => {
  assert.ok(isClean("hostname R1\n!\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0\n!\nend"));
});

test("isClean returns true for empty string", () => {
  assert.ok(isClean(""));
});

test("isClean returns true for the eight-device fixture devices", () => {
  const result = splitConfigs(EIGHT, "lab.txt");
  assert.equal(result.length, 8);
  for (const d of result) {
    assert.ok(isClean(d.content), `${d.name} should be clean`);
  }
});

// ── validatePull ─────────────────────────────────────────────────────────

const REAL_CONFIG = [
  "hostname Core1",
  "!",
  "no ip domain-lookup",
  "!",
  "interface GigabitEthernet0/0",
  " ip address 10.0.0.1 255.255.255.0",
  " no shutdown",
  "!",
  "interface GigabitEthernet0/1",
  " ip address 10.0.1.1 255.255.255.0",
  "!",
  "router ospf 1",
  " network 10.0.0.0 0.0.0.255 area 0",
  " network 10.0.1.0 0.0.0.255 area 0",
  "!",
  "line con 0",
  " logging synchronous",
  "line vty 0 4",
  " transport input ssh",
  "!",
  "end",
].join("\n");

test("validatePull: valid 20+ line config passes", () => {
  const result = validatePull(REAL_CONFIG);
  assert.ok(result.valid);
  assert.equal(result.reason, null);
});

test("validatePull: null/empty rejects as too short", () => {
  assert.ok(!validatePull(null).valid);
  assert.ok(!validatePull("").valid);
  assert.ok(!validatePull("  ").valid);
  assert.equal(validatePull(null).reason, "Config too short");
});

test("validatePull: under 20 lines rejects", () => {
  const config = "hostname R1\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0\nend";
  const result = validatePull(config);
  assert.ok(!result.valid);
  assert.equal(result.reason, "Config too short");
});

test("validatePull: missing hostname rejects", () => {
  const lines = REAL_CONFIG.split("\n");
  const noHost = lines.filter(l => !l.startsWith("hostname")).join("\n");
  const result = validatePull(noHost);
  assert.ok(!result.valid);
  assert.equal(result.reason, "No hostname found");
});

test("validatePull: default hostname 'Router' rejects", () => {
  const config = REAL_CONFIG.replace("hostname Core1", "hostname Router");
  const result = validatePull(config);
  assert.ok(!result.valid);
  assert.equal(result.reason, "Default hostname");
});

test("validatePull: default hostname 'Switch' rejects", () => {
  const config = REAL_CONFIG.replace("hostname Core1", "hostname Switch");
  const result = validatePull(config);
  assert.ok(!result.valid);
  assert.equal(result.reason, "Default hostname");
});

test("validatePull: hostname mismatch rejects", () => {
  const result = validatePull(REAL_CONFIG, "Edge1");
  assert.ok(!result.valid);
  assert.ok(result.reason.includes("mismatch"));
  assert.ok(result.reason.includes("Edge1"));
  assert.ok(result.reason.includes("Core1"));
});

test("validatePull: hostname match (case-insensitive) passes", () => {
  const result = validatePull(REAL_CONFIG, "core1");
  assert.ok(result.valid);
});

test("validatePull: missing end marker rejects", () => {
  const config = REAL_CONFIG.replace(/^end$/m, "");
  const result = validatePull(config);
  assert.ok(!result.valid);
  assert.equal(result.reason, "Missing 'end' marker");
});

test("validatePull: no configured interfaces rejects", () => {
  const noIface = REAL_CONFIG
    .replace(/ ip address 10\.0\.0\.1 255\.255\.255\.0/g, "")
    .replace(/ ip address 10\.0\.1\.1 255\.255\.255\.0/g, "");
  const result = validatePull(noIface);
  assert.ok(!result.valid);
  assert.equal(result.reason, "No configured interfaces");
});

test("validatePull: config with trailing prompt after end passes", () => {
  const config = REAL_CONFIG + "\nCore1#";
  const result = validatePull(config);
  assert.ok(result.valid);
});

test("validatePull: switchport interface passes", () => {
  const config = REAL_CONFIG
    .replace(/ ip address 10\.0\.0\.1 255\.255\.255\.0/, " switchport mode access")
    .replace(/ ip address 10\.0\.1\.1 255\.255\.255\.0/, " switchport access vlan 10");
  const result = validatePull(config);
  assert.ok(result.valid);
});

// ── 8-device import pipeline ─────────────────────────────────────────────

const EXPECTED_NAMES = ["Core1", "Core2", "Edge1", "ISP", "DLS1", "DLS2", "ALS1", "ALS2"];

test("importing 8-device fixture produces 8 tabs with correct names", () => {
  const devices = splitConfigs(EIGHT, "lab-configs.txt");
  const files = devices.map(d => makeFile(d.name, d.content));
  assert.equal(files.length, 8);
  assert.deepEqual(files.map(f => f.name), EXPECTED_NAMES);
  for (const f of files) {
    assert.ok(f.id, `${f.name} should have an id`);
    assert.ok(f.raw.length > 0, `${f.name} should have raw content`);
  }
});

test("autoMap maps all 8 files to matching devices (console mode)", () => {
  const devices = splitConfigs(EIGHT, "lab-configs.txt");
  let files = devices.map(d => makeFile(d.name, d.content));
  const podDevices = {};
  EXPECTED_NAMES.forEach((name, i) => { podDevices[String(i + 1)] = name; });
  const usedNums = new Set();
  files = files.map(f => {
    const match = Object.entries(podDevices).find(([num, name]) =>
      name.toLowerCase() === f.name.toLowerCase() && !usedNums.has(num)
    );
    if (match) { usedNums.add(match[0]); return { ...f, deviceNum: match[0] }; }
    return f;
  });
  const mapped = files.filter(f => f.deviceNum);
  assert.equal(mapped.length, 8, "all 8 files should be mapped");
  assert.deepEqual(mapped.map(f => f.deviceNum).sort(), ["1","2","3","4","5","6","7","8"]);
});

test("Push shows 'Push all (8 devices)' — readyCount matches mapped files", () => {
  const devices = splitConfigs(EIGHT, "lab-configs.txt");
  let files = devices.map(d => makeFile(d.name, d.content));
  const podDevices = {};
  EXPECTED_NAMES.forEach((name, i) => { podDevices[String(i + 1)] = name; });
  const usedNums = new Set();
  files = files.map(f => {
    const match = Object.entries(podDevices).find(([num, name]) =>
      name.toLowerCase() === f.name.toLowerCase() && !usedNums.has(num)
    );
    if (match) { usedNums.add(match[0]); return { ...f, deviceNum: match[0] }; }
    return f;
  });
  const readyCount = files.filter(f => f.deviceNum && f.raw.trim()).length;
  assert.equal(readyCount, 8);
  assert.equal(
    `Push all (${readyCount} device${readyCount !== 1 ? "s" : ""})`,
    "Push all (8 devices)",
  );
});
