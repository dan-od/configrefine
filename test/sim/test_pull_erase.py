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


def validate_pull(config):
    """Mirrors src/engine.js validatePull."""
    if not config or len(config.strip().split("\n")) < 3:
        return False, "Config too short"
    if not re.search(r"^hostname\s+\S+", config, re.MULTILINE):
        return False, "No hostname found"
    if not re.search(r"^end\s*$", config, re.MULTILINE):
        return False, "Missing 'end' marker"
    return True, None


def pull_direct(dev):
    FakeClient.dev = dev
    su.ensure_privileged_exec(dev, "")
    return su.read_running_config(dev)


def erase_direct(dev, pw=""):
    FakeClient.dev = dev
    return pu.erase_reload_direct("10.0.0.1", 22, "u", "p", pw)


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


# ── 2. Failed pull → device should NOT be erased ──

dev3 = FakeIOS(kind="router", host="R2")
short_config = "!\nend"
valid3, reason3 = validate_pull(short_config)
check("pull-erase: too-short config fails validation",
      not valid3 and reason3 == "Config too short",
      f"valid={valid3} reason={reason3}")

no_host_config = "interface Gi0/0\n ip address 10.0.0.1 255.255.255.0\n!\nend"
valid4, reason4 = validate_pull(no_host_config)
check("pull-erase: no-hostname config fails validation",
      not valid4 and reason4 == "No hostname found",
      f"valid={valid4} reason={reason4}")

no_end_config = "hostname R2\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0"
valid5, reason5 = validate_pull(no_end_config)
check("pull-erase: missing-end config fails validation",
      not valid5 and reason5 == "Missing 'end' marker",
      f"valid={valid5} reason={reason5}")


# ── 3. Full flow: pull 3 devices, validate all ──

devices_to_pull = [
    FakeIOS(kind="router", host="R-Good1"),
    FakeIOS(kind="switch", host="SW-Good", vlan_dat=True),
    FakeIOS(kind="router", host="R-Good2"),
]

pulled = {}
for dev in devices_to_pull:
    try:
        config = pull_direct(dev)
        pulled[dev.host] = config
    except Exception:
        pulled[dev.host] = None

valid_devices = []
skipped_devices = []
for name, config in pulled.items():
    ok, reason = validate_pull(config)
    if ok:
        valid_devices.append(name)
    else:
        skipped_devices.append((name, reason))

check("pull-erase: all 3 devices pulled successfully",
      len(pulled) == 3 and all(v is not None for v in pulled.values()),
      f"pulled={list(pulled.keys())}")

check("pull-erase: all 3 valid (simulator returns valid configs)",
      len(valid_devices) == 3,
      f"valid={valid_devices} skipped={skipped_devices}")


# ── 4. Simulate a partial pull (one device returns garbage) ──

pulled_partial = {
    "R-Ok": "hostname R-Ok\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0\nend",
    "SW-Ok": "hostname SW-Ok\nvlan 10\n name DATA\nend",
    "R-Broken": "% Connection timeout",
}

valid_p = []
skip_p = []
for name, config in pulled_partial.items():
    ok, reason = validate_pull(config)
    if ok:
        valid_p.append(name)
    else:
        skip_p.append((name, reason))

check("pull-erase: partial pull — 2 valid, 1 skipped",
      len(valid_p) == 2 and len(skip_p) == 1,
      f"valid={valid_p} skipped={skip_p}")

check("pull-erase: broken device skipped for correct reason",
      skip_p[0][0] == "R-Broken" and skip_p[0][1] in ("Config too short", "No hostname found", "Missing 'end' marker"),
      f"skipped={skip_p}")

check("pull-erase: valid devices are R-Ok and SW-Ok",
      set(valid_p) == {"R-Ok", "SW-Ok"},
      f"valid={valid_p}")


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


# ── 6. Nothing erased if cancelled (all skipped) ──

pulled_cancel = {
    "R1": "hostname R1\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0\nend",
    "SW1": "hostname SW1\nvlan 10\n name DATA\nend",
}

valid_cancel = [name for name, cfg in pulled_cancel.items() if validate_pull(cfg)[0]]
cancelled = True  # simulate user pressing Cancel
erased = []
if not cancelled:
    for name in valid_cancel:
        erased.append(name)

check("pull-erase: cancel → nothing erased",
      len(erased) == 0,
      f"erased={erased}")

check("pull-erase: cancel preserves valid list for re-attempt",
      len(valid_cancel) == 2,
      f"valid={valid_cancel}")


# ── 7. Empty/null config ──

check("pull-erase: null config fails validation",
      not validate_pull(None)[0],
      f"-> {validate_pull(None)}")

check("pull-erase: empty string fails validation",
      not validate_pull("")[0],
      f"-> {validate_pull('')}")

check("pull-erase: whitespace-only fails validation",
      not validate_pull("   \n  \n  ")[0],
      f"-> {validate_pull('   ')}")


# ── 8. Raw read_running_config output validates (has trailing prompt) ──

dev_raw = FakeIOS(kind="switch", host="SW-Raw", vlan_dat=True)
raw_config = pull_direct(dev_raw)
valid_raw, reason_raw = validate_pull(raw_config)
check("pull-erase: raw read_running_config output passes validation",
      valid_raw,
      f"valid={valid_raw} reason={reason_raw} last_30={raw_config[-30:]!r}")


# ── Summary ──
p = sum(results); t = len(results)
print(f"\n{'='*70}\n{p}/{t} passed{'' if p == t else f' — {t - p} FAILED'}")
sys.exit(0 if p == t else 1)
