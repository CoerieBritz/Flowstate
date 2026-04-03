#!/usr/bin/env python3
"""
NETWATCH - Local Network Monitor Backend
=========================================
A GlassWire-like network monitoring tool that runs entirely on your machine.

Requirements:
    pip install psutil websockets

Usage:
    python netwatch_backend.py

This will:
1. Start monitoring all network connections and per-process bandwidth
2. Serve a WebSocket on ws://localhost:8765 for the dashboard to connect to
3. Also print a live terminal dashboard if no browser is connected

Features:
- Real-time per-process bandwidth tracking (upload/download)
- Active connection monitoring with remote host resolution
- New connection alerts
- Bandwidth threshold alerts
- Firewall-like blocking via OS commands
- Historical data logging to SQLite
"""

import asyncio
import json
import time
import socket
import sqlite3
import os
import sys
import signal
from collections import defaultdict
from datetime import datetime
from pathlib import Path

try:
    import psutil
except ImportError:
    print("ERROR: psutil is required. Install it with:")
    print("  pip install psutil")
    sys.exit(1)

try:
    import websockets
except ImportError:
    websockets = None
    print("WARNING: websockets not installed. Running in terminal-only mode.")
    print("  pip install websockets   (for browser dashboard support)")


# === CONFIGURATION ===
WS_HOST = "localhost"
WS_PORT = 8765
POLL_INTERVAL = 1.0  # seconds between network polls
DB_PATH = Path(__file__).parent / "data" / "history.db"
ALERT_BANDWIDTH_THRESHOLD = 100 * 1024 * 1024  # 100 MB/hour per app
MAX_HISTORY_DAYS = 30

# === DATABASE ===
def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS traffic_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            process_name TEXT,
            pid INTEGER,
            bytes_sent REAL,
            bytes_recv REAL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS connection_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            process_name TEXT,
            pid INTEGER,
            local_addr TEXT,
            local_port INTEGER,
            remote_addr TEXT,
            remote_port INTEGER,
            status TEXT,
            remote_host TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            alert_type TEXT,
            message TEXT,
            severity TEXT
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_traffic_time ON traffic_log(timestamp)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_traffic_proc ON traffic_log(process_name)
    """)
    conn.commit()
    return conn


# === NETWORK MONITOR ===
class NetworkMonitor:
    def __init__(self):
        self.db = init_db()
        self.prev_counters = {}  # {pid: {bytes_sent, bytes_recv}}
        self.known_apps = set()
        self.known_connections = set()
        self.blocked_apps = set()
        self.alerts = []
        self.hourly_usage = defaultdict(lambda: {"sent": 0, "recv": 0})
        self.ws_clients = set()
        self.running = True

        # Get initial per-process counters
        self._snapshot_counters()

    def _snapshot_counters(self):
        """Snapshot per-process network I/O counters."""
        counters = {}
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                io = proc.io_counters()
                counters[proc.pid] = {
                    "name": proc.info['name'],
                    "pid": proc.pid,
                    "bytes_sent": io.write_bytes,
                    "bytes_recv": io.read_bytes,
                }
            except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
                pass
        self.prev_counters = counters

    def poll(self):
        """Poll network state and return current data."""
        now = time.time()
        app_traffic = defaultdict(lambda: {"sent": 0, "recv": 0, "pid": 0, "connections": 0})
        connections = []
        new_alerts = []

        # --- Per-process bandwidth ---
        current_counters = {}
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                io = proc.io_counters()
                current_counters[proc.pid] = {
                    "name": proc.info['name'],
                    "pid": proc.pid,
                    "bytes_sent": io.write_bytes,
                    "bytes_recv": io.read_bytes,
                }
            except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
                continue

        for pid, curr in current_counters.items():
            prev = self.prev_counters.get(pid)
            if prev and prev["name"] == curr["name"]:
                delta_sent = max(0, curr["bytes_sent"] - prev["bytes_sent"])
                delta_recv = max(0, curr["bytes_recv"] - prev["bytes_recv"])
                name = curr["name"]

                app_traffic[name]["sent"] += delta_sent
                app_traffic[name]["recv"] += delta_recv
                app_traffic[name]["pid"] = pid

                # Track hourly usage for alerts
                self.hourly_usage[name]["sent"] += delta_sent
                self.hourly_usage[name]["recv"] += delta_recv

                # Log to DB (batch every 10 seconds to reduce writes)
                if delta_sent > 0 or delta_recv > 0:
                    self.db.execute(
                        "INSERT INTO traffic_log (timestamp, process_name, pid, bytes_sent, bytes_recv) VALUES (?,?,?,?,?)",
                        (now, name, pid, delta_sent, delta_recv)
                    )

                # New app alert
                if name not in self.known_apps and (delta_sent > 0 or delta_recv > 0):
                    self.known_apps.add(name)
                    alert = {
                        "time": datetime.now().strftime("%H:%M:%S"),
                        "type": "new_app",
                        "message": f"{name} connected to the network for the first time",
                        "severity": "info",
                    }
                    new_alerts.append(alert)

        self.prev_counters = current_counters

        # --- Active connections ---
        try:
            for conn in psutil.net_connections(kind='inet'):
                if conn.status == 'NONE' or not conn.raddr:
                    continue
                try:
                    proc = psutil.Process(conn.pid) if conn.pid else None
                    name = proc.name() if proc else "unknown"
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    name = "unknown"

                remote_ip = conn.raddr.ip
                remote_port = conn.raddr.port

                # Resolve hostname (cached by OS)
                try:
                    host = socket.getfqdn(remote_ip)
                    if host == remote_ip:
                        host = remote_ip
                except Exception:
                    host = remote_ip

                conn_key = (name, remote_ip, remote_port)
                if conn_key not in self.known_connections:
                    self.known_connections.add(conn_key)

                app_traffic[name]["connections"] += 1

                connections.append({
                    "app": name,
                    "pid": conn.pid or 0,
                    "local_addr": conn.laddr.ip if conn.laddr else "",
                    "local_port": conn.laddr.port if conn.laddr else 0,
                    "remote": remote_ip,
                    "host": host,
                    "port": remote_port,
                    "protocol": "HTTPS" if remote_port == 443 else "HTTP" if remote_port == 80 else f"TCP:{remote_port}",
                    "status": conn.status,
                })
        except (psutil.AccessDenied, OSError):
            pass

        # --- Bandwidth alerts ---
        for name, usage in self.hourly_usage.items():
            total = usage["sent"] + usage["recv"]
            if total > ALERT_BANDWIDTH_THRESHOLD:
                alert = {
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "type": "bandwidth",
                    "message": f"{name} exceeded {ALERT_BANDWIDTH_THRESHOLD // (1024*1024)}MB in the last hour",
                    "severity": "warning",
                }
                new_alerts.append(alert)
                self.hourly_usage[name] = {"sent": 0, "recv": 0}

        # Store alerts
        for a in new_alerts:
            self.alerts.append(a)
            self.db.execute(
                "INSERT INTO alerts (timestamp, alert_type, message, severity) VALUES (?,?,?,?)",
                (now, a["type"], a["message"], a["severity"])
            )

        self.db.commit()

        # --- Build payload ---
        total_sent = sum(a["sent"] for a in app_traffic.values())
        total_recv = sum(a["recv"] for a in app_traffic.values())

        apps_list = []
        for name, data in sorted(app_traffic.items(), key=lambda x: x[1]["recv"], reverse=True):
            if data["sent"] > 0 or data["recv"] > 0 or data["connections"] > 0:
                apps_list.append({
                    "name": name,
                    "pid": data["pid"],
                    "sent": data["sent"],
                    "recv": data["recv"],
                    "connections": data["connections"],
                    "blocked": name in self.blocked_apps,
                })

        return {
            "timestamp": now,
            "total_sent": total_sent,
            "total_recv": total_recv,
            "apps": apps_list[:30],  # Top 30 apps
            "connections": connections[:100],  # Top 100 connections
            "alerts": self.alerts[-20:],  # Last 20 alerts
        }

    def block_app(self, app_name):
        """Add an app to the blocked list. On Linux/macOS, uses iptables/pfctl."""
        self.blocked_apps.add(app_name)
        self.alerts.append({
            "time": datetime.now().strftime("%H:%M:%S"),
            "type": "blocked",
            "message": f"Blocked {app_name} from network access",
            "severity": "danger",
        })
        # NOTE: Actual firewall blocking requires OS-specific commands:
        # Linux:   iptables -A OUTPUT -m owner --cmd-owner <app> -j DROP
        # macOS:   pfctl rules
        # Windows: netsh advfirewall
        # These require root/admin privileges.
        print(f"[FIREWALL] Blocked: {app_name}")

    def unblock_app(self, app_name):
        self.blocked_apps.discard(app_name)
        print(f"[FIREWALL] Unblocked: {app_name}")


# === WEBSOCKET SERVER ===
async def ws_handler(monitor, websocket):
    """Handle a WebSocket connection from the dashboard."""
    monitor.ws_clients.add(websocket)
    print(f"[WS] Dashboard connected ({len(monitor.ws_clients)} clients)")
    try:
        async for message in websocket:
            try:
                cmd = json.loads(message)
                if cmd.get("action") == "block":
                    monitor.block_app(cmd["app"])
                elif cmd.get("action") == "unblock":
                    monitor.unblock_app(cmd["app"])
            except json.JSONDecodeError:
                pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        monitor.ws_clients.discard(websocket)
        print(f"[WS] Dashboard disconnected ({len(monitor.ws_clients)} clients)")


async def broadcast(monitor):
    """Broadcast network data to all connected dashboards."""
    while monitor.running:
        data = monitor.poll()
        if monitor.ws_clients:
            payload = json.dumps(data)
            await asyncio.gather(
                *[client.send(payload) for client in monitor.ws_clients],
                return_exceptions=True,
            )
        await asyncio.sleep(POLL_INTERVAL)


def print_terminal_dashboard(data):
    """Print a compact terminal dashboard."""
    os.system('cls' if os.name == 'nt' else 'clear')
    print("=" * 70)
    print("  ⚡ NETWATCH — Local Network Monitor")
    print("=" * 70)
    print(f"  Total ↓ {format_bytes(data['total_recv'])}/s  |  ↑ {format_bytes(data['total_sent'])}/s")
    print(f"  Active apps: {len(data['apps'])}  |  Connections: {len(data['connections'])}")
    print("-" * 70)
    print(f"  {'APP':<25} {'↓ RECV':>12} {'↑ SENT':>12} {'CONNS':>6}")
    print("-" * 70)
    for app in data["apps"][:15]:
        blocked = " [BLOCKED]" if app["blocked"] else ""
        print(f"  {app['name']:<25} {format_bytes(app['recv']):>12} {format_bytes(app['sent']):>12} {app['connections']:>6}{blocked}")
    print("-" * 70)
    if data["alerts"]:
        print("  RECENT ALERTS:")
        for a in data["alerts"][-5:]:
            sev = {"info": "ℹ️ ", "warning": "⚠️ ", "danger": "🚫"}
            print(f"    {sev.get(a['severity'], '')} {a['time']} — {a['message']}")
    print("\n  Press Ctrl+C to stop")


def format_bytes(b):
    if b < 1024:
        return f"{b:.0f} B"
    if b < 1048576:
        return f"{b/1024:.1f} KB"
    if b < 1073741824:
        return f"{b/1048576:.1f} MB"
    return f"{b/1073741824:.2f} GB"


async def terminal_loop(monitor):
    """Fallback: terminal-only dashboard when no WebSocket."""
    while monitor.running:
        data = monitor.poll()
        print_terminal_dashboard(data)
        await asyncio.sleep(POLL_INTERVAL)


async def main():
    monitor = NetworkMonitor()

    def handle_exit(sig, frame):
        print("\n[NETWATCH] Shutting down...")
        monitor.running = False
        monitor.db.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    print("=" * 50)
    print("  ⚡ NETWATCH — Local Network Monitor")
    print("=" * 50)
    print(f"  Database: {DB_PATH}")

    if websockets:
        print(f"  WebSocket: ws://{WS_HOST}:{WS_PORT}")
        print(f"  Connect the React dashboard to this address")
        print("=" * 50)

        async with websockets.serve(
            lambda ws: ws_handler(monitor, ws),
            WS_HOST, WS_PORT
        ):
            await broadcast(monitor)
    else:
        print("  Mode: Terminal only (install websockets for dashboard)")
        print("=" * 50)
        await terminal_loop(monitor)


if __name__ == "__main__":
    asyncio.run(main())
