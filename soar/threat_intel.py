"""
Threat Intelligence Engine
==========================
Loads local feed files from the feeds/ directory and provides fast IP
lookups against every configured blocklist.

Lookup strategy
---------------
1. Exact IP match  — O(1) dict lookup.
2. CIDR range match — linear scan over range entries (feeds like Spamhaus
   DROP publish /24–/16 netblocks rather than individual IPs).  The CIDR
   list is typically <2 000 entries so this stays well under 1 ms.

No outbound network calls are made here.  Use feed_updater.py to refresh
the local feed files, then call engine.load_all() to reload.

ALERT-ONLY: This engine only *detects* — it never modifies firewall rules,
blocks connections, or executes any system commands.

Usage
-----
    from soar.threat_intel import ThreatIntelEngine
    from pathlib import Path

    engine = ThreatIntelEngine(Path("soar/feeds"))
    match = engine.check_ip("198.51.100.1")
    if match:
        print(match.feed_name, match.severity, match.description)
"""

from __future__ import annotations

import csv
import ipaddress
import re
import time
from pathlib import Path
from typing import Optional

from .models import FeedInfo, ThreatMatch

# ── Feed definitions ──────────────────────────────────────────────────────────
# Centralised here so threat_intel.py and feed_updater.py stay in sync.

FEED_DEFS: list[FeedInfo] = [
    FeedInfo(
        name="Feodo Botnet C2",
        filename="feodo_c2.txt",
        url="https://feodotracker.abuse.ch/downloads/ipblocklist.txt",
        category="botnet",
        severity="high",
        description="Active botnet command & control servers tracked by abuse.ch Feodo Tracker",
    ),
    FeedInfo(
        name="URLhaus Malware",
        filename="urlhaus.csv",
        url="https://urlhaus.abuse.ch/downloads/csv_online/",
        category="malware",
        severity="high",
        description="Active malware distribution hosts tracked by abuse.ch URLhaus",
    ),
    FeedInfo(
        name="Emerging Threats Compromised",
        filename="et_compromised.txt",
        url="https://rules.emergingthreats.net/blockrules/compromised-ips.txt",
        category="compromised",
        severity="medium",
        description="Known compromised hosts from Emerging Threats",
    ),
    FeedInfo(
        name="Spamhaus DROP",
        filename="spamhaus_drop.txt",
        url="https://www.spamhaus.org/drop/drop.txt",
        category="spam",
        severity="high",
        description="Spamhaus Don't Route Or Peer — hijacked / spam-operated netblocks (CIDR)",
    ),
]

# ── Compiled patterns ─────────────────────────────────────────────────────────

# IPv4 embedded in a URL: http://1.2.3.4/... or https://1.2.3.4:8080/...
_URL_IP_RE = re.compile(r"https?://(\d{1,3}(?:\.\d{1,3}){3})[:/]")
# Bare IPv4 CIDR at start of line
_CIDR_RE = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3}/\d{1,2})")
# Bare IPv4 address (full string)
_IP_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


def _is_public(ip_str: str) -> bool:
    """Return True if the address is globally routable (skip RFC-1918/loopback)."""
    try:
        addr = ipaddress.IPv4Address(ip_str)
        return not (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
        )
    except ValueError:
        return False


# ── Engine ────────────────────────────────────────────────────────────────────

class ThreatIntelEngine:
    """
    In-memory threat intelligence engine backed by local feed files.

    Thread safety: load_all() is not thread-safe.  Call it from a single
    thread (the main backend loop) before starting the async event loop, or
    wrap the call in a lock if reloading at runtime.
    """

    def __init__(self, feeds_dir: Path) -> None:
        self.feeds_dir = Path(feeds_dir)
        self.feeds_dir.mkdir(parents=True, exist_ok=True)

        # Primary store: exact IP → ThreatMatch
        self._exact: dict[str, ThreatMatch] = {}
        # Secondary store: CIDR ranges (for Spamhaus DROP etc.)
        self._cidr: list[tuple[ipaddress.IPv4Network, ThreatMatch]] = []
        # Metadata for loaded feeds (sent to dashboard)
        self.feeds: list[FeedInfo] = []
        self._loaded_at: float = 0.0

        self.load_all()

    # ── Public interface ──────────────────────────────────────────────

    def check_ip(self, ip: str) -> Optional[ThreatMatch]:
        """
        Return a ThreatMatch if *ip* appears in any loaded feed, else None.

        Tries exact match first (O(1)), then CIDR scan.
        Returns None for private/loopback addresses without scanning.
        """
        if not _is_public(ip):
            return None
        # Fast path
        hit = self._exact.get(ip)
        if hit:
            return hit
        # CIDR path
        try:
            addr = ipaddress.IPv4Address(ip)
        except ValueError:
            return None
        for net, proto_match in self._cidr:
            if addr in net:
                # Return a per-IP copy so the caller gets the actual queried IP
                return ThreatMatch(
                    ip=ip,
                    feed_name=proto_match.feed_name,
                    category=proto_match.category,
                    severity=proto_match.severity,
                    description=proto_match.description,
                    tags=proto_match.tags,
                )
        return None

    def check_connection(self, conn: dict) -> Optional[dict]:
        """
        Convenience wrapper: check a connection dict's 'remote' field.
        Returns the serialised ThreatMatch dict or None.
        """
        ip = conn.get("remote", "")
        if not ip or ip in ("N/A", "", "0.0.0.0"):
            return None
        match = self.check_ip(ip)
        return match.to_dict() if match else None

    def load_all(self) -> None:
        """
        (Re)load all feed files from disk.  Safe to call at any time to pick
        up freshly-downloaded feeds without restarting the backend.
        """
        self._exact.clear()
        self._cidr.clear()
        self.feeds.clear()

        for feed_def in FEED_DEFS:
            path = self.feeds_dir / feed_def.filename
            if not path.exists():
                continue
            try:
                count = self._load_feed(path, feed_def)
                info = FeedInfo(
                    name=feed_def.name,
                    filename=feed_def.filename,
                    url=feed_def.url,
                    category=feed_def.category,
                    severity=feed_def.severity,
                    description=feed_def.description,
                    record_count=count,
                    last_updated=time.strftime(
                        "%Y-%m-%d %H:%M",
                        time.localtime(path.stat().st_mtime),
                    ),
                )
                self.feeds.append(info)
                print(f"[TI] {feed_def.name}: {count:,} indicators loaded")
            except Exception as exc:  # noqa: BLE001
                print(f"[TI] Failed to load {feed_def.filename}: {exc}")

        self._loaded_at = time.time()
        total = self.total_indicators
        if total:
            print(
                f"[TI] Ready — {len(self._exact):,} IPs + {len(self._cidr):,} CIDR ranges "
                f"= {total:,} indicators across {len(self.feeds)} feed(s)"
            )
        else:
            print(
                "[TI] No feed files found in feeds/ — "
                "run `python -m soar.feed_updater` to download them."
            )

    @property
    def total_indicators(self) -> int:
        return len(self._exact) + len(self._cidr)

    def stats(self) -> dict:
        return {
            "total_indicators": self.total_indicators,
            "exact_ips": len(self._exact),
            "cidr_ranges": len(self._cidr),
            "feeds": [f.to_dict() for f in self.feeds],
            "loaded_at": time.strftime(
                "%Y-%m-%d %H:%M:%S", time.localtime(self._loaded_at)
            ),
        }

    # ── Private loaders ───────────────────────────────────────────────

    def _load_feed(self, path: Path, feed: FeedInfo) -> int:
        """Dispatch to the appropriate parser based on filename / feed type."""
        if feed.filename.endswith(".csv"):
            return self._load_urlhaus_csv(path, feed)
        if "spamhaus" in feed.filename:
            return self._load_spamhaus(path, feed)
        return self._load_plaintext(path, feed)

    def _load_plaintext(self, path: Path, feed: FeedInfo) -> int:
        """
        Generic one-entry-per-line parser.
        Accepts bare IPs and CIDR notation; lines beginning with '#' are skipped.
        """
        count = 0
        with open(path, encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                line = line.split("#")[0].strip()  # strip inline comments

                # CIDR block
                cidr_m = _CIDR_RE.match(line)
                if cidr_m:
                    try:
                        net = ipaddress.IPv4Network(cidr_m.group(1), strict=False)
                        proto = ThreatMatch(
                            ip=str(net),
                            feed_name=feed.name,
                            category=feed.category,
                            severity=feed.severity,
                            description=feed.description,
                        )
                        self._cidr.append((net, proto))
                        count += 1
                    except ValueError:
                        pass
                    continue

                # Plain IP
                if _IP_RE.match(line) and _is_public(line):
                    self._exact[line] = ThreatMatch(
                        ip=line,
                        feed_name=feed.name,
                        category=feed.category,
                        severity=feed.severity,
                        description=feed.description,
                    )
                    count += 1

        return count

    def _load_spamhaus(self, path: Path, feed: FeedInfo) -> int:
        """
        Spamhaus DROP / EDROP format:
            1.2.3.0/24 ; SBL12345
        Lines beginning with ';' are comments.
        """
        count = 0
        with open(path, encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith(";"):
                    continue
                # Split on ';' to separate CIDR from SBL reference
                parts = line.split(";", 1)
                cidr_str = parts[0].strip()
                sbl_ref = parts[1].strip() if len(parts) > 1 else ""

                cidr_m = _CIDR_RE.match(cidr_str)
                if not cidr_m:
                    continue
                try:
                    net = ipaddress.IPv4Network(cidr_m.group(1), strict=False)
                    proto = ThreatMatch(
                        ip=str(net),
                        feed_name=feed.name,
                        category=feed.category,
                        severity=feed.severity,
                        description=feed.description,
                        tags=[sbl_ref] if sbl_ref else [],
                    )
                    self._cidr.append((net, proto))
                    count += 1
                except ValueError:
                    pass

        return count

    def _load_urlhaus_csv(self, path: Path, feed: FeedInfo) -> int:
        """
        URLhaus CSV format:
            # comment lines …
            id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter
            "123","2024-01-01 00:00:00","http://1.2.3.4/evil.exe","online",…

        We extract bare IPs from the URL column; hostname-based entries are
        skipped (they cannot be reverse-mapped to an IP at load time).
        """
        count = 0
        with open(path, encoding="utf-8", errors="replace", newline="") as fh:
            # Collect non-comment lines for csv.DictReader
            data_lines: list[str] = [
                line for line in fh if not line.startswith("#")
            ]

        if not data_lines:
            return 0

        reader = csv.DictReader(data_lines)
        for row in reader:
            # Column name may have stray quotes depending on the CSV variant
            url = row.get("url") or row.get('"url"') or ""
            if not url:
                continue

            ip_m = _URL_IP_RE.search(url)
            if not ip_m:
                continue
            ip = ip_m.group(1)
            if not _is_public(ip):
                continue

            threat_type = (row.get("threat") or "malware").strip()
            tags_raw = (row.get("tags") or "").strip()
            tags = [t.strip() for t in tags_raw.split(",") if t.strip()]

            self._exact[ip] = ThreatMatch(
                ip=ip,
                feed_name=feed.name,
                category=feed.category,
                severity=feed.severity,
                description=f"{threat_type} distribution host",
                tags=tags,
            )
            count += 1

        return count
