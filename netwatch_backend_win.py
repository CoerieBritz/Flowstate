#!/usr/bin/env python3
"""
FLOWSTATE - Local Network Monitor Backend (Windows)
===================================================
Windows-native version. Run from PowerShell as Administrator:

    python netwatch_backend_win.py

Requirements:
    pip install psutil websockets

How bandwidth is attributed per-process on Windows
---------------------------------------------------
Windows does not expose per-process network I/O through psutil
(psutil.Process.io_counters() returns disk I/O on Windows, not network).
Instead this backend:
  1. Reads total system network I/O via psutil.net_io_counters()
  2. Enumerates all active TCP/UDP connections via psutil.net_connections()
  3. Distributes total bandwidth proportionally across processes by their
     active connection count.

This is an approximation. For exact per-process stats without WMI,
use ETW (Event Tracing for Windows) or the IP Helper API — both require
additional native extensions beyond psutil.

Network Map payload
-------------------
Every 30 seconds the backend also:
  - Detects the default gateway  (route print 0.0.0.0 → ipconfig fallback)
  - Determines this machine's IP  (UDP socket trick)
  - Scans the ARP table           (arp -a)
These are sent in every WebSocket frame as:
  gateway     : str   – e.g. "192.168.1.1"
  local_ip    : str   – e.g. "192.168.1.100"
  lan_devices : list  – [{ip, mac, hostname, type}, …]
"""

import argparse
import asyncio
import json
import re
import subprocess
import time
import socket
import sqlite3
import os
import sys
import signal
import ctypes
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# ── CLI arguments ─────────────────────────────────────────────────────────────
# Parsed early so path constants below can reference --data-dir immediately.
# parse_known_args is used so Tauri/PyInstaller can inject extra flags safely.
_arg_parser = argparse.ArgumentParser(
    description="FlowState backend",
    add_help=True,
)
_arg_parser.add_argument(
    "--data-dir",
    default=None,
    metavar="PATH",
    help=(
        "Directory for runtime data (history.db, settings.json, snapshots/). "
        "Defaults to ./data/ next to the script/executable when omitted. "
        "Set automatically by the Tauri wrapper to %%APPDATA%%\\com.coerie.netwatch."
    ),
)
_cli_args, _unknown_args = _arg_parser.parse_known_args()

# ── SOAR / Threat Intel (optional — degrades gracefully if soar/ is absent) ──
_SOAR_DIR = Path(__file__).parent / "soar"
if str(_SOAR_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SOAR_DIR.parent))

try:
    from soar.threat_intel import ThreatIntelEngine
    _THREAT_INTEL_AVAILABLE = True
except ImportError as _ti_err:
    ThreatIntelEngine = None           # type: ignore[assignment,misc]
    _THREAT_INTEL_AVAILABLE = False
    print(f"[TI] Threat intel unavailable: {_ti_err}")

try:
    from soar.correlator import IncidentCorrelator
    _CORRELATOR_AVAILABLE = True
except ImportError as _corr_err:
    IncidentCorrelator = None          # type: ignore[assignment,misc]
    _CORRELATOR_AVAILABLE = False
    print(f"[SOAR] Correlator unavailable: {_corr_err}")

try:
    from soar.responder import ResponseEngine, RESPONSE_ACTIONS
    _RESPONDER_AVAILABLE = True
except ImportError as _resp_err:
    ResponseEngine = None              # type: ignore[assignment,misc]
    RESPONSE_ACTIONS = frozenset()     # type: ignore[assignment]
    _RESPONDER_AVAILABLE = False
    print(f"[SOAR] Responder unavailable: {_resp_err}")

try:
    from soar.threat_intel_api import ThreatIntelAPI
    _TI_API_AVAILABLE = True
except ImportError as _tiapi_err:
    ThreatIntelAPI = None              # type: ignore[assignment,misc]
    _TI_API_AVAILABLE = False
    print(f"[TIAPI] Threat Intel API unavailable: {_tiapi_err}")

try:
    from soar.playbooks import PlaybookEngine
    _PLAYBOOKS_AVAILABLE = True
except ImportError as _pb_err:
    PlaybookEngine = None              # type: ignore[assignment,misc]
    _PLAYBOOKS_AVAILABLE = False
    print(f"[PB] Playbook engine unavailable: {_pb_err}")

# Must be set before any asyncio usage on Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

try:
    import psutil
except ImportError:
    print("ERROR: psutil is required.")
    print("  pip install psutil")
    sys.exit(1)

try:
    import websockets
except ImportError:
    websockets = None
    print("WARNING: websockets not installed — running terminal-only mode.")
    print("  pip install websockets")


# === CONFIGURATION ===
WS_HOST = "localhost"
WS_PORT = 8765
POLL_INTERVAL = 1.0           # seconds between network polls (overridden by settings)
ARP_SCAN_INTERVAL = 30.0      # seconds between ARP / gateway re-scans
ALERT_BANDWIDTH_THRESHOLD = 100 * 1024 * 1024   # 100 MB/hour per app
MAX_HISTORY_DAYS = 30

# === PATHS ===================================================================
# _DATA_DIR is set from --data-dir if supplied (Tauri sets %APPDATA%\com.coerie.netwatch),
# otherwise falls back to ./data/ next to the running executable/script.

def _resolve_data_dir() -> Path:
    if _cli_args.data_dir:
        return Path(_cli_args.data_dir)
    # When frozen by PyInstaller (--onefile), __file__ points to the temp
    # extraction dir which is cleaned up after exit.  Use the exe's real
    # location so data survives across runs.
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "data"
    return Path(__file__).parent / "data"

_DATA_DIR = _resolve_data_dir()
_SETTINGS_PATH = _DATA_DIR / "settings.json"
DB_PATH = _DATA_DIR / "history.db"

# === SETTINGS ================================================================

DEFAULT_SETTINGS: dict = {
    "threat_intel": {
        "virustotal_api_key":  "",
        "abuseipdb_api_key":   "",
        "auto_lookup_flagged": True,
        "cache_ttl_hours":     24,
    },
    "alerts": {
        "bandwidth_threshold_mb": 100,
        "poll_interval_seconds":  1,
    },
    "display": {
        "max_connections_shown": 100,
        "max_apps_shown":        30,
    },
    "retention": {
        "connection_history_days": 30,
        "event_log_days":          90,
        "traffic_log_days":        30,
        "alerts_days":             90,
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    """Return base with override values applied, preserving all base keys."""
    import copy
    result = copy.deepcopy(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def _load_settings() -> dict:
    """Load settings.json, creating it with defaults if absent."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if _SETTINGS_PATH.exists():
        try:
            with open(_SETTINGS_PATH, encoding="utf-8") as f:
                on_disk = json.load(f)
            return _deep_merge(DEFAULT_SETTINGS, on_disk)
        except Exception as e:
            print(f"[SETTINGS] Failed to load settings.json: {e} — using defaults")
    import copy
    defaults = copy.deepcopy(DEFAULT_SETTINGS)
    _write_settings(defaults)
    return defaults


def _write_settings(settings: dict) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
    print(f"[SETTINGS] Saved to {_SETTINGS_PATH}")


def _mask_key(key: str) -> str:
    """Mask an API key: keep first 2 + last 4 chars, middle replaced with ****."""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:2]}{'*' * 4}{key[-4:]}"


def _mask_settings(settings: dict) -> dict:
    """Return a copy of settings with API keys replaced by masked values."""
    import copy
    masked = copy.deepcopy(settings)
    ti = masked.get("threat_intel", {})
    ti["virustotal_api_key"] = _mask_key(ti.get("virustotal_api_key", ""))
    ti["abuseipdb_api_key"]  = _mask_key(ti.get("abuseipdb_api_key",  ""))
    return masked

# subprocess flag: suppress console windows on Windows
_POPEN_FLAGS: dict = (
    {"creationflags": 0x08000000}   # CREATE_NO_WINDOW
    if sys.platform == "win32" else {}
)


# === DNS CACHE ===
# socket.gethostbyaddr() can be very slow on Windows. Cache results
# permanently for the lifetime of the process to keep poll() fast.
_dns_cache: dict[str, str] = {}


def resolve_host(ip: str) -> str:
    if ip in _dns_cache:
        return _dns_cache[ip]
    try:
        host = socket.gethostbyaddr(ip)[0]
    except Exception:
        host = ip
    _dns_cache[ip] = host
    return host


# === ADMIN CHECK ===
def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


# === NETWORK INFO ============================================================

def get_local_ip() -> str:
    """
    Return this machine's primary IPv4 address by connecting a UDP socket to
    an external address (no data is actually sent).
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return ""


def get_gateway() -> str:
    """
    Return the default IPv4 gateway.

    Strategy:
      1. Parse `route print 0.0.0.0` — language-independent, reliable.
      2. Fall back to `ipconfig` for English-locale machines if (1) fails.
    """
    # ── Strategy 1: route print ──────────────────────────────────────
    try:
        result = subprocess.run(
            ["route", "print", "0.0.0.0"],
            capture_output=True, text=True, timeout=5,
            **_POPEN_FLAGS,
        )
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[0] == "0.0.0.0" and parts[1] == "0.0.0.0":
                candidate = parts[2]
                if re.match(r"^\d+\.\d+\.\d+\.\d+$", candidate) and candidate != "On-link":
                    return candidate
    except Exception:
        pass

    # ── Strategy 2: ipconfig fallback ────────────────────────────────
    try:
        result = subprocess.run(
            ["ipconfig"],
            capture_output=True, text=True, timeout=5,
            **_POPEN_FLAGS,
        )
        m = re.search(
            r"Default Gateway[.\s]+:\s+(\d+\.\d+\.\d+\.\d+)",
            result.stdout,
        )
        if m:
            return m.group(1)
    except Exception:
        pass

    return ""


def _classify_device(ip: str, hostname: str, gateway: str, local_ip: str) -> str:
    """Guess a device type from IP position and hostname hints."""
    if ip == gateway:
        return "gateway"
    if ip == local_ip:
        return "this_pc"
    h = hostname.lower()
    if any(k in h for k in ("phone", "android", "iphone", "mobile", "ipad", "galaxy", "pixel")):
        return "phone"
    if any(k in h for k in ("router", "gateway", "gw", "ap", "access-point", "switch")):
        return "router"
    if any(k in h for k in ("printer", "print", "hpdevice", "epson", "canon", "brother")):
        return "printer"
    if any(k in h for k in ("tv", "roku", "firetv", "chromecast", "appletv", "shield")):
        return "tv"
    return "pc"


def scan_arp(gateway: str, local_ip: str) -> list[dict]:
    """
    Parse `arp -a` and return a list of LAN device dicts:
        [{ip, mac, hostname, type}, …]

    Filters out broadcast, multicast, and all-FF addresses.
    """
    try:
        result = subprocess.run(
            ["arp", "-a"],
            capture_output=True, text=True, timeout=10,
            **_POPEN_FLAGS,
        )
    except Exception as exc:
        print(f"[ARP] scan failed: {exc}")
        return []

    devices: list[dict] = []
    seen: set[str] = set()

    for line in result.stdout.splitlines():
        line = line.strip()
        # Match:  192.168.1.1    aa-bb-cc-dd-ee-ff    dynamic
        m = re.match(
            r"^(\d+\.\d+\.\d+\.\d+)"          # IP
            r"\s+((?:[\da-fA-F]{2}[:-]){5}[\da-fA-F]{2})"  # MAC
            r"\s+(\w+)$",                       # type (dynamic/static)
            line,
        )
        if not m:
            continue

        ip, mac, arp_type = m.group(1), m.group(2).lower(), m.group(3)

        # Skip broadcasts, multicasts, and all-FF
        octets = list(map(int, ip.split(".")))
        if octets[3] == 255 or octets[0] >= 224:
            continue
        if mac == "ff-ff-ff-ff-ff-ff":
            continue
        if ip in seen:
            continue
        seen.add(ip)

        hostname = resolve_host(ip)
        dev_type = _classify_device(ip, hostname, gateway, local_ip)

        devices.append({
            "ip": ip,
            "mac": mac,
            "hostname": hostname,
            "type": dev_type,
        })

    return devices


# === DATABASE ================================================================

def init_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS traffic_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp    REAL,
            process_name TEXT,
            pid          INTEGER,
            bytes_sent   REAL,
            bytes_recv   REAL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS connection_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp    REAL,
            process_name TEXT,
            pid          INTEGER,
            local_addr   TEXT,
            local_port   INTEGER,
            remote_addr  TEXT,
            remote_port  INTEGER,
            status       TEXT,
            remote_host  TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp  REAL,
            alert_type TEXT,
            message    TEXT,
            severity   TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_traffic_time ON traffic_log(timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_traffic_proc ON traffic_log(process_name)")
    conn.commit()
    return conn


# === NETWORK MONITOR =========================================================

class NetworkMonitor:
    def __init__(self):
        self.db = init_db()
        self.known_apps: set[str] = set()
        self.blocked_apps: set[str] = set()
        self.alerts: list[dict] = []
        self.hourly_usage: dict = defaultdict(lambda: {"sent": 0.0, "recv": 0.0})
        self.ws_clients: set = set()
        self.running = True

        # ── Settings (loaded first — other init may depend on them) ───
        self._settings: dict = _load_settings()
        self._apply_settings()

        # System-level I/O snapshot for bandwidth delta
        self._prev_io = psutil.net_io_counters()
        self._prev_time = time.time()

        # ── Network topology (refreshed every ARP_SCAN_INTERVAL seconds) ──
        self._last_arp_scan: float = 0.0   # epoch of last scan
        self._local_ip: str = get_local_ip()
        self._gateway: str = get_gateway()
        self._lan_devices: list[dict] = []

        # Kick off the first ARP scan immediately
        self._refresh_topology()

        # ── Threat Intel Engine ───────────────────────────────────────────
        # Loads blocklists from soar/feeds/ on startup.
        # ALERT-ONLY: never modifies firewall rules or blocks traffic.
        self._threat_intel: "ThreatIntelEngine | None" = None
        if _THREAT_INTEL_AVAILABLE:
            feeds_dir = Path(__file__).parent / "soar" / "feeds"
            self._threat_intel = ThreatIntelEngine(feeds_dir)

        # Per-IP lookup cache: avoids re-checking the same remote IP every second.
        # Maps ip_str → ThreatMatch.to_dict() or None.
        self._threat_cache: dict[str, dict | None] = {}
        # IPs for which we have already raised a threat alert this session
        # (prevents duplicate alerts flooding the feed).
        self._alerted_threat_ips: set[str] = set()

        # Per-IP geo cache: maps ip_str → (lat, lon, country_code)
        self._geo_cache: dict[str, tuple] = {}

        # ── Incident Correlator ───────────────────────────────────────
        # Groups raw events into higher-level incidents using 5 rules.
        # ALERT-ONLY: never blocks traffic or executes system commands.
        self._correlator: "IncidentCorrelator | None" = None
        if _CORRELATOR_AVAILABLE:
            self._correlator = IncidentCorrelator()

        # ── Response Engine ───────────────────────────────────────────
        # Executes confirmed one-click actions (block IP, kill process…).
        # Nothing runs without confirm=True from the dashboard.
        self._responder: "ResponseEngine | None" = None
        if _RESPONDER_AVAILABLE:
            self._responder = ResponseEngine()

        # ── Phase 4: External Threat Intel API ───────────────────────
        # VirusTotal + AbuseIPDB lookups with SQLite caching.
        # Keys loaded from settings; lookups run on demand or auto.
        self._ti_api: "ThreatIntelAPI | None" = None
        if _TI_API_AVAILABLE:
            ti_cfg = self._settings.get("threat_intel", {})
            self._ti_api = ThreatIntelAPI(
                vt_key         = ti_cfg.get("virustotal_api_key", ""),
                ab_key         = ti_cfg.get("abuseipdb_api_key",  ""),
                cache_ttl_hours= float(ti_cfg.get("cache_ttl_hours", 24)),
            )
            print("[TIAPI] Threat Intel API engine ready")

        # IPs auto-looked-up this session (avoids redundant auto-lookups)
        self._auto_looked_up: set[str] = set()

        # ── Phase 4: Playbook Engine ──────────────────────────────────
        # Evaluates YAML playbooks against each poll snapshot.
        # ALERT-ONLY: never executes actions automatically.
        self._playbook_engine: "PlaybookEngine | None" = None
        if _PLAYBOOKS_AVAILABLE:
            self._playbook_engine = PlaybookEngine()
            print(f"[PB] Playbook engine ready — {len(self._playbook_engine.playbooks)} playbook(s)")

    # ── Internal helpers ──────────────────────────────────────────────

    def _refresh_topology(self) -> None:
        """Re-detect gateway, local IP, and ARP table. Call every 30 s."""
        self._local_ip = get_local_ip()
        self._gateway = get_gateway()
        self._lan_devices = scan_arp(self._gateway, self._local_ip)
        self._last_arp_scan = time.time()
        n = len(self._lan_devices)
        gw = self._gateway or "(unknown)"
        print(f"[NET] Gateway={gw}  LocalIP={self._local_ip}  LAN devices={n}")

    def _proc_name(self, pid) -> str:
        """Return process name for pid, or 'unknown' on access errors."""
        if not pid:
            return "unknown"
        try:
            return psutil.Process(pid).name()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return "unknown"

    # ── Geolocation helpers ───────────────────────────────────────────

    _PRIVATE_PREFIXES = ("10.", "192.168.", "127.", "169.254.", "::1", "fc", "fd")

    def _is_private_ip(self, ip: str) -> bool:
        if any(ip.startswith(p) for p in self._PRIVATE_PREFIXES):
            return True
        # 172.16–31.x.x
        if ip.startswith("172."):
            try:
                second = int(ip.split(".")[1])
                if 16 <= second <= 31:
                    return True
            except (IndexError, ValueError):
                pass
        return False

    def _geo_from_hostname(self, hostname: str, ip: str) -> tuple:
        """Return (lat, lon, country_code) derived from reverse-DNS hostname or IP.
        Returns (None, None, '??') when no mapping is found."""
        if self._is_private_ip(ip):
            return (None, None, "LAN")

        h = (hostname or "").lower()

        # AWS regions
        for region, coords in {
            "eu-west-1": (53.3, -6.3, "IE"), "eu-west-2": (51.5, -0.1, "GB"),
            "eu-west-3": (48.9, 2.3, "FR"),  "eu-central-1": (50.1, 8.7, "DE"),
            "eu-north-1": (59.3, 18.1, "SE"), "eu-south-1": (45.5, 9.2, "IT"),
            "us-east-1": (39.0, -77.5, "US"), "us-east-2": (40.0, -82.9, "US"),
            "us-west-1": (37.8, -122.4, "US"), "us-west-2": (45.5, -122.7, "US"),
            "ap-southeast-1": (1.3, 103.8, "SG"), "ap-southeast-2": (-33.9, 151.2, "AU"),
            "ap-northeast-1": (35.7, 139.7, "JP"), "ap-northeast-2": (37.6, 127.0, "KR"),
            "ap-northeast-3": (34.7, 135.5, "JP"), "ap-south-1": (19.1, 72.9, "IN"),
            "ap-east-1": (22.3, 114.2, "HK"), "ca-central-1": (45.5, -73.6, "CA"),
            "sa-east-1": (-23.5, -46.6, "BR"), "me-south-1": (26.1, 50.5, "BH"),
            "af-south-1": (-33.9, 18.4, "ZA"),
        }.items():
            if region in h:
                return coords

        # GCP regions
        for region, coords in {
            "europe-west1": (50.4, 3.7, "BE"), "europe-west2": (51.5, -0.1, "GB"),
            "europe-west3": (50.1, 8.7, "DE"), "europe-west4": (53.0, 4.9, "NL"),
            "europe-west6": (47.4, 8.6, "CH"), "europe-north1": (60.6, 27.2, "FI"),
            "us-central1": (41.3, -88.8, "US"), "us-east1": (33.2, -80.0, "US"),
            "us-east4": (39.0, -77.5, "US"), "us-west1": (45.6, -121.2, "US"),
            "us-west2": (34.1, -118.2, "US"), "us-west3": (40.8, -111.9, "US"),
            "asia-east1": (24.1, 120.7, "TW"), "asia-east2": (22.3, 114.2, "HK"),
            "asia-northeast1": (35.7, 139.7, "JP"), "asia-northeast2": (34.7, 135.5, "JP"),
            "asia-northeast3": (37.6, 127.0, "KR"), "asia-southeast1": (1.3, 103.8, "SG"),
            "asia-southeast2": (-6.2, 106.8, "ID"), "asia-south1": (19.1, 72.9, "IN"),
            "australia-southeast1": (-33.9, 151.2, "AU"), "southamerica-east1": (-23.5, -46.6, "BR"),
        }.items():
            if region in h:
                return coords

        # Azure regions
        for region, coords in {
            "eastus": (37.3, -79.5, "US"), "westus": (37.8, -122.4, "US"),
            "centralus": (41.6, -93.6, "US"), "northcentralus": (41.9, -87.6, "US"),
            "southcentralus": (29.4, -98.5, "US"), "westcentralus": (40.9, -110.4, "US"),
            "westeurope": (52.4, 4.9, "NL"), "northeurope": (53.3, -6.3, "IE"),
            "uksouth": (51.5, -0.1, "GB"), "ukwest": (53.5, -3.0, "GB"),
            "germanywestcentral": (50.1, 8.7, "DE"), "swedencentral": (60.6, 17.1, "SE"),
            "francecentral": (46.3, 2.2, "FR"), "australiaeast": (-33.9, 151.2, "AU"),
            "australiasoutheast": (-37.8, 145.0, "AU"), "japaneast": (35.7, 139.7, "JP"),
            "japanwest": (34.7, 135.5, "JP"), "koreacentral": (37.6, 126.9, "KR"),
            "southeastasia": (1.3, 103.8, "SG"), "eastasia": (22.3, 114.2, "HK"),
            "centralindia": (18.6, 73.9, "IN"), "brazilsouth": (-23.5, -46.6, "BR"),
            "canadacentral": (43.7, -79.4, "CA"), "southafricanorth": (-26.2, 28.0, "ZA"),
            "uaenorth": (25.2, 55.3, "AE"),
        }.items():
            if region in h:
                return coords

        # CDN / well-known providers
        for name, coords in {
            "cloudflare": (37.8, -122.4, "US"), "akamai": (42.4, -71.1, "US"),
            "fastly": (37.8, -122.4, "US"),     "cloudfront": (39.0, -77.0, "US"),
            "jsdelivr": (48.9, 2.3, "FR"),       "bunnycdn": (46.1, 14.5, "SI"),
        }.items():
            if name in h:
                return coords

        # Country TLDs (ordered longest-first to avoid partial matches)
        tld_map = [
            (".co.uk", (51.5, -0.1, "GB")), (".ac.uk", (51.5, -0.1, "GB")),
            (".com.au", (-25.3, 133.8, "AU")), (".co.za", (-29.0, 25.1, "ZA")),
            (".co.jp", (36.2, 138.3, "JP")), (".co.kr", (35.9, 127.8, "KR")),
            (".uk", (51.5, -0.1, "GB")), (".de", (51.2, 10.5, "DE")),
            (".fr", (46.2, 2.2, "FR")), (".nl", (52.4, 4.9, "NL")),
            (".it", (41.9, 12.5, "IT")), (".es", (40.4, -3.7, "ES")),
            (".se", (60.1, 18.6, "SE")), (".no", (59.9, 10.7, "NO")),
            (".dk", (56.3, 9.5, "DK")), (".fi", (61.9, 25.7, "FI")),
            (".pl", (51.9, 19.1, "PL")), (".ch", (46.8, 8.2, "CH")),
            (".at", (47.5, 14.6, "AT")), (".be", (50.5, 4.5, "BE")),
            (".ie", (53.1, -8.2, "IE")), (".pt", (39.4, -8.2, "PT")),
            (".ru", (61.5, 105.3, "RU")), (".ua", (49.0, 31.5, "UA")),
            (".tr", (38.9, 35.2, "TR")), (".cn", (35.9, 104.2, "CN")),
            (".jp", (36.2, 138.3, "JP")), (".kr", (35.9, 127.8, "KR")),
            (".in", (20.6, 78.9, "IN")), (".sg", (1.3, 103.8, "SG")),
            (".hk", (22.3, 114.2, "HK")), (".tw", (23.7, 121.0, "TW")),
            (".au", (-25.3, 133.8, "AU")), (".nz", (-40.9, 174.9, "NZ")),
            (".za", (-29.0, 25.1, "ZA")), (".eg", (26.8, 30.8, "EG")),
            (".ng", (9.1, 8.7, "NG")),   (".br", (-14.2, -51.9, "BR")),
            (".ar", (-38.4, -63.6, "AR")), (".mx", (23.6, -102.6, "MX")),
            (".ca", (56.1, -106.3, "CA")), (".il", (31.0, 34.9, "IL")),
            (".ae", (23.4, 53.8, "AE")), (".sa", (23.9, 45.1, "SA")),
            (".id", (-0.8, 113.9, "ID")),
        ]
        for tld, coords in tld_map:
            if h.endswith(tld) or (f"{tld}." in h and not h.startswith(".")):
                return coords

        # Fall back: generic .com/.net/.org/.io → US geographic center
        for us_sfx in (".com", ".net", ".org", ".io", ".co", ".app", ".dev", ".ai", ".tv"):
            if h.endswith(us_sfx):
                return (37.1, -95.7, "US")

        return (None, None, "??")

    # ── Main poll ─────────────────────────────────────────────────────

    def poll(self) -> dict:
        now = time.time()
        new_alerts: list[dict] = []
        new_apps_this_poll: set[str] = set()   # for correlator Rule 5

        # Refresh ARP table every ARP_SCAN_INTERVAL seconds
        if now - self._last_arp_scan >= ARP_SCAN_INTERVAL:
            self._refresh_topology()

        # ── System-level bandwidth delta ──────────────────────────────
        curr_io = psutil.net_io_counters()
        total_sent = max(0, curr_io.bytes_sent - self._prev_io.bytes_sent)
        total_recv = max(0, curr_io.bytes_recv - self._prev_io.bytes_recv)
        self._prev_io = curr_io
        self._prev_time = now

        # ── Active connections ────────────────────────────────────────
        proc_conns: dict[str, list] = defaultdict(list)
        proc_pid: dict[str, int] = {}
        all_connections: list[dict] = []

        try:
            raw = psutil.net_connections(kind="inet")
        except (psutil.AccessDenied, PermissionError):
            print(
                "[ERROR] Access denied reading connections. "
                "Run this script as Administrator."
            )
            raw = []

        for conn in raw:
            if not conn.raddr:
                continue
            name = self._proc_name(conn.pid)
            proc_conns[name].append(conn)
            if conn.pid:
                proc_pid[name] = conn.pid

            rip = conn.raddr.ip
            rport = conn.raddr.port
            host = resolve_host(rip)
            proto = (
                "HTTPS" if rport == 443
                else "HTTP" if rport == 80
                else f"TCP:{rport}"
            )
            all_connections.append({
                "app": name,
                "pid": conn.pid or 0,
                "local_addr": conn.laddr.ip if conn.laddr else "",
                "local_port": conn.laddr.port if conn.laddr else 0,
                "remote": rip,
                "host": host,
                "port": rport,
                "protocol": proto,
                "status": conn.status,
            })

        # ── Annotate connections with geolocation hints ───────────────
        for conn in all_connections:
            ip = conn.get("remote", "")
            if ip and ip not in ("N/A", ""):
                if ip not in self._geo_cache:
                    self._geo_cache[ip] = self._geo_from_hostname(
                        conn.get("host", ""), ip
                    )
                lat, lon, cc = self._geo_cache[ip]
                if lat is not None:
                    conn["lat"] = lat
                    conn["lon"] = lon
                conn["country_code"] = cc

        # ── Distribute bandwidth by connection-count fraction ─────────
        total_conn_count = sum(len(v) for v in proc_conns.values()) or 1
        apps_list: list[dict] = []

        for name, conns in proc_conns.items():
            fraction = len(conns) / total_conn_count
            proc_sent = total_sent * fraction
            proc_recv = total_recv * fraction

            self.hourly_usage[name]["sent"] += proc_sent
            self.hourly_usage[name]["recv"] += proc_recv

            if proc_sent > 0 or proc_recv > 0:
                self.db.execute(
                    "INSERT INTO traffic_log "
                    "(timestamp, process_name, pid, bytes_sent, bytes_recv) "
                    "VALUES (?,?,?,?,?)",
                    (now, name, proc_pid.get(name, 0), proc_sent, proc_recv),
                )

            if name not in self.known_apps and name != "unknown":
                self.known_apps.add(name)
                new_apps_this_poll.add(name)
                new_alerts.append({
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "type": "new_app",
                    "message": f"{name} is active on the network ({len(conns)} conns)",
                    "severity": "info",
                })

            apps_list.append({
                "name": name,
                "pid": proc_pid.get(name, 0),
                "sent": proc_sent,
                "recv": proc_recv,
                "connections": len(conns),
                "blocked": name in self.blocked_apps,
            })

        # ── Threat intel checks ──────────────────────────────────────────
        # For every active connection, look up the remote IP against loaded
        # blocklists.  Results are cached per-IP for the lifetime of the process.
        # A danger-severity alert is emitted the first time each threat IP is seen.
        #
        # ALERT-ONLY: this section only reads data and appends alerts.
        # It does not call block_app(), modify iptables, or execute anything.
        threat_hits: list[dict] = []
        if self._threat_intel:
            for conn in all_connections:
                ip = conn.get("remote", "")
                if not ip or ip == "N/A":
                    continue
                # Cache miss: run the lookup (expensive only on first encounter)
                if ip not in self._threat_cache:
                    self._threat_cache[ip] = self._threat_intel.check_connection(conn)
                threat = self._threat_cache[ip]
                if threat:
                    # Annotate the connection dict so the dashboard can badge it
                    conn["threat"] = threat
                    threat_hits.append({
                        **threat,
                        "app":      conn.get("app", "unknown"),
                        "host":     conn.get("host", ip),
                        "port":     conn.get("port", 0),
                        "protocol": conn.get("protocol", ""),
                    })
                    # Emit one alert per unique threat IP per session
                    if ip not in self._alerted_threat_ips:
                        self._alerted_threat_ips.add(ip)
                        feed_name = threat.get("feed", "unknown feed")
                        category  = threat.get("category", "")
                        sev_label = threat.get("severity", "high")
                        new_alerts.append({
                            "time":     datetime.now().strftime("%H:%M:%S"),
                            "type":     "threat_intel",
                            "message":  (
                                f"Threat detected: {conn.get('app', 'unknown')} "
                                f"→ {conn.get('host', ip)} "
                                f"[{feed_name}] ({category})"
                            ),
                            "severity": "danger" if sev_label == "high" else "warning",
                        })
                        print(
                            f"[TI] ⚠  {conn.get('app','?')} → {conn.get('host', ip)} "
                            f"({ip})  [{feed_name}]"
                        )

        # ── Hourly bandwidth alerts ───────────────────────────────────
        for name, usage in list(self.hourly_usage.items()):
            if usage["sent"] + usage["recv"] > self._bw_threshold:
                new_alerts.append({
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "type": "bandwidth",
                    "message": (
                        f"{name} exceeded "
                        f"{self._bw_threshold // (1024 * 1024)} MB "
                        "in the last hour"
                    ),
                    "severity": "warning",
                })
                self.hourly_usage[name] = {"sent": 0.0, "recv": 0.0}

        for a in new_alerts:
            self.alerts.append(a)
            self.db.execute(
                "INSERT INTO alerts (timestamp, alert_type, message, severity) "
                "VALUES (?,?,?,?)",
                (now, a["type"], a["message"], a["severity"]),
            )
        self.db.commit()

        # ── Phase 4: Attach cached API results to connections ─────────
        # For any IP that has already been looked up (manually or auto),
        # attach the cached result to the connection dict so the
        # dashboard can show the TI panel inline without a new request.
        if self._ti_api:
            for conn in all_connections:
                ip = conn.get("remote", "")
                if not ip or ip in ("N/A", "", "0.0.0.0"):
                    continue
                cached = self._ti_api.get_cached(ip)
                if cached is not None:
                    conn["threat_intel"] = cached

        # ── Phase 4: Auto-lookup threat-flagged IPs ───────────────────
        # If auto_lookup_flagged is enabled and an API is configured,
        # queue a lookup for any newly-flagged IP (once per session).
        ti_cfg = self._settings.get("threat_intel", {})
        if (
            self._ti_api
            and self._ti_api.is_available()
            and ti_cfg.get("auto_lookup_flagged", True)
        ):
            for hit in threat_hits:
                ip = hit.get("ip", "")
                if ip and ip not in self._auto_looked_up:
                    self._auto_looked_up.add(ip)
                    # Run in a thread so we don't block the event loop.
                    # We fire-and-forget here; result lands in the memo
                    # cache and will appear on the next poll.
                    import threading
                    threading.Thread(
                        target=self._ti_api.lookup,
                        args=(ip,),
                        daemon=True,
                        name=f"ti-auto-{ip}",
                    ).start()

        # ── Incident correlation ──────────────────────────────────────
        # Runs after threat intel; groups raw events into higher-level
        # incidents.  ALERT-ONLY: no system commands are ever executed.
        incidents: list[dict] = []
        if self._correlator:
            incidents = self._correlator.correlate(
                connections=all_connections,
                apps=apps_list,
                threats=threat_hits,
                new_app_names=new_apps_this_poll,
                timestamp=now,
            )

        # ── Phase 4: Playbook Engine ──────────────────────────────────
        # Runs after correlator; evaluates YAML playbooks against the
        # current snapshot and correlator incidents.
        playbook_incidents: list[dict] = []
        if self._playbook_engine:
            playbook_incidents = self._playbook_engine.run(
                connections          = all_connections,
                apps                 = apps_list,
                threats              = threat_hits,
                correlator_incidents = incidents,
            )

        # Merge playbook incidents after correlator incidents
        all_incidents = incidents + playbook_incidents

        apps_list.sort(key=lambda x: x["recv"] + x["sent"], reverse=True)

        return {
            "timestamp":    now,
            "total_sent":   total_sent,
            "total_recv":   total_recv,
            "apps":         apps_list[:self._max_apps],
            "connections":  all_connections[:self._max_conns],
            "alerts":       self.alerts[-20:],
            # ── Network map fields ────────────────────────────────────
            "gateway":      self._gateway,
            "local_ip":     self._local_ip,
            "lan_devices":  self._lan_devices,
            # ── Threat intel fields ───────────────────────────────────
            "threats":      threat_hits,
            "threat_count": len(threat_hits),
            "soar_stats":   (
                self._threat_intel.stats()
                if self._threat_intel else
                {"total_indicators": 0, "feeds": [], "loaded_at": None}
            ),
            # ── SOAR Phase 2: Incident Correlation ───────────────────
            "incidents":      all_incidents,
            "incident_count": sum(
                1 for i in all_incidents if i.get("status") == "OPEN"
            ),
            # ── SOAR Phase 3: Response Engine ────────────────────────
            "audit_log":   self._responder.get_audit_log()   if self._responder else [],
            "blocklist":   self._responder.get_blocklist()   if self._responder else [],
            "blocked_ips": self._responder.get_blocked_ips() if self._responder else [],
            "undo_stack":  self._responder.get_undo_stack()  if self._responder else [],
            # ── SOAR Phase 4: Playbooks ───────────────────────────────
            # playbooks : list of loaded playbook metadata dicts
            "playbooks":   (
                self._playbook_engine.get_playbooks_list()
                if self._playbook_engine else []
            ),
            "playbook_activity": (
                self._playbook_engine.get_activity_log(50)
                if self._playbook_engine else []
            ),
        }

    # ── Settings management ───────────────────────────────────────────

    def _apply_settings(self) -> None:
        """Push current settings into runtime variables."""
        alerts_cfg  = self._settings.get("alerts", {})
        display_cfg = self._settings.get("display", {})
        self._poll_interval = float(alerts_cfg.get("poll_interval_seconds", 1))
        self._bw_threshold  = int(alerts_cfg.get("bandwidth_threshold_mb", 100)) * 1024 * 1024
        self._max_conns     = int(display_cfg.get("max_connections_shown", 100))
        self._max_apps      = int(display_cfg.get("max_apps_shown", 30))

    def get_settings_response(self) -> dict:
        """Return masked settings as a WS message."""
        return {
            "type":     "settings_response",
            "settings": _mask_settings(self._settings),
        }

    def update_settings(self, incoming: dict) -> dict:
        """
        Merge *incoming* into current settings, preserving any key whose
        value is the empty string or whose masked value matches what the
        dashboard sent back (i.e. the user didn't change it).

        Returns a WS action_result dict.
        """
        import copy
        updated = copy.deepcopy(self._settings)

        # Merge top-level sections
        for section, vals in incoming.items():
            if section not in updated or not isinstance(vals, dict):
                continue
            for k, v in vals.items():
                if section == "threat_intel" and k in ("virustotal_api_key", "abuseipdb_api_key"):
                    # Sentinel: if value is masked (contains ****) or empty, skip
                    if not v or "****" in str(v):
                        continue
                updated[section][k] = v

        try:
            _write_settings(updated)
            self._settings = updated
            self._apply_settings()
            # Clear threat cache so new keys take effect immediately
            self._threat_cache.clear()
            # Reload feed data with fresh engine (picks up any key changes)
            if self._threat_intel:
                self._threat_intel.load_all()
            # Refresh external API keys and clear session memo
            if self._ti_api:
                ti = updated.get("threat_intel", {})
                self._ti_api.update_keys(
                    vt_key         = ti.get("virustotal_api_key", ""),
                    ab_key         = ti.get("abuseipdb_api_key",  ""),
                    cache_ttl_hours= float(ti.get("cache_ttl_hours", 24)),
                )
                self._auto_looked_up.clear()
            print("[SETTINGS] Applied and saved.")
            return {"type": "action_result", "action": "save_settings",
                    "success": True, "details": "Settings saved successfully."}
        except Exception as e:
            return {"type": "action_result", "action": "save_settings",
                    "success": False, "error": str(e)}

    def refresh_feeds(self) -> dict:
        """Reload threat feed files from disk and return result."""
        if not self._threat_intel:
            return {"type": "action_result", "action": "refresh_feeds",
                    "success": False, "error": "Threat intel engine not loaded."}
        try:
            self._threat_intel.load_all()
            self._threat_cache.clear()
            stats = self._threat_intel.stats()
            return {"type": "action_result", "action": "refresh_feeds",
                    "success": True,
                    "details": f"Reloaded {stats['total_indicators']} indicators from {len(stats['feeds'])} feeds."}
        except Exception as e:
            return {"type": "action_result", "action": "refresh_feeds",
                    "success": False, "error": str(e)}

    # ── Firewall controls ─────────────────────────────────────────────

    def block_app(self, app_name: str):
        self.blocked_apps.add(app_name)
        self.alerts.append({
            "time": datetime.now().strftime("%H:%M:%S"),
            "type": "blocked",
            "message": f"Blocked {app_name} from network access",
            "severity": "danger",
        })
        print(f"[FIREWALL] Blocked: {app_name}")

    def unblock_app(self, app_name: str):
        self.blocked_apps.discard(app_name)
        print(f"[FIREWALL] Unblocked: {app_name}")


# === WEBSOCKET SERVER ========================================================

async def ws_handler(monitor: NetworkMonitor, websocket):
    monitor.ws_clients.add(websocket)
    print(f"[WS] Dashboard connected  ({len(monitor.ws_clients)} client(s))")
    try:
        async for message in websocket:
            try:
                cmd = json.loads(message)
                action = cmd.get("action", "")

                # ── App-level firewall (legacy toggle) ─────────────────
                if action == "block":
                    monitor.block_app(cmd["app"])

                elif action == "unblock":
                    monitor.unblock_app(cmd["app"])

                # ── Incident status ─────────────────────────────────────
                elif action == "acknowledge_incident":
                    inc_id = cmd.get("id", "")
                    if monitor._correlator:
                        monitor._correlator.acknowledge(inc_id)
                    if monitor._playbook_engine:
                        monitor._playbook_engine.acknowledge(inc_id)

                elif action == "resolve_incident":
                    inc_id = cmd.get("id", "")
                    if monitor._correlator:
                        monitor._correlator.resolve(inc_id)
                    if monitor._playbook_engine:
                        monitor._playbook_engine.resolve(inc_id)

                # ── Settings ────────────────────────────────────────────
                elif action == "get_settings":
                    await websocket.send(json.dumps(monitor.get_settings_response()))

                elif action == "save_settings":
                    if not cmd.get("confirm"):
                        await websocket.send(json.dumps({
                            "type": "action_result", "action": "save_settings",
                            "success": False, "error": "requires_confirm",
                        }))
                    else:
                        result = await asyncio.to_thread(
                            monitor.update_settings, cmd.get("settings", {})
                        )
                        await websocket.send(json.dumps(result))
                        # Broadcast updated masked settings to all clients
                        await asyncio.gather(
                            *[c.send(json.dumps(monitor.get_settings_response()))
                              for c in monitor.ws_clients],
                            return_exceptions=True,
                        )

                elif action == "refresh_feeds":
                    result = await asyncio.to_thread(monitor.refresh_feeds)
                    await websocket.send(json.dumps(result))

                # ── Phase 4: Manual IP lookup ───────────────────────────
                elif action == "lookup_ip":
                    ip = cmd.get("ip", "").strip()
                    if ip and monitor._ti_api:
                        async def _do_lookup(ip=ip):
                            try:
                                result = await asyncio.to_thread(
                                    monitor._ti_api.lookup, ip
                                )
                                await websocket.send(json.dumps({
                                    "type":   "threat_intel_result",
                                    "ip":     ip,
                                    "result": result,
                                }))
                            except Exception as exc:
                                await websocket.send(json.dumps({
                                    "type":   "threat_intel_result",
                                    "ip":     ip,
                                    "result": {"ip": ip, "error": str(exc)},
                                }))
                        asyncio.ensure_future(_do_lookup())
                    else:
                        await websocket.send(json.dumps({
                            "type":   "threat_intel_result",
                            "ip":     ip,
                            "result": {
                                "ip":    ip,
                                "error": (
                                    "No API keys configured — add VirusTotal or AbuseIPDB "
                                    "keys in the Settings tab."
                                ),
                            },
                        }))

                # ── Phase 4: Playbook toggle ────────────────────────────
                elif action == "toggle_playbook":
                    name    = cmd.get("name", "")
                    enabled = bool(cmd.get("enabled", True))
                    if monitor._playbook_engine and name:
                        ok = monitor._playbook_engine.set_enabled(name, enabled)
                        await websocket.send(json.dumps({
                            "type":    "action_result",
                            "action":  "toggle_playbook",
                            "success": ok,
                            "details": f"Playbook '{name}' {'enabled' if enabled else 'disabled'}",
                        }))

                # ── Phase 4: Playbook dry run ───────────────────────────
                elif action == "dry_run_playbook":
                    name = cmd.get("name") or None
                    if monitor._playbook_engine:
                        results = await asyncio.to_thread(
                            monitor._playbook_engine.dry_run, name
                        )
                        await websocket.send(json.dumps({
                            "type":    "dry_run_result",
                            "name":    name,
                            "results": results,
                        }))
                    else:
                        await websocket.send(json.dumps({
                            "type":    "dry_run_result",
                            "name":    name,
                            "results": [],
                            "error":   "Playbook engine not loaded",
                        }))

                # ── Phase 4: Save playbook YAML ─────────────────────────
                elif action == "save_playbook":
                    if not cmd.get("confirm"):
                        await websocket.send(json.dumps({
                            "type":    "action_result",
                            "action":  "save_playbook",
                            "success": False,
                            "error":   "requires_confirm",
                        }))
                    elif monitor._playbook_engine:
                        result = await asyncio.to_thread(
                            monitor._playbook_engine.save_playbook_yaml,
                            cmd.get("yaml", ""),
                            cmd.get("filename", ""),
                        )
                        await websocket.send(json.dumps({
                            "type":    "action_result",
                            "action":  "save_playbook",
                            **result,
                        }))

                # ── Phase 4: Delete playbook ────────────────────────────
                elif action == "delete_playbook":
                    if not cmd.get("confirm"):
                        await websocket.send(json.dumps({
                            "type":    "action_result",
                            "action":  "delete_playbook",
                            "success": False,
                            "error":   "requires_confirm",
                        }))
                    elif monitor._playbook_engine:
                        result = await asyncio.to_thread(
                            monitor._playbook_engine.delete_playbook,
                            cmd.get("name", ""),
                        )
                        await websocket.send(json.dumps({
                            "type":    "action_result",
                            "action":  "delete_playbook",
                            **result,
                        }))

                # ── Phase 4: Reload all playbooks ───────────────────────
                elif action == "reload_playbooks":
                    if monitor._playbook_engine:
                        await asyncio.to_thread(monitor._playbook_engine.reload)
                        await websocket.send(json.dumps({
                            "type":    "action_result",
                            "action":  "reload_playbooks",
                            "success": True,
                            "details": f"{len(monitor._playbook_engine.playbooks)} playbook(s) loaded",
                        }))

                # ── Response actions (require confirm=True) ─────────────
                # Each action is run in a thread to avoid blocking the
                # event loop during subprocess calls (netsh / taskkill).
                elif action in RESPONSE_ACTIONS and monitor._responder:
                    result = await asyncio.to_thread(monitor._responder.execute, cmd)
                    await websocket.send(json.dumps(result))

            except json.JSONDecodeError:
                pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        monitor.ws_clients.discard(websocket)
        print(f"[WS] Dashboard disconnected ({len(monitor.ws_clients)} client(s))")


async def broadcast(monitor: NetworkMonitor):
    while monitor.running:
        data = monitor.poll()
        if monitor.ws_clients:
            payload = json.dumps(data)
            await asyncio.gather(
                *[c.send(payload) for c in monitor.ws_clients],
                return_exceptions=True,
            )
        await asyncio.sleep(monitor._poll_interval)


# === TERMINAL DASHBOARD (fallback) ==========================================

def fmt(b: float) -> str:
    if b < 1024:          return f"{b:.0f} B"
    if b < 1_048_576:     return f"{b/1024:.1f} KB"
    if b < 1_073_741_824: return f"{b/1_048_576:.1f} MB"
    return f"{b/1_073_741_824:.2f} GB"


def print_terminal_dashboard(data: dict):
    os.system("cls")
    print("=" * 70)
    print("  ⚡ FLOWSTATE — Local Network Monitor  [Windows]")
    print("=" * 70)
    print(f"  Total ↓ {fmt(data['total_recv'])}/s  |  ↑ {fmt(data['total_sent'])}/s")
    print(f"  Gateway: {data['gateway'] or '(unknown)'}  |  Local IP: {data['local_ip'] or '(unknown)'}")
    threat_cnt = data.get("threat_count", 0)
    threat_tag = f"  ⚠  THREATS: {threat_cnt}" if threat_cnt else ""
    print(f"  LAN devices: {len(data['lan_devices'])}  |  Connections: {len(data['connections'])}{threat_tag}")
    print("-" * 70)
    print(f"  {'APP':<25} {'↓ RECV':>12} {'↑ SENT':>12} {'CONNS':>6}")
    print("-" * 70)
    for app in data["apps"][:15]:
        tag = " [BLOCKED]" if app["blocked"] else ""
        print(
            f"  {app['name']:<25} {fmt(app['recv']):>12} "
            f"{fmt(app['sent']):>12} {app['connections']:>6}{tag}"
        )
    print("-" * 70)
    if data["alerts"]:
        print("  RECENT ALERTS:")
        icons = {"info": "[i]", "warning": "[!]", "danger": "[X]"}
        for a in data["alerts"][-5:]:
            print(f"    {icons.get(a['severity'], '')} {a['time']} — {a['message']}")
    print("\n  Press Ctrl+C to stop  |  Open http://localhost:5173 for the dashboard")


async def terminal_loop(monitor: NetworkMonitor):
    while monitor.running:
        data = monitor.poll()
        print_terminal_dashboard(data)
        await asyncio.sleep(monitor._poll_interval)


# === ENTRY POINT =============================================================

async def main():
    monitor = NetworkMonitor()

    def handle_exit(sig, frame):
        print("\n[FLOWSTATE] Shutting down…")
        monitor.running = False
        monitor.db.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, handle_exit)

    print("=" * 55)
    print("  ⚡ FLOWSTATE — Local Network Monitor  [Windows]")
    print("=" * 55)
    print(f"  Database : {DB_PATH}")

    if not is_admin():
        print()
        print("  ⚠  WARNING: Not running as Administrator.")
        print("     psutil.net_connections() can only see connections")
        print("     owned by the current user without elevation.")
        print("     Re-run from an Administrator PowerShell for full")
        print("     system-wide visibility.")
        print()
    else:
        print("  ✓  Running as Administrator — full visibility enabled")

    if websockets:
        print(f"  WebSocket: ws://{WS_HOST}:{WS_PORT}")
        print(f"  Dashboard: http://localhost:5173")
        print("=" * 55)
        async with websockets.serve(
            lambda ws: ws_handler(monitor, ws),
            WS_HOST, WS_PORT,
        ):
            await asyncio.gather(
                broadcast(monitor),
            )
    else:
        print("  Mode: Terminal only (pip install websockets for dashboard)")
        print("=" * 55)
        await asyncio.gather(
            terminal_loop(monitor),
        )


if __name__ == "__main__":
    asyncio.run(main())
