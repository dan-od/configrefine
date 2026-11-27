import { test } from "node:test";
import assert from "node:assert/strict";
import { runPullEraseFlow } from "../src/pullEraseFlow.js";

const GOOD_CONFIG = `hostname Core1
!
no ip domain-lookup
!
interface GigabitEthernet0/0
 ip address 10.0.0.1 255.255.255.0
 no shutdown
!
interface GigabitEthernet0/1
 ip address 10.0.1.1 255.255.255.0
!
router ospf 1
 network 10.0.0.0 0.0.0.255 area 0
 network 10.0.1.0 0.0.0.255 area 0
!
line con 0
 logging synchronous
line vty 0 4
 transport input ssh
!
end`;

const SHORT_CONFIG = "hostname R1\nend";
const DEFAULT_HOST = `hostname Router
interface GigabitEthernet0/0
 ip address 10.0.0.1 255.255.255.0
!
router ospf 1
 network 10.0.0.0 0.0.0.255 area 0
!
line con 0
line vty 0 4
!
interface Gi0/1
 ip address 10.0.1.1 255.255.255.0
!
interface Gi0/2
 ip address 10.0.2.1 255.255.255.0
!
interface Gi0/3
 ip address 10.0.3.1 255.255.255.0
!
end`;

const NO_IFACE_CONFIG = `hostname Core1
!
no ip domain-lookup
!
line con 0
 logging synchronous
line vty 0 4
 transport input ssh
!
no service config
no service pad
service timestamps debug datetime msec
service timestamps log datetime msec
no ip http server
no ip http secure-server
!
banner motd # AUTHORIZED ACCESS ONLY #
!
no cdp run
!
end`;

function makeMocks() {
  const calls = { backup: [], confirm: [], erase: [] };
  const order = [];
  return {
    calls, order,
    backup: async (configs) => { order.push("backup"); calls.backup.push(configs); },
    confirm: async (validated) => { order.push("confirm"); calls.confirm.push(validated); return true; },
    erase: async (name) => { order.push(`erase:${name}`); calls.erase.push(name); return { status: "ok" }; },
  };
}

// ── Basic flow ──

test("pull-erase: valid pull → backup → confirm → erase", async () => {
  const mocks = makeMocks();
  const result = await runPullEraseFlow(
    { Core1: { config: GOOD_CONFIG, expectedName: null } },
    mocks,
  );
  assert.equal(result.erased.length, 1);
  assert.equal(result.erased[0].name, "Core1");
  assert.ok(!result.cancelled);
  assert.deepEqual(mocks.order, ["backup", "confirm", "erase:Core1"]);
});

test("pull-erase: backup is called before any erase", async () => {
  const mocks = makeMocks();
  await runPullEraseFlow(
    { Core1: { config: GOOD_CONFIG, expectedName: null } },
    mocks,
  );
  const backupIdx = mocks.order.indexOf("backup");
  const firstErase = mocks.order.findIndex(s => s.startsWith("erase:"));
  assert.ok(backupIdx < firstErase, `backup (${backupIdx}) must come before erase (${firstErase})`);
});

// ── Failed/mismatched pull → no erase ──

test("pull-erase: too-short config is not erased", async () => {
  const mocks = makeMocks();
  const result = await runPullEraseFlow(
    { R1: { config: SHORT_CONFIG, expectedName: null } },
    mocks,
  );
  assert.equal(result.erased.length, 0);
  assert.equal(result.validated[0].valid, false);
  assert.equal(mocks.calls.erase.length, 0);
});

test("pull-erase: hostname mismatch is not erased", async () => {
  const mocks = makeMocks();
  const result = await runPullEraseFlow(
    { Core1: { config: GOOD_CONFIG, expectedName: "Edge1" } },
    mocks,
  );
  assert.equal(result.erased.length, 0);
  assert.ok(result.validated[0].reason.includes("mismatch"));
  assert.equal(mocks.calls.erase.length, 0);
});

test("pull-erase: default hostname is not erased", async () => {
  const mocks = makeMocks();
  const result = await runPullEraseFlow(
    { R1: { config: DEFAULT_HOST, expectedName: null } },
    mocks,
  );
  assert.equal(result.erased.length, 0);
  assert.equal(result.validated[0].reason, "Default hostname");
});

test("pull-erase: no configured interfaces is not erased", async () => {
  const mocks = makeMocks();
  const result = await runPullEraseFlow(
    { Core1: { config: NO_IFACE_CONFIG, expectedName: null } },
    mocks,
  );
  assert.equal(result.erased.length, 0);
  assert.equal(result.validated[0].reason, "No configured interfaces");
});

// ── Confirm returning false → zero erase calls ──

test("pull-erase: confirm() returning false means zero erase calls", async () => {
  const mocks = makeMocks();
  mocks.confirm = async () => { mocks.order.push("confirm"); return false; };
  const result = await runPullEraseFlow(
    { Core1: { config: GOOD_CONFIG, expectedName: null } },
    mocks,
  );
  assert.equal(result.erased.length, 0);
  assert.ok(result.cancelled);
  assert.equal(mocks.calls.erase.length, 0);
  assert.ok(mocks.order.includes("backup"));
});

// ── Mixed: some valid, some not ──

test("pull-erase: mixed valid/invalid — only valid devices erased", async () => {
  const mocks = makeMocks();
  const result = await runPullEraseFlow({
    Core1: { config: GOOD_CONFIG, expectedName: null },
    BadDev: { config: SHORT_CONFIG, expectedName: null },
  }, mocks);
  assert.equal(result.validated.length, 2);
  assert.equal(result.erased.length, 1);
  assert.equal(result.erased[0].name, "Core1");
  assert.ok(!mocks.calls.erase.includes("BadDev"));
});

// ── Empty results ──

test("pull-erase: empty pullResults → cancelled, no calls", async () => {
  const mocks = makeMocks();
  const result = await runPullEraseFlow({}, mocks);
  assert.ok(result.cancelled);
  assert.equal(mocks.calls.backup.length, 0);
  assert.equal(mocks.calls.erase.length, 0);
});
