# ⚡ NETWATCH — Local Network Monitor

A self-hosted GlassWire alternative that runs entirely on your machine. No cloud, no subscriptions, no telemetry.

## Features

| Feature | Description |
|---------|-------------|
| **Real-time Traffic Graph** | Live upload/download visualization with per-second updates |
| **Per-App Bandwidth** | See exactly which apps are using your network and how much |
| **Connection Inspector** | View all active connections with remote host, IP, port, and protocol |
| **Firewall Controls** | Block/allow apps from network access |
| **Alert System** | Notifications for new apps, suspicious connections, bandwidth spikes |
| **Historical Data** | SQLite database stores all traffic history locally |
| **Terminal Mode** | Works without a browser — prints a live dashboard in your terminal |

## Quick Start

### 1. Install Dependencies

```bash
pip install psutil websockets
```

### 2. Run the Backend

```bash
# Linux/macOS (may need sudo for full connection visibility)
sudo python netwatch_backend.py

# Windows (run as Administrator for full access)
python netwatch_backend.py
```

### 3. Open the Dashboard

The `network-monitor.jsx` file is a React component that renders the dashboard. You can use it in two ways:

**Option A: Use it as a Claude artifact** (you already see it rendered above!)

**Option B: Add it to your own React project**
```bash
npx create-react-app netwatch-ui
cp network-monitor.jsx netwatch-ui/src/App.jsx
cd netwatch-ui && npm start
```

To connect to the live backend, add this WebSocket hook to the component:
```javascript
useEffect(() => {
  const ws = new WebSocket('ws://localhost:8765');
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // Update state with real data instead of mock data
    setApps(data.apps);
    setHistory(prev => [...prev, { sent: data.total_sent, recv: data.total_recv }]);
    setAlerts(data.alerts);
  };
  return () => ws.close();
}, []);
```

## Architecture

```
┌─────────────────────┐     WebSocket      ┌──────────────────────┐
│  Python Backend      │ ◄──────────────► │  React Dashboard      │
│  (netwatch_backend)  │   ws://localhost   │  (network-monitor)    │
│                      │      :8765         │                       │
│  • psutil polling    │                    │  • Real-time graphs   │
│  • SQLite storage    │                    │  • App list + search  │
│  • Alert engine      │                    │  • Connection table   │
│  • Firewall cmds     │                    │  • Alert feed         │
└─────────────────────┘                    └──────────────────────┘
```

## Configuration

Edit the top of `netwatch_backend.py`:

```python
WS_HOST = "localhost"        # WebSocket bind address
WS_PORT = 8765               # WebSocket port
POLL_INTERVAL = 1.0          # Seconds between polls
ALERT_BANDWIDTH_THRESHOLD = 100 * 1024 * 1024  # 100 MB/hr alert
MAX_HISTORY_DAYS = 30        # How long to keep data
```

## Data Storage

All data is stored locally in `~/.netwatch/history.db` (SQLite). Tables:

- **traffic_log** — Per-process bandwidth over time
- **connection_log** — Active connection snapshots
- **alerts** — All generated alerts

Query your history:
```bash
sqlite3 ~/.netwatch/history.db "SELECT process_name, SUM(bytes_recv) as total_dl FROM traffic_log GROUP BY process_name ORDER BY total_dl DESC LIMIT 20"
```

## Firewall Blocking

The dashboard's block button currently marks apps as blocked in the monitor. For actual OS-level blocking:

**Linux (iptables):**
```bash
# Block by process owner (requires matching UID)
sudo iptables -A OUTPUT -m owner --uid-owner <uid> -j DROP
```

**macOS (pfctl):**
```bash
# Add to /etc/pf.conf
block out quick proto tcp from any to any user <username>
sudo pfctl -f /etc/pf.conf
```

**Windows (netsh):**
```powershell
netsh advfirewall firewall add rule name="Block App" dir=out program="C:\path\to\app.exe" action=block
```

## Comparison with GlassWire

| | GlassWire | NetWatch |
|---|-----------|----------|
| Price | $29-$99/yr | Free |
| Platform | Windows/Android | Cross-platform |
| Data storage | Cloud/local | 100% local |
| Open source | No | Yes |
| Customizable | No | Fully |
| Dependencies | Proprietary | psutil + websockets |
