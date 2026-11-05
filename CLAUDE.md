# ConfigRefine

A tool for Cisco networking students and lab work: pull, clean, push and erase router and switch configs.

## Architecture

- **Frontend:** React 18 + Vite, inline styles using a theme object (`C` from `src/theme.jsx`). No CSS files.
- **Backend:** Python (Flask) API in `backend/`. Connects to Cisco devices via paramiko (SSH/console server).
- **Deploy:** GitHub Actions on push to `main` → Tailscale OAuth → rsync to homelab → Docker build & restart.
- **Live site:** configrefine.okoro.me

## Commands

```bash
npm run dev          # Vite dev server (frontend)
npm run build        # Production build
npm test             # Node test runner (test/engine.test.js, 10 tests)
python3 test/sim/test_prompts.py   # Simulator tests (23 cases)
python3 test/sim/test_erase.py     # Erase simulator tests (33 cases)
```

The Python backend is started separately: `python3 backend/api.py --serve` (or via Docker in production).

## Project structure

```
src/
  components/    # React components (LabPanel, PullPanel, PushPanel, ErasePanel, CodePanel, Logo, etc.)
  hooks/         # usePodConnection (shared pod state), useStream, useFiles, useProcessor
  engine.js      # Config parser: normalizeNewlines, interface sort, syslog-strip
  theme.jsx      # Theme object C, mono font
backend/
  ssh_utils.py   # ensure_privileged_exec, read_running_config
  pull_ops.py    # dismiss_banner, pull_single_device, escape_to_menu
  push_ops.py    # Push and erase ops, detect_switch, vlan.dat delete
  api.py         # Flask API routes
test/
  sim/fakeios.py # Realistic Cisco IOS console server simulator
  sim/test_prompts.py  # Tests for ensure_privileged_exec
  sim/test_erase.py    # Tests for erase and vlan.dat flows
  engine.test.js       # Frontend engine tests
  fixtures/            # Test fixtures (.gitattributes keeps CRLF)
public/          # Static assets (favicons, OG image, manifest)
branding/        # Logo kit sources, OG image source
.github/workflows/deploy.yml  # CI/CD
```

## Key patterns

- **Shared pod connection:** `usePodConnection` hook manages device list, connection state. `useReportBusy(pod, op, busy)` tracks active ops.
- **Console server flow:** dismiss_banner → ensure_privileged_exec → operation → escape_to_menu. Always try/finally for cleanup.
- **Offline state:** When backend is unreachable (`apiOnline === false`), fields are disabled via a `<fieldset disabled>` wrapper and button labels show "X unavailable".
- **Inline styles:** All components use the theme `C` object. No external CSS files.
- **Test fixtures:** `test/fixtures/** -text` in `.gitattributes` preserves CRLF.

## Hardware context

- Routers: C8200L (IOS-XE)
- Switches: C9200L-24T-4G (IOS-XE 17.6)
- Console server: reservations.networkinglab.ca, uses banner with progress bar, screen-clear ack on attach

## CI secrets

- `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` — Tailscale OAuth (tag:ci)
- `DEPLOY_USER` / `HOMELAB_HOST` — SSH target
- Old `TS_AUTHKEY` is deprecated (can be removed from GitHub)

## Shell notes (macOS)

- zsh doesn't word-split unquoted `$VAR` — write branch names explicitly
- `grep` is aliased to `ugrep` — `->` is treated as an option flag
- `git push` piped into grep can break the push
