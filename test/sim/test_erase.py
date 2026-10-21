"""Erase tests: write erase, switch detection, flash:vlan.dat delete dialog, reload.
Usage: python3 test/sim/test_erase.py   (needs paramiko; exits non-zero on failure)"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE))); sys.path.insert(0, HERE)
from fakeios import FakeIOS, FakeConsoleServer, patch_time, SHOW_VERSION
import backend.ssh_utils as su, backend.pull_ops as po, backend.push_ops as pu
import backend.api as api
patch_time(su, po, pu)

results = []
def check(name, ok, detail=""):
    results.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'}  {name:62s} {detail}")


class FakeClient:
    """Stands in for paramiko.SSHClient; invoke_shell hands back the current FakeIOS."""
    dev = None
    def set_missing_host_key_policy(self, p): pass
    def connect(self, **kw): pass
    def invoke_shell(self, **kw): return FakeClient.dev
    def close(self): pass
pu.paramiko.SSHClient = FakeClient


def direct(dev, pw=""):
    FakeClient.dev = dev
    return pu.erase_reload_direct("10.0.0.1", 22, "u", "p", pw)


def cmds(dev):
    return [c for _, c in dev.log]


# ── detection heuristic on raw show version text ──
for label, text, want in [
    ("WS-C2960", SHOW_VERSION["switch"], "switch"),
    ("C9200L", SHOW_VERSION["c9200"], "switch"),
    ("ISR4321", SHOW_VERSION["router"], "router"),
    ("CISCO2911 (C2900 Software)", "Cisco IOS Software, C2900 Software (C2900-UNIVERSALK9-M), Version 15.2(4)M3\r\n"
     "Cisco CISCO2911/K9 (revision 1.0) with 491520K/32768K bytes of memory.\r\n", "router"),
    ("Catalyst 8300 edge router", "Cisco IOS XE Software, Version 17.06.01\r\ncisco C8300-1N1S-6T (1RU) processor\r\n"
     "Catalyst 8300 Series Edge Platform\r\n", "router"),
    ("C8200L (lab pod, real show version)", "Cisco IOS-XE software, Copyright (c) 2005-2024 by cisco Systems, Inc.\r\n"
     "cisco C8200L-1N-4T (1RU) processor with 1701063K/6147K bytes of memory.\r\n", "router"),
    ("WS-C3750 image only", "System image file is \"flash:c3750-ipservicesk9-mz.122-55.SE.bin\"\r\n", "switch"),
]:
    got = "switch" if pu._STRONG_SWITCH_RE.search(text) else "router" if pu._ROUTER_RE.search(text) else \
        "switch" if pu._WEAK_SWITCH_RE.search(text) else "?"
    check(f"classify show version: {label}", got == want, f"-> {got}")
check("vlan.dat row regex ignores 'vlan.dat.bak' and the echoed command",
      not pu._VLAN_DAT_ROW_RE.search("dir flash:vlan.dat\r\n    5  -rwx  1919  Mar 1 1993 00:20:15 +00:00  vlan.dat.bak\r\n"))

# ── direct SSH ──
dev = FakeIOS(kind="switch", host="SW1", vlan_dat=True, echo=True, syslog=True)
r = direct(dev)
check("direct: switch with vlan.dat -> deleted, then reload",
      r == {"name": "10.0.0.1", "status": "reloading", "device_type": "switch", "vlan_dat": "deleted"}
      and not dev.vlan_dat and dev.reloaded and not dev.startup and dev.saved_on_reload is False,
      f"-> {r}, reloaded={dev.reloaded} startup={dev.startup} saved={dev.saved_on_reload}")
order = cmds(dev)
check("direct: order is write erase -> term len 0 -> delete -> reload",
      order.index("write erase") < order.index("terminal length 0") < order.index("delete flash:vlan.dat") < order.index("reload"),
      f"-> {order}")

dev = FakeIOS(kind="c9200", host="SW2", vlan_dat=False)
r = direct(dev)
check("direct: C9200 without vlan.dat -> absent, no delete, reload",
      r["device_type"] == "switch" and r["vlan_dat"] == "absent" and not dev.delete_attempted and dev.reloaded, f"-> {r}")

dev = FakeIOS(kind="switch", host="SW3", vlan_dat=False, dir_fails=True)
r = direct(dev)
check("direct: switch, dir flash: fails -> delete tried, 'No such file' = absent",
      r["vlan_dat"] == "absent" and dev.delete_attempted and dev.reloaded, f"-> {r}")

dev = FakeIOS(kind="switch", host="SW3b", vlan_dat=False, dir_fails=True, delete_style="early_missing")
r = direct(dev)
check("direct: switch, immediate '%Error ... No such file' = absent",
      r["vlan_dat"] == "absent" and dev.reloaded, f"-> {r}")

dev = FakeIOS(kind="router", host="R1")
r = direct(dev)
check("direct: ISR4321 router -> no delete attempted, n/a, reload",
      r["device_type"] == "router" and r["vlan_dat"] == "n/a" and not dev.delete_attempted and dev.reloaded,
      f"-> {r}, cmds={cmds(dev)}")

dev = FakeIOS(kind="router", host="R2", vlan_dat=True)
r = direct(dev)
check("direct: router with vlan.dat (switch module) -> deleted",
      r["device_type"] == "router" and r["vlan_dat"] == "deleted" and not dev.vlan_dat and dev.reloaded, f"-> {r}")

for style in ("reverse", "confirm_only", "quiet"):
    dev = FakeIOS(kind="switch", host="SW4", vlan_dat=True, delete_style=style)
    r = direct(dev)
    check(f"direct: delete dialog variant '{style}'", r["vlan_dat"] == "deleted" and not dev.vlan_dat and dev.reloaded,
          f"-> {r}")

dev = FakeIOS(kind="switch", host="SW5", vlan_dat=True, delete_style="wrong_file", strict_confirm=True)
try:
    r = direct(dev); err = None
except RuntimeError as e:
    err = str(e)
check("direct: prompt naming another file is aborted, no reload",
      err and not dev.wrong_deleted and not dev.reloaded, f"-> {err!r}")

dev = FakeIOS(kind="router", host="R3", modified=True, save_after_erase=False)
r = direct(dev)
check("direct: modified config -> 'no' to Save?, then reload",
      dev.saved_on_reload is False and not dev.startup and dev.reloaded, f"-> saved={dev.saved_on_reload} startup={dev.startup}")
check("direct: 'no' was the answer typed at Save?", ("savequestion", "no") in dev.log, f"-> {dev.log[-3:]}")

dev = FakeIOS(kind="router", host="R4", save_after_erase=False)
r = direct(dev)
check("direct: no Save? prompt -> straight to [confirm]", dev.reloaded and dev.saved_on_reload is None, f"-> {r}")

dev = FakeIOS(kind="switch", host="SW6", vlan_dat=True, paging=True)
dev.term_len0 = False
# break terminal length 0 so show version pages: drop the command
orig = dev.exec
def exec_no_termlen(cmd, _o=orig, _d=dev):
    if cmd.strip() == "terminal length 0":
        _d.log.append((_d.prompt(), cmd)); _d.out += "\r\n" + _d.prompt(); return
    _o(cmd)
dev.exec = exec_no_termlen
r = direct(dev)
check("direct: --More-- paged through when terminal length 0 ignored",
      dev.paged and r["device_type"] == "switch" and r["vlan_dat"] == "deleted", f"-> {r}, paged={dev.paged}")

dev = FakeIOS(kind="switch", host="SW7", mode="config-if", vlan_dat=True)
r = direct(dev)
check("direct: starts from (config-if)# -> still erased + vlan.dat deleted", r["vlan_dat"] == "deleted" and dev.reloaded,
      f"-> {r}")

dev = FakeIOS(kind="switch", host="SW8", vlan_dat=True)
orig8 = dev.exec
def exec_reject_erase(cmd, _o=orig8, _d=dev):
    if cmd.strip() == "write erase":
        _d.log.append((_d.prompt(), cmd))
        _d.out += "\r\n%Error erasing nvram: (Permission denied)\r\n" + _d.prompt(); return
    _o(cmd)
dev.exec = exec_reject_erase
try:
    direct(dev); err = None
except RuntimeError as e:
    err = str(e)
check("direct: write erase error -> raises with % line, no delete, no reload",
      err and "%Error erasing nvram" in err and not dev.delete_attempted and not dev.reloaded, f"-> {err!r}")

# ── console server ──
cs = FakeConsoleServer({"1": FakeIOS(mode="priv", host="sw1", state="username", kind="switch", vlan_dat=True),
                        "2": FakeIOS(mode="priv", host="sw2", kind="switch", vlan_dat=True, echo=True),
                        "3": FakeIOS(mode="priv", host="r3", kind="router", modified=True)})
cs.recv(0)
out = {}
for num, name in (("1", "sw1"), ("2", "sw2"), ("3", "r3")):
    try:
        out[num] = pu.erase_reload_via_console(cs, num, name)
    except RuntimeError as e:
        out[num] = f"ERR {e}"
    out[num + "_menu"] = cs.cur is None
d1, d2, d3 = cs.devices["1"], cs.devices["2"], cs.devices["3"]
check("console: dev1 fails, untouched, back at menu",
      str(out["1"]).startswith("ERR") and out["1_menu"] and d1.vlan_dat and not d1.reloaded and d1.startup, f"-> {out['1']}")
check("console: dev2 switch erased, vlan.dat deleted, reloaded, back at menu",
      out["2"] == {"name": "sw2", "status": "reloading", "device_type": "switch", "vlan_dat": "deleted"}
      and not d2.vlan_dat and d2.reloaded and not d2.startup and out["2_menu"], f"-> {out['2']}")
check("console: dev3 router 'no' to Save?, no delete, reloaded, back at menu",
      out["3"]["vlan_dat"] == "n/a" and not d3.delete_attempted and d3.saved_on_reload is False and d3.reloaded
      and out["3_menu"], f"-> {out['3']}")
check("console: menu got only device numbers", cs.typed_at_menu == ["1", "2", "3"], f"-> {cs.typed_at_menu}")

# console: delete failure must still return to menu and not reload
cs = FakeConsoleServer({"1": FakeIOS(mode="priv", host="sw1", kind="switch", vlan_dat=True, delete_style="wrong_file"),
                        "2": FakeIOS(mode="priv", host="sw2", kind="c9200", vlan_dat=True)})
cs.recv(0)
try:
    pu.erase_reload_via_console(cs, "1", "sw1"); e1 = None
except RuntimeError as e:
    e1 = str(e)
m1 = cs.cur is None
r2 = pu.erase_reload_via_console(cs, "2", "sw2")
check("console: delete failure on dev1 -> error, no reload, back at menu",
      e1 and m1 and not cs.devices["1"].reloaded, f"-> {e1!r}")
check("console: dev2 (C9200) still erased after dev1 failure",
      r2["vlan_dat"] == "deleted" and cs.devices["2"].reloaded and cs.cur is None, f"-> {r2}")

# ── api stream summary ──
check("api summary: switch deleted",
      api._erase_summary({"device_type": "switch", "vlan_dat": "deleted"}) == "Erased & reloading · switch, vlan.dat deleted")
check("api summary: router n/a", api._erase_summary({"device_type": "router", "vlan_dat": "n/a"}) == "Erased & reloading · router")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
