import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitConfigs, runCleanup, isClean, normalizeNewlines, DEFAULT_OPTS } from "../src/engine.js";

const detectName = (text) => { const m = text.match(/^hostname\s+(\S+)/m); return m ? m[1] : ""; };
const makeId = () => Math.random().toString(36).slice(2, 8);
const makeFile = (name, raw) => {
  const text = normalizeNewlines(raw);
  return { id: makeId(), name: name || detectName(text) || "config", raw: text, clean: "", deviceNum: "", deviceTarget: "" };
};

const EIGHT = readFileSync(new URL("./fixtures/eight-devices.txt", import.meta.url), "utf8");
const EXPECTED_NAMES = ["Core1", "Core2", "Edge1", "ISP", "DLS1", "DLS2", "ALS1", "ALS2"];

function loadEightFiles() {
  const devices = splitConfigs(EIGHT, "lab-configs.txt");
  return devices.map(d => makeFile(d.name, d.content));
}

function simulateCleanAll(files, opts) {
  return files.map(f => {
    if (isClean(f.raw)) return { ...f, clean: f.raw };
    return { ...f, clean: runCleanup(f.raw, opts) };
  });
}

function autoMap(files, devices, remembered) {
  if (!devices) return files;
  const usedNums = new Set(files.filter(f => f.deviceNum).map(f => f.deviceNum));
  return files.map(f => {
    if (f.deviceNum) return f;
    const lname = f.name.toLowerCase();
    const rNum = remembered?.[lname];
    if (rNum && devices[rNum] && !usedNums.has(rNum)) {
      usedNums.add(rNum);
      return { ...f, deviceNum: rNum };
    }
    let match = Object.entries(devices).find(([num, label]) =>
      !usedNums.has(num) && label.toLowerCase() === lname
    );
    if (!match) {
      match = Object.entries(devices).find(([num, label]) => {
        if (usedNums.has(num)) return false;
        const paren = label.match(/\(([^)]+)\)/);
        return paren && paren[1].trim().toLowerCase() === lname;
      });
    }
    if (match) {
      usedNums.add(match[0]);
      return { ...f, deviceNum: match[0] };
    }
    return f;
  });
}

// ── Clean All ────────────────────────────────────────────────────────────

test("Clean All: Input raw is byte-identical after cleaning", () => {
  const files = loadEightFiles();
  const origRaws = files.map(f => f.raw);
  const cleaned = simulateCleanAll(files, DEFAULT_OPTS);
  assert.deepEqual(cleaned.map(f => f.raw), origRaws);
});

test("Clean All: Output has 8 tabs with same names and order", () => {
  const files = loadEightFiles();
  const cleaned = simulateCleanAll(files, DEFAULT_OPTS);
  const outputFiles = cleaned.filter(f => f.clean);
  assert.equal(outputFiles.length, 8);
  assert.deepEqual(outputFiles.map(f => f.name), EXPECTED_NAMES);
});

test("Clean All: Core1 is first output tab (selected by default)", () => {
  const files = loadEightFiles();
  const cleaned = simulateCleanAll(files, DEFAULT_OPTS);
  const outputFiles = cleaned.filter(f => f.clean);
  assert.equal(outputFiles[0].name, "Core1");
});

test("Clean All: each output tab has non-empty clean content", () => {
  const files = loadEightFiles();
  const cleaned = simulateCleanAll(files, DEFAULT_OPTS);
  for (const f of cleaned) {
    assert.ok(f.clean.length > 0, `${f.name} clean should not be empty`);
  }
});

// ── Undo clean ───────────────────────────────────────────────────────────

test("Undo: clearing clean makes Output empty, Input unchanged", () => {
  const files = loadEightFiles();
  const cleaned = simulateCleanAll(files, DEFAULT_OPTS);
  const origRaws = cleaned.map(f => f.raw);
  const undone = cleaned.map(f => ({ ...f, clean: "" }));
  const outputFiles = undone.filter(f => f.clean);
  assert.equal(outputFiles.length, 0);
  assert.deepEqual(undone.map(f => f.raw), origRaws);
});

// ── Process single file ──────────────────────────────────────────────────

test("Process fills Output for a single file", () => {
  const files = loadEightFiles();
  const target = files[0];
  const cleaned = runCleanup(target.raw, DEFAULT_OPTS);
  const updated = { ...target, clean: cleaned };
  assert.ok(updated.clean.length > 0);
  assert.equal(updated.raw, target.raw);
});

// ── Re-clean rebuilds Output from Input ──────────────────────────────────

test("Re-clean: rebuilding Output from Input after undo produces same result", () => {
  const files = loadEightFiles();
  const cleaned1 = simulateCleanAll(files, DEFAULT_OPTS);
  const undone = cleaned1.map(f => ({ ...f, clean: "" }));
  const cleaned2 = simulateCleanAll(undone, DEFAULT_OPTS);
  assert.deepEqual(cleaned2.map(f => f.clean), cleaned1.map(f => f.clean));
});

// ── Auto-map with remembered mapping ─────────────────────────────────────

test("autoMap: remembered mapping maps all 8 devices", () => {
  const files = loadEightFiles();
  const devices = {
    "1": "[1] Router 1",
    "2": "[2] Router 2",
    "3": "[3] Router 3",
    "4": "[4] Router 4",
    "5": "[5] Switch 1 (DLS1)",
    "6": "[6] Switch 2 (DLS2)",
    "7": "[7] Switch 3 (ALS1)",
    "8": "[8] Switch 4 (ALS2)",
  };
  const remembered = {
    core1: "1", core2: "2", edge1: "3", isp: "4",
    dls1: "5", dls2: "6", als1: "7", als2: "8",
  };
  const mapped = autoMap(files, devices, remembered);
  assert.equal(mapped.filter(f => f.deviceNum).length, 8);
  assert.equal(mapped.find(f => f.name === "Core1").deviceNum, "1");
  assert.equal(mapped.find(f => f.name === "DLS1").deviceNum, "5");
});

// ── Auto-map bracket/parenthetical matching ──────────────────────────────

test("autoMap: bracket matching maps DLS1/DLS2/ALS1/ALS2 from parenthetical labels", () => {
  const files = loadEightFiles();
  const devices = {
    "1": "Core1",
    "2": "Core2",
    "3": "Edge1",
    "4": "ISP",
    "5": "[5] Switch 1 (DLS1)",
    "6": "[6] Switch 2 (DLS2)",
    "7": "[7] Switch 3 (ALS1)",
    "8": "[8] Switch 4 (ALS2)",
  };
  const mapped = autoMap(files, devices, {});
  assert.equal(mapped.find(f => f.name === "Core1").deviceNum, "1");
  assert.equal(mapped.find(f => f.name === "DLS1").deviceNum, "5");
  assert.equal(mapped.find(f => f.name === "DLS2").deviceNum, "6");
  assert.equal(mapped.find(f => f.name === "ALS1").deviceNum, "7");
  assert.equal(mapped.find(f => f.name === "ALS2").deviceNum, "8");
  assert.equal(mapped.filter(f => f.deviceNum).length, 8);
});

test("autoMap: without remembered, exact match works for simple labels", () => {
  const files = loadEightFiles();
  const devices = {};
  EXPECTED_NAMES.forEach((name, i) => { devices[String(i + 1)] = name; });
  const mapped = autoMap(files, devices, {});
  assert.equal(mapped.filter(f => f.deviceNum).length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(mapped[i].deviceNum, String(i + 1));
  }
});

test("autoMap: remembered takes priority over exact label match", () => {
  const files = [makeFile("Core1", "hostname Core1\n!\nend")];
  const devices = { "1": "Core1", "2": "SomethingElse" };
  const remembered = { core1: "2" };
  const mapped = autoMap(files, devices, remembered);
  assert.equal(mapped[0].deviceNum, "2");
});

test("autoMap: already-mapped files are not re-mapped", () => {
  const files = loadEightFiles();
  files[0].deviceNum = "5";
  const devices = {};
  EXPECTED_NAMES.forEach((name, i) => { devices[String(i + 1)] = name; });
  const mapped = autoMap(files, devices, {});
  assert.equal(mapped[0].deviceNum, "5");
  assert.ok(!mapped.find((f, i) => i > 0 && f.deviceNum === "5"));
});
