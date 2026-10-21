"""Prompt-handling tests against the simulated IOS device / console server.
Usage: python3 test/sim/test_prompts.py   (needs paramiko; exits non-zero on failure)"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE))); sys.path.insert(0, HERE)
from fakeios import FakeIOS, FakeConsoleServer, patch_time
import backend.ssh_utils as su, backend.pull_ops as po, backend.push_ops as pu
patch_time(su, po, pu)
results = []
def check(name, ok, detail=""):
    results.append(ok); print(f"{'PASS' if ok else 'FAIL'}  {name:46s} {detail}")

def pull(dev, pw="cisco"):
    p = su.ensure_privileged_exec(dev, pw)
    return p, su.read_running_config(dev)

base = [
    ("left in (config)#  [original bug]", dict(mode="config")),
    ("left in (config-if)#", dict(mode="config-if", host="switch1")),
    ("half-typed line in config", dict(mode="config", line="hostname rout")),
    ("user mode, enable password", dict(mode="user", enable_pw="cisco")),
    ("already priv", dict(mode="priv")),
    ("initial config dialog", dict(mode="user", state="dialog")),
    ("exec timer expired", dict(mode="config", state="pressreturn")),
    ("--More-- pager", dict(mode="priv", state="more")),
]
for name, kw in base:
    dev = FakeIOS.preload(FakeIOS(**kw))
    try:
        p, cfg = pull(dev)
        check(name, "hostname" in cfg and "Invalid" not in cfg, f"-> {p}")
    except Exception as e:
        check(name, False, f"-> {e} {dev.log}")

# new cases: dangerous leftovers must never execute / confirm
for strict in (False, True):
    tag = "strict [confirm]" if strict else "IOS [confirm]"
    dev = FakeIOS(mode="priv", line="reload", strict_confirm=strict)
    try:
        p, cfg = pull(dev)
        check(f"half-typed 'reload' in exec ({tag})", not dev.reloaded and "hostname" in cfg, f"-> {p}, reloaded={dev.reloaded}")
    except Exception as e:
        check(f"half-typed 'reload' in exec ({tag})", False, f"-> {e}")
    dev = FakeIOS(mode="priv", state="confirm", strict_confirm=strict)
    try:
        p, cfg = pull(dev)
        check(f"left at 'Proceed with reload? [confirm]' ({tag})", not dev.reloaded, f"-> {p}, reloaded={dev.reloaded}")
    except Exception as e:
        check(f"left at 'Proceed with reload? [confirm]' ({tag})", False, f"-> {e}")

# reload reaches [confirm] via "Save? [yes/no]" on a modified device: must answer no + abort
dev = FakeIOS(mode="priv", line="reload", strict_confirm=True, modified=True)
dev.line = ""; dev.exec("reload")   # simulate it having been run already, sitting at Save?
dev.out = ""                         # prompt was printed before we attached
try:
    p, _ = pull(dev); check("left at 'Save? [yes/no]' before reload", not dev.reloaded, f"-> {p}, reloaded={dev.reloaded}")
except Exception as e:
    check("left at 'Save? [yes/no]' before reload", False, f"-> {e}")

dev = FakeIOS(mode="user", enable_pw="secret")
try: su.ensure_privileged_exec(dev, "wrong"); check("wrong enable password", False)
except RuntimeError as e: check("wrong enable password", True, f"-> raises: {e}")

dev = FakeIOS(mode="priv", state="username")
try: su.ensure_privileged_exec(dev); check("console asks for Username:", False)
except RuntimeError as e: check("console asks for Username:", True, f"-> raises: {e}")

dev = FakeIOS(mode="priv", truncate=True)
try: pull(dev); check("truncated show run", False, "returned partial output")
except RuntimeError as e: check("truncated show run", True, f"-> raises: {e}")

# console server: device 1 fails, device 2 must still pull and nothing leaks into device 1
po.ssh_connect = lambda *a: (type("C", (), {"close": lambda s: None})(), cs, cs.recv(0).decode())
cs = FakeConsoleServer({"1": FakeIOS(mode="priv", host="sw1", state="username"),
                        "2": FakeIOS(mode="config", host="r2")})
res = po.pull_all_configs("h", 22, "u", "p", {"1": "sw1", "2": "r2"})
check("console: dev1 fails, dev2 still pulls", res.get("sw1") is None and res.get("r2") and "hostname r2" in res["r2"],
      f"-> {[(k, bool(v)) for k, v in res.items()]}")
check("console: '2' went to the menu, not into dev1", "2" not in cs.typed_into["1"] and cs.typed_at_menu == ["1", "2", "x"],
      f"-> menu got {cs.typed_at_menu}")

# push and erase via console with a failing first device
cs = FakeConsoleServer({"1": FakeIOS(mode="user", enable_pw="secret", host="r1"), "2": FakeIOS(mode="priv", host="r2")})
cs.recv(0)
for num, name in (("1", "r1"), ("2", "r2")):
    try: r = pu.push_via_console(cs, num, name, "hostname r2\ninterface Gi0/0\n description x", "wrong")
    except RuntimeError as e: r = str(e)
    if num == "1": r1 = r
    else: r2 = r
check("console push: dev1 fails, dev2 pushes", isinstance(r1, str) and isinstance(r2, dict) and cs.cur is None,
      f"-> {r1!r} / {r2}")
cs = FakeConsoleServer({"1": FakeIOS(mode="priv", state="username"), "2": FakeIOS(mode="priv", host="r2")})
cs.recv(0)
try: pu.erase_reload_via_console(cs, "1", "r1"); e1 = None
except RuntimeError as e: e1 = str(e)
check("console erase: dev1 fails, back at menu", e1 and cs.cur is None, f"-> {e1}")

# Erased switch sitting in Autoinstall (exact lab console text): any input ends it, then # is reached
for screen in (0, 1):
    tail = "stop Autoip process" if screen else "Autoinstall will terminate if any input..."
    dev = FakeIOS.preload(FakeIOS(mode="user", host="Switch", state="autoinstall", autoinstall_screen=screen, strict_confirm=True))
    try:
        p, cfg = pull(dev)
        check(f"Autoinstall screen ending {tail!r}", p == "Switch#" and "hostname Switch" in cfg and not dev.reloaded, f"-> {p}")
    except Exception as e:
        check(f"Autoinstall screen ending {tail!r}", False, f"-> {e} {dev.log}")
cs = FakeConsoleServer({"1": FakeIOS(mode="user", host="Switch", state="autoinstall", autoinstall_screen=1),
                        "2": FakeIOS(mode="priv", host="r2")})
for d in cs.devices.values(): FakeIOS.preload(d)
res = po.pull_all_configs("h", 22, "u", "p", {"1": "Switch 4 (ALS2)", "2": "Router 2"})
# default hostname "Switch" -> named after its menu label (see unique_device_name)
check("console: Autoinstall switch pulls, next device too", bool(res.get("Switch 4 (ALS2)")) and bool(res.get("r2")) and cs.cur is None,
      f"-> {[(k, bool(v)) for k, v in res.items()]}")
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
