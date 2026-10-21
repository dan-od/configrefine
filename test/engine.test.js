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

// Messages seen in real pulls from the lab pod (config-mode exit, Cat9k boot, nvram erase)
const SYSLOG = [
  "*Oct 20 17:30:12.345: %SYS-5-CONFIG_I: Configured from console by console",
  "*Oct 20 17:05:01.123: %IOSXE-6-PRE_INIT_DAY0_GS_INFO: Day0 Guestshell de-initilization API is being invoked",
  "*Oct 20 17:51:07.711: %SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram",
  "000123: Oct 20 2026 17:51:07 UTC: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to up",
  "%LINEPROTO-5-UPDOWN: Line protocol on Interface Vlan1, changed state to down",
];

test("syslog lines that land in a pull are stripped", () => {
  const raw = SSH_PULLED
    .replace("interface FastEthernet0/1\r\n", `${SYSLOG[0]}\r\n${SYSLOG[1]}\r\ninterface FastEthernet0/1\r\n`)
    .replace("end\r\n", `end\r\n${SYSLOG.slice(2).join("\r\n")}\r\n`);
  const out = runCleanup(raw, DEFAULT_OPTS);
  for (const l of SYSLOG) assert.ok(!out.includes(l.slice(-30)), `not stripped: ${l}`);
  assert.equal(out, runCleanup(SSH_PULLED, DEFAULT_OPTS));
});

test("banner text starting with % is kept", () => {
  const raw = "hostname R1\n!\nbanner motd ^C\n%Authorized access only - all activity is logged\n^C\n!\nend\n";
  assert.match(runCleanup(raw, DEFAULT_OPTS), /%Authorized access only/);
});
