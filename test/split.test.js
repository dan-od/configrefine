import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitConfigs, isClean } from "../src/engine.js";

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
