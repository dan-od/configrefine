"""Simulated Cisco IOS console + console server for exercising backend prompt handling.
Modelled on behaviour seen on the lab pod (C8200L routers, C9200L switches, console server):
the "Press any key" key is swallowed (Ctrl+C is ignored) and acknowledged with a screen clear,
and an erased switch sits in Autoinstall until any console input arrives.
Extended with: show version (switch / C9200 / ISR4321), dir flash:, delete flash:vlan.dat dialog
variants, write erase / erase startup-config confirm, reload with Save? [yes/no]."""
import time as _time_mod

_t = [0.0]
def fake_time():
    _t[0] += 0.05; return _t[0]

def patch_time(*mods):
    for m in mods:
        m.time.sleep = lambda s: None
        m.time.time = fake_time

CONFIG = ("Building configuration...\r\n\r\nCurrent configuration : 100 bytes\r\n!\r\nhostname {h}\r\n!\r\n"
          "interface Gi0/0\r\n description endpoint\r\n!\r\nend\r\n")

SHOW_VERSION = {
    "switch": ("Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11, RELEASE SOFTWARE (fc3)\r\n"
               "Technical Support: http://www.cisco.com/techsupport\r\n\r\n"
               "ROM: Bootstrap program is C2960 boot loader\r\n"
               "{h} uptime is 2 hours, 3 minutes\r\n"
               "System image file is \"flash:/c2960-lanbasek9-mz.150-2.SE11.bin\"\r\n\r\n"
               "cisco WS-C2960-24TT-L (PowerPC405) processor (revision B0) with 65536K bytes of memory.\r\n"
               "24 FastEthernet interfaces\r\n2 Gigabit Ethernet interfaces\r\n\r\n"
               "Base ethernet MAC Address       : 00:1A:2B:3C:4D:00\r\n"
               "Model number                    : WS-C2960-24TT-L\r\n\r\n"
               "Switch Ports Model              SW Version            SW Image\r\n"
               "------ ----- -----              ----------            ----------\r\n"
               "*    1 26    WS-C2960-24TT-L    15.0(2)SE11           C2960-LANBASEK9-M\r\n\r\n"
               "Configuration register is 0xF\r\n"),
    "c9200": ("Cisco IOS XE Software, Version 17.03.04\r\n"
              "Cisco IOS Software [Amsterdam], Catalyst L3 Switch Software (CAT9K_LITE_IOSXE), Version 17.3.4, RELEASE SOFTWARE (fc3)\r\n"
              "{h} uptime is 1 hour, 2 minutes\r\n"
              "System image file is \"flash:packages.conf\"\r\n"
              "cisco C9200L-24T-4G (ARM64) processor with 1311283K/3071K bytes of memory.\r\n\r\n"
              "Switch Ports Model              SW Version        SW Image              Mode\r\n"
              "------ ----- -----              ----------        ----------            ----\r\n"
              "*    1 28    C9200L-24T-4G      17.03.04          CAT9K_LITE_IOSXE      INSTALL\r\n\r\n"
              "Configuration register is 0x102\r\n"),
    "router": ("Cisco IOS XE Software, Version 16.09.04\r\n"
               "Cisco IOS Software [Fuji], ISR Software (X86_64_LINUX_IOSD-UNIVERSALK9-M), Version 16.9.4, RELEASE SOFTWARE (fc2)\r\n"
               "{h} uptime is 3 hours, 1 minute\r\n"
               "System image file is \"bootflash:isr4300-universalk9.16.09.04.SPA.bin\"\r\n\r\n"
               "cisco ISR4321/K9 (1RU) processor with 1647778K/6147K bytes of memory.\r\n"
               "2 Gigabit Ethernet interfaces\r\n\r\n"
               "Configuration register is 0x2102\r\n"),
}


def dir_flash(kind, vlan_dat):
    if kind == "router":
        return ("Directory of bootflash:/\r\n\r\n"
                "   11  drwx            16384  Oct 20 2026 09:00:00 +00:00  lost+found\r\n"
                "   12  -rw-        421232640  Oct 20 2026 09:01:00 +00:00  isr4300-universalk9.16.09.04.SPA.bin\r\n"
                + ("   13  -rw-             3356  Oct 20 2026 09:05:00 +00:00  vlan.dat\r\n" if vlan_dat else "")
                + "\r\n7194652672 bytes total (6294839296 bytes free)\r\n")
    return ("Directory of flash:/\r\n\r\n"
            + ("    2  -rwx         736   Mar 1 1993 00:04:29 +00:00  vlan.dat\r\n" if vlan_dat else "")
            + "    3  -rwx    11833856   Mar 1 1993 00:16:25 +00:00  c2960-lanbasek9-mz.150-2.SE11.bin\r\n"
              "    4  -rwx        2072   Mar 1 1993 00:20:15 +00:00  multiple-fs\r\n"
              "    5  -rwx        1919   Mar 1 1993 00:20:15 +00:00  vlan.dat.bak\r\n"
              "\r\n32514048 bytes total (20458496 bytes free)\r\n")


# Exact console text from the lab C9200L after erase + reload (no startup-config)
AUTOINSTALL_SCREENS = [
    "Autoinstall trying DHCPv6 on GigabitEthernet0/0\r\nAutoinstall will terminate if any input is detected on console\r\n",
    "Autoinstall will terminate if any input is detected on console\r\nstop Autoip process\r\n",
]


class FakeIOS:
    """modes: user/priv/config/config-if. states: dialog, pressreturn, confirm, username, more,
    paging, question, savequestion.
    strict_confirm=True: at [confirm] only Ctrl+C / 'n' abort, other control chars are ignored,
    so a stray Enter would confirm (worst case).
    kind: "router" (ISR4321) | "switch" (WS-C2960) | "c9200".
    delete_style: both | reverse | confirm_only | quiet | early_missing | wrong_file."""
    def __init__(self, mode="priv", host="router1", enable_pw=None, state=None, line="",
                 strict_confirm=False, truncate=False, modified=False, kind="router", vlan_dat=False,
                 delete_style="both", dir_fails=False, echo=False, paging=True, syslog=False,
                 save_after_erase=True, autoinstall_screen=0):
        self.mode, self.host, self.pw = mode, host, enable_pw
        self.out, self.line, self.awaiting_pw = "", line, False
        self.state, self.strict, self.truncate, self.modified = state, strict_confirm, truncate, modified
        self.reloaded = False
        self.log = []
        self.kind, self.vlan_dat, self.delete_style, self.dir_fails = kind, vlan_dat, delete_style, dir_fails
        self.echo, self.paging, self.syslog, self.save_after_erase = echo, paging, syslog, save_after_erase
        self.term_len0 = False
        self.startup = True            # startup-config present in NVRAM
        self.erased = False
        self.saved_on_reload = None    # True if "yes" was answered to Save?
        self.delete_attempted = False
        self.wrong_deleted = False
        self.paged = False
        self.on_confirm = None         # action for the [confirm] state; None = reload
        self.on_question = None        # action for a "...?" question that takes a line
        self.page_rest = ""
        self.late = ""                 # output that arrives one recv() later (syslog)
        self.autoinstall_screen = autoinstall_screen
    def prompt(self):
        return {"user": f"{self.host}>", "priv": f"{self.host}#",
                "config": f"{self.host}(config)#", "config-if": f"{self.host}(config-if)#"}[self.mode]
    def recv_ready(self): return bool(self.out)
    def recv(self, n):
        o, self.out = self.out, ""
        if self.late: self.out, self.late = self.late, ""
        return o.encode()
    def _abort_confirm(self):
        self.state = None; self.on_confirm = None; self.out += "\r\n" + self.prompt()
    def send(self, data):
        for ch in data:
            self._char(ch)
    def _char(self, ch):
        if self.state == "autoinstall":
            # "Autoinstall will terminate if any input is detected on console": the key is
            # consumed and the switch drops straight to user EXEC (as seen on the lab C9200L)
            self.state = None; self.mode = "user"; self.line = ""
            self.out += "\r\n" + self.prompt(); return
        if self.state == "more":
            self.state = None; self.out += "\r\n" + self.prompt(); return
        if self.state == "paging":
            self.state = None
            if ch == " ": self.paged = True; self.out += "\x08" * 9 + " " * 9 + "\x08" * 9 + self.page_rest
            self.out += "\r\n" + self.prompt(); return
        if self.state == "confirm":
            if ch in "\r\ny":
                action, self.on_confirm = self.on_confirm, None
                if action:
                    self.state = None; action(); return
                self.reloaded = True; self.state = "dead"; self.out += "\r\n*** RELOADING ***\r\n"; return
            if ch == "\x03" or ch == "n" or not self.strict:
                self._abort_confirm()
            return
        if self.state == "dead":
            return
        if ch == "\x03":
            if self.mode.startswith("config"):
                self.mode = "priv"; self.line = ""; self.out += "^C\r\n" + self.prompt()
            elif self.state == "dialog":
                self.state = "pressreturn"; self.out += "\r\nConfiguration aborted\r\nPress RETURN to get started!\r\n"
            elif self.state in ("question", "savequestion"):
                self.state = None; self.on_question = None; self.line = ""; self.out += "^C\r\n" + self.prompt()
            # exec mode: Ctrl+C does NOT clear a half-typed line (pessimistic)
            return
        if ch == "\x15":
            self.line = ""; return
        if ch in "\r\n":
            cmd, self.line = self.line, ""; self.exec(cmd)
        else:
            self.line += ch
    def exec(self, cmd):
        self.log.append((self.state or self.prompt(), cmd))
        if self.echo: self.out += cmd
        c = cmd.strip()
        if self.state == "question":
            action, self.on_question = self.on_question, None
            self.state = None; action(c); return
        if self.state == "username":
            self.out += "\r\nUsername: "; return
        if self.state == "dialog":
            if c == "no": self.state = "pressreturn"; self.out += "\r\nPress RETURN to get started!\r\n"
            else: self.out += "\r\n% Please answer 'yes' or 'no'.\r\nWould you like to enter the initial configuration dialog? [yes/no]: "
            return
        if self.state == "savequestion":
            if c.lower() in ("y", "ye", "yes"):
                self.saved_on_reload = True; self.startup = True
                self.out += "\r\nBuilding configuration...\r\n[OK]"
            elif c.lower() in ("n", "no"):
                self.saved_on_reload = False
            else:
                self.out += "\r\n% Please answer 'yes' or 'no'.\r\nSystem configuration has been modified. Save? [yes/no]: "; return
            self.state = "confirm"; self.out += "\r\nProceed with reload? [confirm]"; return
        if self.state == "pressreturn":
            self.state = None; self.out += "\r\n" + self.prompt(); return
        if self.awaiting_pw:
            self.awaiting_pw = False
            if c == self.pw: self.mode = "priv"
            else: self.out += "\r\n% Bad secrets\r\n"
            self.out += "\r\n" + self.prompt(); return
        ok = True
        if c == "":
            pass
        elif c == "end" and self.mode.startswith("config"): self.mode = "priv"
        elif c in ("en", "enable") and self.mode == "user":
            if self.pw: self.awaiting_pw = True; self.out += "\r\nPassword: "; return
            self.mode = "priv"
        elif c == "terminal length 0" and self.mode == "priv": self.term_len0 = True
        elif c == "show running-config" and self.mode == "priv":
            cfg = CONFIG.format(h=self.host)
            self.out += "\r\n" + (cfg.split("interface")[0] if self.truncate else cfg)
            if self.truncate: return   # stalls mid-output, no prompt
        elif c in ("write erase", "erase startup-config", "erase nvram:") and self.mode == "priv":
            self._ask_confirm("Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]",
                              self._do_erase)
            return
        elif c == "show version" and self.mode == "priv":
            text = SHOW_VERSION[self.kind].format(h=self.host)
            if self.paging and not self.term_len0:
                half = len(text) // 2
                self.out += "\r\n" + text[:half] + " --More-- "
                self.page_rest = text[half:]; self.state = "paging"; return
            self.out += "\r\n" + text
        elif c == "dir flash:" and self.mode == "priv":
            if self.dir_fails:
                self.out += "\r\n%Error opening flash:/ (No such device)\r\n"
            else:
                self.out += "\r\n" + dir_flash("router" if self.kind == "router" else "switch", self.vlan_dat)
        elif c in ("delete flash:vlan.dat", "delete flash:/vlan.dat") and self.mode == "priv":
            self.delete_attempted = True; self._start_delete(); return
        elif c == "reload" and self.mode == "priv":
            if self.modified or (self.erased and self.save_after_erase):
                self.state = "savequestion"; self.out += "\r\nSystem configuration has been modified. Save? [yes/no]: "
            else:
                self.state = "confirm"; self.out += "\r\nProceed with reload? [confirm]"
            return
        elif c.startswith("interface") and self.mode.startswith("config"): self.mode = "config-if"
        else: ok = False
        if not ok: self.out += f"\r\n{' '*len(self.prompt())}^\r\n% Invalid input detected at '^' marker.\r\n"
        self.out += "\r\n" + self.prompt()

    # ---- dialogs ----
    def _ask_confirm(self, text, action):
        self.state = "confirm"; self.on_confirm = action; self.out += "\r\n" + text
    def _ask_question(self, text, action):
        self.state = "question"; self.on_question = action; self.out += "\r\n" + text
    def _do_erase(self):
        self.startup = False; self.erased = True
        self.out += "[OK]\r\nErase of nvram: complete\r\n" + self.prompt()
        if self.syslog:
            self.late += "\r\n*Mar  1 00:10:12.345: %SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram\r\n"
    def _finish_delete(self):
        if self.vlan_dat:
            self.vlan_dat = False; self.out += "\r\n" + self.prompt()
        else:
            self.out += "\r\n%Error deleting flash:/vlan.dat (No such file or directory)\r\n\r\n" + self.prompt()
    def _start_delete(self):
        st = self.delete_style
        confirm = lambda: self._ask_confirm("Delete flash:/vlan.dat? [confirm]", self._finish_delete)
        def name_q(then):
            def answer(c):
                if c not in ("", "vlan.dat"):
                    self.out += "\r\n%Error\r\n" + self.prompt(); return
                then()
            self._ask_question("Delete filename [vlan.dat]? ", answer)
        if st == "both": name_q(confirm)
        elif st == "reverse": self._ask_confirm("Delete flash:/vlan.dat? [confirm]", lambda: name_q(self._finish_delete))
        elif st == "confirm_only": confirm()
        elif st == "quiet": self._finish_delete()
        elif st == "early_missing":
            self.out += "\r\n%Error deleting flash:/vlan.dat (No such file or directory)\r\n" + self.prompt()
        elif st == "wrong_file":   # a prompt naming some other file — must be aborted, never confirmed
            self._ask_confirm("Delete flash:/config.text? [confirm]", lambda: setattr(self, "wrong_deleted", True))

    @staticmethod
    def preload(dev):
        """What's on screen when we attach (prompts printed before we connected aren't replayed)."""
        if dev.state == "dialog": dev.out = "Would you like to enter the initial configuration dialog? [yes/no]: "
        if dev.state == "pressreturn": dev.out = "router1 con0 is now available\r\n\r\nPress RETURN to get started.\r\n"
        if dev.state == "autoinstall": dev.out = AUTOINSTALL_SCREENS[dev.autoinstall_screen]
        return dev


class FakeConsoleServer:
    """Menu '> ' with numbered devices; '<n>\\n' attaches, '\\r~.' detaches."""
    def __init__(self, devices):
        self.devices = devices          # {"1": FakeIOS, ...}
        self.cur = None
        self.out = self.menu()
        self.buf = ""
        self.prev = ""
        self.typed_at_menu = []         # what the menu received
        self.typed_into = {k: "" for k in devices}  # raw input per device
    def menu(self):
        return "\r\n[POD 1]\r\n" + "".join(f"  [{k}] {d.host}\r\n" for k, d in self.devices.items()) + "> "
    def recv_ready(self):
        return bool(self.out) or (self.cur is not None and self.devices[self.cur].recv_ready())
    def recv(self, n):
        o, self.out = self.out, ""
        if self.cur is not None: o += self.devices[self.cur].recv(n).decode()
        return o.encode()
    def send(self, data):
        for ch in data:
            if self.cur is None:
                if ch in "\r\n":
                    sel = self.buf.strip(); self.buf = ""
                    if sel: self.typed_at_menu.append(sel)
                    if sel in self.devices:
                        self.cur = sel; self.waiting_key = True
                        self.out += f"\r\nConnected to {sel}. Press any key to continue\r\n"
                    else:
                        self.out += self.menu()
                else:
                    self.buf += ch
                continue
            # like the real lab server: the "any key" is swallowed (Ctrl+C is ignored, not
            # accepted) and acknowledged with a screen clear; only later keys reach the device
            if getattr(self, "waiting_key", False):
                if ch != "\x03":
                    self.waiting_key = False; self.out += "\x1b[H\x1b[J"
                continue
            # attached: detect ~. at start of line
            if ch == "~" and self.prev in ("\r", "\n", ""):
                self.prev = "~"; continue
            if ch == "." and self.prev == "~":
                self.cur = None; self.prev = ""; self.out += self.menu(); continue
            if self.prev == "~":
                self.devices[self.cur].send("~")
            self.typed_into[self.cur] += ch
            self.devices[self.cur].send(ch)
            self.prev = ch
