<p align="center">
  <img src="dashboard/app-icon.png" width="120" alt="FlowState logo">
</p>

<h1 align="center">FlowState</h1>

<p align="center">
  <b>Open-source, self-hosted network monitor for Windows with built-in SOAR.</b><br>
  See every connection leaving your machine, match it against threat intel, and respond — all locally.<br>
  No cloud. No subscriptions. No telemetry.
</p>

<p align="center">
  <a href="https://github.com/CoerieBritz/flowstate/releases/latest"><b>⬇ Download the latest release</b></a>
</p>

---

## Download & Install

1. Go to the [latest release](https://github.com/CoerieBritz/flowstate/releases/latest) and download `FlowState_1.3.0_x64-setup`.
2. Run the installer. Windows SmartScreen may warn because the installer isn't code-signed yet — click **More info → Run anyway**.
3. Launch **FlowState** from the Start menu. It asks for Administrator rights, which it needs to see which process owns each connection.

**Requirements:** Windows 10 or 11 (64-bit). Nothing else — the backend is bundled.

---

## Features

The dashboard is grouped into three sections:

### Monitor
| Tab | What it does |
|-----|--------------|
| **Traffic** | Live download/upload chart, top apps by bandwidth, session totals, global connection map |
| **Analytics** | Sankey flow (process → host → port), bandwidth treemap, top talkers |
| **Firewall** | Persistent IP/CIDR blocklist, app-level block rules, undo |

### Network
| Tab | What it does |
|-----|--------------|
| **Map** | Force-directed topology of your machine, gateway, LAN devices and remote hosts |
| **Connections** | Every active connection with process, host, port, status, threat score, and one-click Block IP / Kill Process / Snapshot |

### SOAR
| Tab | What it does |
|-----|--------------|
| **Alerts** | Live alert feed — new processes, bandwidth spikes, threat feed matches |
| **Incidents** | Alerts correlated into incidents with severity, status and recommended actions |
| **Playbooks** | YAML automation — create, edit, enable/disable and dry-run playbooks in the app |
| **Audit** | Record of every response action taken, with timestamps and results |

**Settings** (gear icon): API keys, alert thresholds, poll interval, threat feed refresh.

### Threat intelligence
- Local blocklist feeds: [Feodo Tracker](https://feodotracker.abuse.ch/), [URLhaus](https://urlhaus.abuse.ch/), [Spamhaus DROP/EDROP](https://www.spamhaus.org/drop/), [Emerging Threats](https://rules.emergingthreats.net/) — downloaded automatically on first run
- Optional live enrichment with **VirusTotal** and **AbuseIPDB** (bring your own free API keys)
- Lookups cached locally in SQLite

### Correlation rules
| Rule | Detects |
|------|---------|
| R1 | Multiple threat-feed hits from the same remote IP |
| R2 | One process connecting to several flagged destinations |
| R3 | New process connecting to known C2 infrastructure |
| R4 | Process exceeding 2× its 1-hour bandwidth average |
| R5 | First outbound connection from a process |

### Response actions
All actions are **alert-only by default** and need your confirmation:
- Block IP (Windows Firewall rule) — refuses private, loopback and gateway addresses
- Kill process — refuses critical Windows processes and FlowState itself
- Capture connection snapshot to JSON
- Add to persistent blocklist, with undo

### Security
- The dashboard ↔ backend WebSocket is bound to `localhost`, requires a per-launch token, and rejects unknown origins
- API keys are stored locally and never sent back to the UI in plain text

---

## Known limitations

- **Per-app bandwidth is estimated.** Total system traffic is split across apps by their share of connections. Real per-process byte counting (via Windows ETW) is planned.
- **Windows only.** Linux/macOS are not supported yet.
- **Alerts can be noisy** on a busy machine — tune thresholds in Settings.

---

## Configuration

### API keys (optional)
Add them in **Settings**. Without them, local threat feed matching still works.

| Service | Free tier | Sign up |
|---------|-----------|---------|
| VirusTotal | 4 req/min, 500/day | [virustotal.com](https://www.virustotal.com/gui/join-us) |
| AbuseIPDB | 1,000 checks/day | [abuseipdb.com](https://www.abuseipdb.com/register) |

### Playbooks
Edit in the **Playbooks** tab, or as YAML files in the `playbooks` folder of the data directory:

```yaml
name: my_custom_playbook
display_name: My Custom Playbook
description: Triggers when a process connects to a flagged destination.
enabled: true

trigger:
  type: threat_flagged   # threat_flagged | bandwidth_spike | new_process | port_scan
  min_severity: medium   # low | medium | high

enrichment:
  virustotal: true
  abuseipdb: true

incident:
  severity: HIGH         # LOW | MEDIUM | HIGH | CRITICAL
  recommended_actions:
    - Review VirusTotal results for the destination IP
    - Kill the process if it cannot be explained
```

### Where your data lives
Installed app: `%APPDATA%\com.coerie.flowstate\`

| Path | Contents |
|------|----------|
| `history.db` | Traffic history, connection snapshots, threat cache |
| `settings.json` | Settings and API keys |
| `feeds\` | Downloaded threat feeds (drop your own `.txt`/`.csv` of IPs here) |
| `playbooks\` | Your playbooks |
| `snapshots\` | Captured connection snapshots |
| `audit.log` | Response action log |
| `flowstate.log` | App and backend log — check this first if something breaks |

Nothing leaves your machine except threat feed downloads and the optional VirusTotal/AbuseIPDB lookups.

---

## Build from source

**Prerequisites:** Python 3.12+, Node.js 18+, Rust ([rustup.rs](https://rustup.rs/)), Windows.

```bash
git clone https://github.com/CoerieBritz/flowstate.git
cd flowstate
py -m pip install psutil websockets pyyaml pyinstaller
cd dashboard && npm install && cd ..
```

| Script | Does |
|--------|------|
| `build_backend.bat` | Compiles the Python backend into the Tauri sidecar |
| `build_dev.bat` | Runs the desktop app in dev mode (run `build_backend.bat` first) |
| `build_release.bat` | Builds the installer into `dashboard\src-tauri\target\release\bundle\nsis\` |

**Browser-only dev mode (no Tauri):**
1. As Administrator: `py flowstate_backend.py` — it prints a line `VITE_WS_TOKEN=...`
2. Put that line in `dashboard/.env.local`
3. `cd dashboard && npm run dev`, then open http://localhost:5173

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.12, psutil, websockets, SQLite |
| Frontend | React, Vite, D3, Recharts |
| Desktop | Tauri v2 (NSIS installer), PyInstaller sidecar |

---

## Contributing

Contributions welcome — especially:
- Real per-process bandwidth via ETW
- New threat feeds (`soar/threat_intel.py`) and correlation rules (`soar/correlator.py`)
- New playbook triggers (`soar/playbooks.py`)
- Tests for the SOAR modules

Fork, create a branch, keep each PR to one feature or fix, and open a pull request.

---

## License

FlowState is **dual-licensed**:

- **Community edition — [AGPL-3.0](LICENSE).** Free to use, modify and share. If you run a modified version as a network service, you must publish your changes under the same licence.
- **Commercial licence** — for use in closed-source products or without AGPL obligations. Contact **waspcb@gmail.com**.

Copyright © 2026 Coerie Britz
