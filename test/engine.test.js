import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runCleanup, DEFAULT_OPTS, normalizeNewlines } from "../src/engine.js";

// Shape of a config pulled over SSH by read_running_config(): CRLF line endings,
// the "show running-config" echo and the trailing device prompt.
const SSH_PULLED = readFileSync(new URL("./fixtures/ssh-pulled-sw1.txt", import.meta.url), "utf8");

// Each interface block must be followed by a "!" before the next top-level line
function assertSeparated(out) {
  const lines = out.split("\n");
  lines.forEach((l, i) => {
    if (i === 0 || !/^(interface|router|line con|ip default-gateway)\b/.test(l)) return;
    const prev = lines[i - 1];
    const prevIsChild = /^\s/.test(prev);
    // A new top-level stanza right after an interface's child lines needs a "!" between them
    if (prevIsChild && /^interface\b/.test(lines.slice(0, i).reverse().find(x => !/^\s/.test(x)) || "")) {
      assert.fail(`missing "!" before line ${i + 1}: ${JSON.stringify(l)} (previous: ${JSON.stringify(prev)})`);
    }
  });
}

test("fixture really is CRLF", () => {
  assert.ok(SSH_PULLED.includes("\r\n"));
});

test("normalizeNewlines turns CRLF / CR into LF", () => {
  assert.equal(normalizeNewlines("a\r\nb\r\r\nc\rd"), "a\nb\nc\nd");
});

for (const sortInterfaces of [false, true]) {
  test(`SSH-pulled config keeps "!" between interface blocks (sortInterfaces=${sortInterfaces})`, () => {
    const out = runCleanup(SSH_PULLED, { ...DEFAULT_OPTS, sortInterfaces });
    assert.ok(!out.includes("\r"), "output still contains \\r");
    assertSeparated(out);
    assert.ok(!/^SW1#/m.test(out), "trailing prompt not stripped");
    assert.ok(!/show running-config/.test(out), "command echo not stripped");
    assert.match(out, /\n!\nend$/);
  });

  test(`SSH-pulled and pasted (LF) configs clean identically (sortInterfaces=${sortInterfaces})`, () => {
    const opts = { ...DEFAULT_OPTS, sortInterfaces };
    assert.equal(runCleanup(SSH_PULLED, opts), runCleanup(SSH_PULLED.replace(/\r\n/g, "\n"), opts));
  });
}

test("sortInterfaces orders blocks and gives each exactly one trailing \"!\"", () => {
  const out = runCleanup(SSH_PULLED, { ...DEFAULT_OPTS, sortInterfaces: true });
  const ifaces = out.split("\n").filter(l => l.startsWith("interface "));
  assert.deepEqual(ifaces, [...ifaces].sort((a, b) => a.localeCompare(b)));
  assert.match(out, /interface FastEthernet0\/1\n description PC-A\n switchport access vlan 10\n switchport mode access\n spanning-tree portfast\n!\ninterface FastEthernet0\/2\n/);
});

test("sortInterfaces adds a \"!\" to blocks that had none", () => {
  const raw = "hostname R1\n!\ninterface Gi0/2\n no shutdown\ninterface Gi0/1\n shutdown\nrouter ospf 1\n network 10.0.0.0 0.0.0.255 area 0\n!\nend\n";
  const out = runCleanup(raw, { ...DEFAULT_OPTS, sortInterfaces: true });
  assert.match(out, /interface Gi0\/1\n shutdown\n!\ninterface Gi0\/2\n no shutdown\n!\nrouter ospf 1/);
});
