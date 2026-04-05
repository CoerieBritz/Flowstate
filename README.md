# ⚡ Netwatch

**Open-source local network monitor with SOAR capabilities —**

Netwatch gives you real-time visibility into every connection leaving your machine. It correlates alerts into incidents, enriches threat indicators with VirusTotal and AbuseIPDB, and lets you automate detection logic with YAML playbooks — all running entirely on your own hardware. No cloud, no subscriptions, no telemetry.

---

## Screenshots

> _[Traffic overview — real-time bandwidth graph and per-app breakdown]_

> _[Connections tab — threat badges, one-click block/kill/snapshot actions]_

> _[Playbooks tab — library, detail view with execution pipeline, activity feed]_

> _[Incidents tab — correlated alerts with severity, status, and recommended actions]_

---

## Features

### Dashboard Tabs

| Tab | Description |
|-----|-------------|
| **📈 Traffic** | Live upload/download area chart (2-minute rolling window), per-app bandwidth breakdown with sparklines, session totals, trend badges. Includes a global connection map with animated arcs showing destination countries. |
| **📊 Analytics** | D3 Sankey flow diagram mapping processes → remote hosts → ports. Treemap view for bandwidth distribution. Top talkers ranked by session volume. |
| **🗺️ Network Map** | Force-directed topology graph (D3) showing your machine, gateway, LAN devices, and all active remote connections. Node size scales with traffic volume. |
| **🛡️ Firewall** | Persistent IP blocklist manager. Add/remove CIDRs or individual IPs. Block/unblock app-level firewall rules. Undo stack for recent actions. |
| **🔗 Connections** | Full active connection table — remote host, IP, port, protocol, status, process, and live bandwidth. Rows color-coded by threat risk score. Threat badge with feed source. One-click **Block IP**, **Kill Process**, and **Capture Snapshot** actions with confirmation. Manual 🔍 threat intel lookup per IP. |
| **🔔 Alerts** | Live alert feed with severity filtering. Covers new processes, bandwidth spikes, blocked app attempts, and threat feed matches. |
| **🚨 Incidents** | SOAR correlation engine — 5 built-in rules group related alerts into incidents with severity, status (Open/Acknowledged/Resolved), and recommended actions. Playbook-generated incidents carry a 📋 PLAYBOOK badge. |
| **📋 Playbooks** | YAML automation library — card view with trigger stats and enable/disable toggle, expandable detail view with execution pipeline, inline editor to create or modify playbooks, dry-run tester, real-time activity feed. |
| **🗒️ Audit Log** | Immutable record of every response action taken (block, kill, snapshot, blocklist change) with timestamps, targets, and results. Filterable and undoable. |
| **⚙️ Settings** | VirusTotal and AbuseIPDB API key management (masked in transit, stored locally). Alert thresholds, poll interval, display limits, threat feed management with one-click refresh. |

### SOAR Capabilities

**Threat Intelligence**
- Local blocklist feeds loaded at startup: [Feodo Tracker C2](https://feodotracker.abuse.ch/) (abuse.ch), [URLhaus](https://urlhaus.abuse.ch/), [Spamhaus DROP/EDROP](https://www.spamhaus.org/drop/), [Emerging Threats Compromised IPs](https://rules.emergingthreats.net/)
- All active connection IPs checked against loaded indicators on every poll
- SQLite cache for API lookups (`threat_cache` table) with configurable TTL

**Live Threat Enrichment**
- VirusTotal: detection ratio, malicious/suspicious engine count, last analysis date (free tier: 4 req/min)
- AbuseIPDB: confidence score, abuse category, ISP, country (free tier: 1,000 checks/day)
- Auto-lookup triggers for any threat-flagged IP
- Results surface inline on connection rows and in a dedicated ThreatIntelPanel modal

**Alert Correlation — 5 Built-in Rules**

| Rule | Description |
|------|-------------|
| R1 | Multiple threat-feed hits from the same remote IP |
| R2 | Same process connecting to multiple threat-flagged destinations |
| R3 | New process making outbound connections to known C2 infrastructure |
| R4 | Process exceeds 2× its rolling 1-hour bandwidth average |
| R5 | First observed outbound connection from a process |

**Response Actions** (alert-only — all require explicit confirmation)
- Block IP (Windows firewall rule via `netsh`)
- Kill Process (`taskkill /PID`)
- Capture Snapshot (full connection state to JSON)
- Add to Blocklist (persistent)
- Undo last action

**YAML Playbooks**
- Four starter playbooks included: Suspicious Outbound Traffic, Bandwidth Anomaly, Inbound Port Scan, New Process First Outbound
- Trigger types: `threat_flagged`, `bandwidth_spike`, `new_process`, `port_scan`
- Per-playbook enrichment toggles (VirusTotal, AbuseIPDB)
- Deduplication: same trigger won't refire until the previous incident is resolved
- Create, edit, and delete playbooks directly in the dashboard — changes write to `playbooks/*.yml` instantly
- Dry-run mode: test any playbook against current live connections without creating incidents

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Windows Host (Admin)                       │
│                                                               │
│  ┌─────────────────────────┐      ┌────────────────────────┐ │
│  │   Python Backend         │      │   React Dashboard       │ │
│  │  netwatch_backend_win.py │      │   dashboard/ (Vite)    │ │
│  │                          │      │                         │ │
│  │  psutil — connection &   │      │  📈 Traffic graph       │ │
│  │  process polling         │◄────►│  📊 Analytics / Sankey  │ │
│  │                          │  WS  │  🗺️  Network map (D3)   │ │
│  │  soar/                   │:8765 │  🔗 Connections table   │ │
│  │  ├── threat_intel.py     │      │  🚨 Incidents           │ │
│  │  ├── correlator.py       │      │  📋 Playbooks           │ │
│  │  ├── responder.py        │      │  ⚙️  Settings           │ │
│  │  ├── threat_intel_api.py │      └────────────────────────┘ │
│  │  └── playbooks.py        │      http://localhost:5173       │
│  │                          │                                   │
│  │  data/                   │                                   │
│  │  ├── history.db (SQLite) │                                   │
│  │  └── settings.json       │                                   │
│  │                          │                                   │
│  │  playbooks/*.yml         │                                   │
│  └─────────────────────────┘                                   │
│  ws://localhost:8765                                           │
└──────────────────────────────────────────────────────────────┘
```

The backend polls every second (configurable), evaluates all SOAR modules in sequence, and broadcasts a JSON snapshot to all connected WebSocket clients. The dashboard maintains rolling state and renders everything client-side — no server-side rendering, no database queries from the frontend.

---

## Quick Start

### Prerequisites

- **Python 3.12+** — [python.org](https://www.python.org/downloads/)
- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **Windows** — the backend uses `psutil` and `netsh` for Windows firewall integration. Linux/macOS support is available via `netwatch_backend.py` but response actions (block/kill) are platform-specific.

### Install

```bash
# Clone the repo
git clone https://github.com/your-username/netwatch.git
cd netwatch

# Install Python dependencies
pip install psutil websockets

# Install dashboard dependencies
cd dashboard
npm install
cd ..
```

### Run

**Windows (recommended) — double-click or run from an elevated prompt:**

```bat
start_windows.bat
```

This script self-elevates to Administrator, installs any missing dependencies, and opens the backend and Vite dev server in separate console windows.

**Manual start — two terminals:**

```bash
# Terminal 1 — backend (run as Administrator on Windows)
python netwatch_backend_win.py

# Terminal 2 — dashboard
cd dashboard
npm run dev
```

**Linux / macOS:**

```bash
bash start.sh
```

Then open **http://localhost:5173** in your browser.

> **Why Administrator?** `psutil` needs elevated privileges to read connection ownership (which process owns which socket) on Windows. Without it, many connections will show as "Unknown" process.

---

## Configuration

### API Keys

Add your free API keys in the **Settings** tab. Keys are stored in `data/settings.json` on your machine and never leave it.

| Service | Free Tier | Sign Up |
|---------|-----------|---------|
| VirusTotal | 4 req/min, 500 req/day | [virustotal.com/gui/join-us](https://www.virustotal.com/gui/join-us) |
| AbuseIPDB | 1,000 checks/day | [abuseipdb.com/register](https://www.abuseipdb.com/register) |

Without API keys, local threat feed matching still works — you just won't get live enrichment.

### Threat Feeds

Feeds are loaded from `soar/feeds/` at startup. The backend downloads them automatically on first run and exposes a **🔄 Update Feeds Now** button in Settings.

To add a custom feed, drop a `.txt` or `.csv` file of IPs/CIDRs into `soar/feeds/` and restart the backend.

### Playbooks

Playbooks are YAML files in the `playbooks/` directory. Edit them directly or use the **📋 Playbooks** tab in the dashboard.

```yaml
name: my_custom_playbook
display_name: My Custom Playbook
description: >
  Triggers when a process connects to a flagged destination
  with at least medium severity.
enabled: true

trigger:
  type: threat_flagged   # threat_flagged | bandwidth_spike | new_process | port_scan
  min_severity: medium   # low | medium | high (threat_flagged only)

enrichment:
  virustotal: true
  abuseipdb: true

incident:
  severity: HIGH         # LOW | MEDIUM | HIGH | CRITICAL
  recommended_actions:
    - Review VirusTotal results for the destination IP
    - Kill the process if it cannot be explained
    - Add the IP to the persistent blocklist
```

Changes take effect after clicking **🔄 Reload** in the Playbooks tab or restarting the backend.

---

## Data Storage

All data is stored locally in the `data/` directory:

| File | Contents |
|------|----------|
| `data/history.db` | SQLite — traffic logs, connection snapshots, threat cache |
| `data/settings.json` | API keys (write only — never read back to the frontend in plaintext), alert thresholds, display preferences |
| `data/snapshots/` | JSON connection snapshots captured via the Snapshot action |
| `data/audit.log` | Append-only log of all response actions |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.12, [psutil](https://psutil.readthedocs.io/), [websockets](https://websockets.readthedocs.io/) |
| Frontend | [React 18](https://react.dev/), [Vite](https://vitejs.dev/) |
| Visualizations | [D3](https://d3js.org/) (force graph, Sankey, treemap, geo map), [Recharts](https://recharts.org/) |
| Data | SQLite (via Python stdlib `sqlite3`) |
| Threat Intel | [Feodo Tracker](https://feodotracker.abuse.ch/), [URLhaus](https://urlhaus.abuse.ch/), [Spamhaus](https://www.spamhaus.org/drop/), [Emerging Threats](https://rules.emergingthreats.net/), VirusTotal API, AbuseIPDB API |


## Contributing

Contributions are welcome. Some areas that would benefit from help:

- **Linux / macOS response actions** — `iptables` / `pf` integration in `soar/responder.py`
- **Additional threat feeds** — new feed parsers in `soar/threat_intel.py`
- **Correlation rules** — add rules R6+ in `soar/correlator.py`
- **Playbook trigger types** — extend `soar/playbooks.py` with new trigger evaluators
- **Tests** — unit tests for the SOAR modules

To contribute:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a pull request

Please keep PRs focused — one feature or fix per PR.

---

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.

Copyright (c) 2026 Coerie
