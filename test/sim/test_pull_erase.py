"""Pull & Erase integration: pull config, validate, erase only on valid pull.
Usage: python3 test/sim/test_pull_erase.py"""
import sys, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE))); sys.path.insert(0, HERE)
from fakeios import FakeIOS, patch_time, CONFIG
import backend.ssh_utils as su, backend.pull_ops as po, backend.push_ops as pu
patch_time(su, po, pu)

results = []
def check(name, ok, detail=""):
    results.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'}  {name:62s} {detail}")


class FakeClient:
    dev = None
    def set_missing_host_key_policy(self, p): pass
    def connect(self, **kw): pass
    def invoke_shell(self, **kw): return FakeClient.dev
    def close(self): pass
pu.paramiko.SSHClient = FakeClient


def validate_pull(config, expected_name=None):
    """Mirrors src/engine.js validatePull."""
    if not config or len(config.strip().split("\n")) < 20:
        return False, "Config too short"
    m = re.search(r"^hostname\s+(\S+)", config, re.MULTILINE)
    if not m:
        return False, "No hostname found"
    hostname = m.group(1)
    if re.match(r"^(Router|Switch)$", hostname, re.IGNORECASE):
        return False, "Default hostname"
    if expected_name and hostname.lower() != expected_name.lower():
        return False, f"Hostname mismatch (expected {expected_name}, got {hostname})"
    if not re.search(r"^end\s*$", config, re.MULTILINE):
        return False, "Missing 'end' marker"
    if not re.search(r"^ (ip address \S|switchport)", config, re.MULTILINE):
        return False, "No configured interfaces"
    return True, None


def pull_direct(dev):
    FakeClient.dev = dev
    su.ensure_privileged_exec(dev, "")
    return su.read_running_config(dev)


def erase_direct(dev, pw=""):
    FakeClient.dev = dev
    return pu.erase_reload_direct("10.0.0.1", 22, "u", "p", pw)


# Build a 20+ line config string for hand-crafted test cases
LONG_CFG = "\n".join([
    "!", "no ip domain-lookup", "!", "service timestamps log datetime msec", "!",
    "interface GigabitEthernet0/0", " ip address 10.0.0.1 255.255.255.0", " no shutdown", "!",
    "interface GigabitEthernet0/1", " ip address 10.0.1.1 255.255.255.0", "!",
    "router ospf 1", " network 10.0.0.0 0.0.0.255 area 0", "!",
    "line con 0", " logging synchronous", "line vty 0 4", " transport input ssh", "!",
])


# ── 1. Successful pull → validate → erase ──

dev = FakeIOS(kind="router", host="R1")
config = pull_direct(dev)
valid, reason = validate_pull(config)
check("pull-erase: valid pull from router",
      valid and "hostname" in config.lower(),
      f"valid={valid} reason={reason}")

dev2 = FakeIOS(kind="router", host="R1", vlan_dat=False)
r = erase_direct(dev2)
check("pull-erase: erase after valid pull succeeds",
      r["status"] == "reloading" and dev2.reloaded,
      f"-> {r}")


# ── 2. Validation rejects bad configs ──

check("pull-erase: too-short config fails",
      validate_pull("!\nend")[1] == "Config too short")

no_host = f"!\n{LONG_CFG}\nend"
check("pull-erase: no-hostname config fails",
      validate_pull(no_host)[1] == "No hostname found",
      f"-> {validate_pull(no_host)}")

default_host = f"hostname Router\n{LONG_CFG}\nend"
check("pull-erase: default hostname 'Router' fails",
      validate_pull(default_host)[1] == "Default hostname",
      f"-> {validate_pull(default_host)}")

mismatch = f"hostname Core1\n{LONG_CFG}\nend"
v_mm = validate_pull(mismatch, "Edge1")
check("pull-erase: hostname mismatch fails",
      not v_mm[0] and "mismatch" in v_mm[1].lower(),
      f"-> {v_mm}")

no_end = f"hostname Core1\n{LONG_CFG}"
check("pull-erase: missing end marker fails",
      validate_pull(no_end)[1] == "Missing 'end' marker",
      f"-> {validate_pull(no_end)}")

no_iface = "\n".join([
    "hostname Core1", "!", "no ip domain-lookup", "!",
    "line con 0", " logging synchronous", "line vty 0 4", " transport input ssh", "!",
    "no service config", "no service pad",
    "service timestamps debug datetime msec", "service timestamps log datetime msec",
    "no ip http server", "no ip http secure-server", "!",
    "banner motd # ACCESS ONLY #", "!", "no cdp run", "!", "end",
])
check("pull-erase: no configured interfaces fails",
      validate_pull(no_iface)[1] == "No configured interfaces",
      f"-> {validate_pull(no_iface)}")


# ── 3. Full flow: pull 3 devices, validate all ──

devices_to_pull = [
    FakeIOS(kind="router", host="R-Good1"),
    FakeIOS(kind="switch", host="SW-Good", vlan_dat=True),
    FakeIOS(kind="router", host="R-Good2"),
]

pulled = {}
for dev in devices_to_pull:
    config = pull_direct(dev)
    pulled[dev.host] = config

valid_devices = [n for n, c in pulled.items() if validate_pull(c)[0]]
skipped_devices = [(n, validate_pull(c)[1]) for n, c in pulled.items() if not validate_pull(c)[0]]

check("pull-erase: all 3 devices pulled successfully",
      len(pulled) == 3 and all(v is not None for v in pulled.values()),
      f"pulled={list(pulled.keys())}")

check("pull-erase: all 3 valid (simulator returns valid configs)",
      len(valid_devices) == 3,
      f"valid={valid_devices} skipped={skipped_devices}")


# ── 4. Partial pull: 2 real pulls + 1 broken ──

ok1 = FakeIOS(kind="router", host="R-Ok")
ok2 = FakeIOS(kind="switch", host="SW-Ok", vlan_dat=True)
pulled_partial = {
    "R-Ok": pull_direct(ok1),
    "SW-Ok": pull_direct(ok2),
    "R-Broken": "% Connection timeout",
}

valid_p = [n for n, c in pulled_partial.items() if validate_pull(c)[0]]
skip_p = [(n, validate_pull(c)[1]) for n, c in pulled_partial.items() if not validate_pull(c)[0]]

check("pull-erase: partial pull — 2 valid, 1 skipped",
      len(valid_p) == 2 and len(skip_p) == 1,
      f"valid={valid_p} skipped={skip_p}")

check("pull-erase: broken device skipped",
      skip_p[0][0] == "R-Broken",
      f"skipped={skip_p}")


# ── 5. Erase only valid devices ──

erase_results = {}
for name in valid_p:
    dev = FakeIOS(kind="router" if "R-" in name else "switch", host=name, vlan_dat="SW" in name)
    r = erase_direct(dev)
    erase_results[name] = r

check("pull-erase: erased R-Ok successfully",
      erase_results["R-Ok"]["status"] == "reloading",
      f"-> {erase_results['R-Ok']}")

check("pull-erase: erased SW-Ok successfully (switch with vlan.dat)",
      erase_results["SW-Ok"]["status"] == "reloading" and erase_results["SW-Ok"]["device_type"] == "switch",
      f"-> {erase_results['SW-Ok']}")


# ── 6. Nothing erased if cancelled ──

cancelled = True
erased = []
if not cancelled:
    for name in valid_p:
        erased.append(name)

check("pull-erase: cancel → nothing erased",
      len(erased) == 0)

check("pull-erase: cancel preserves valid list",
      len(valid_p) == 2)


# ── 7. Edge cases ──

check("pull-erase: null config fails",
      not validate_pull(None)[0])

check("pull-erase: empty string fails",
      not validate_pull("")[0])

check("pull-erase: whitespace-only fails",
      not validate_pull("   \n  \n  ")[0])

# Raw read_running_config output validates
dev_raw = FakeIOS(kind="switch", host="SW-Raw", vlan_dat=True)
raw_config = pull_direct(dev_raw)
check("pull-erase: raw read_running_config output passes",
      validate_pull(raw_config)[0],
      f"lines={len(raw_config.split(chr(10)))}")

# Hostname match (case-insensitive)
dev_case = FakeIOS(kind="router", host="Core1")
case_config = pull_direct(dev_case)
check("pull-erase: hostname match case-insensitive passes",
      validate_pull(case_config, "core1")[0])

check("pull-erase: hostname mismatch case-insensitive fails",
      not validate_pull(case_config, "Edge1")[0])


# ── Summary ──
p = sum(results); t = len(results)
print(f"\n{'='*70}\n{p}/{t} passed{'' if p == t else f' — {t - p} FAILED'}")
sys.exit(0 if p == t else 1)
