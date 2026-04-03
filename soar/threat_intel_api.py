"""
SOAR Phase 4 — External Threat Intel API Lookups
=================================================
Queries VirusTotal (v3) and AbuseIPDB (v2) for per-IP enrichment data.

Rate limits respected in-memory each session:
  VirusTotal : 4 requests / minute   (free tier)
  AbuseIPDB  : 1 000 requests / day  (free tier)

Cache: results stored in the threat_cache table in data/history.db.
       TTL is taken from settings (default 24 h).

HTTP transport: stdlib urllib.request only — no requests library needed.

ALERT-ONLY: this module only reads data. No traffic is ever blocked here.
"""

from __future__ import annotations

import json
import sqlite3
import time
import urllib.request
import urllib.error
from collections import deque
from pathlib import Path
from typing import Optional

_DB_PATH = Path(__file__).parent.parent / "data" / "history.db"

# ── Rate-limit state (in-memory, reset on process restart) ────────────
_VT_REQ_TIMES:       deque      = deque()   # epoch timestamps of recent VT calls
_AB_REQ_COUNT:       int        = 0         # AbuseIPDB calls today
_AB_DAY_START:       float      = 0.0       # epoch when today's window began

VT_RPM_LIMIT  = 4
AB_RPD_LIMIT  = 1000


def _vt_ok() -> bool:
    """True if another VirusTotal request is allowed right now."""
    now = time.time()
    while _VT_REQ_TIMES and now - _VT_REQ_TIMES[0] > 60:
        _VT_REQ_TIMES.popleft()
    return len(_VT_REQ_TIMES) < VT_RPM_LIMIT


def _vt_record() -> None:
    _VT_REQ_TIMES.append(time.time())


def _ab_ok() -> bool:
    """True if AbuseIPDB daily quota has not been exhausted."""
    global _AB_REQ_COUNT, _AB_DAY_START
    now = time.time()
    if now - _AB_DAY_START >= 86_400:
        _AB_REQ_COUNT = 0
        _AB_DAY_START = now
    return _AB_REQ_COUNT < AB_RPD_LIMIT


def _ab_record() -> None:
    global _AB_REQ_COUNT
    _AB_REQ_COUNT += 1


# ── SQLite cache helpers ──────────────────────────────────────────────

def _ensure_cache_table(db: sqlite3.Connection) -> None:
    db.execute("""
        CREATE TABLE IF NOT EXISTS threat_cache (
            ip         TEXT PRIMARY KEY,
            cached_at  REAL NOT NULL,
            vt_result  TEXT,
            ab_result  TEXT
        )
    """)
    db.commit()


def _cache_get(ip: str, ttl_hours: float) -> Optional[dict]:
    """Return the cached dict for *ip* if fresh, else None."""
    try:
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(str(_DB_PATH))
        _ensure_cache_table(db)
        row = db.execute(
            "SELECT cached_at, vt_result, ab_result FROM threat_cache WHERE ip = ?",
            (ip,),
        ).fetchone()
        db.close()
        if row is None:
            return None
        cached_at, vt_json, ab_json = row
        if time.time() - cached_at > ttl_hours * 3600:
            return None  # stale
        return {
            "ip":        ip,
            "cached":    True,
            "cached_at": cached_at,
            "virustotal": json.loads(vt_json) if vt_json else None,
            "abuseipdb":  json.loads(ab_json)  if ab_json else None,
        }
    except Exception:
        return None


def _cache_put(ip: str, vt: Optional[dict], ab: Optional[dict]) -> None:
    """Upsert lookup results into the cache table."""
    try:
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(str(_DB_PATH))
        _ensure_cache_table(db)
        db.execute(
            "INSERT OR REPLACE INTO threat_cache (ip, cached_at, vt_result, ab_result) "
            "VALUES (?,?,?,?)",
            (
                ip, time.time(),
                json.dumps(vt) if vt is not None else None,
                json.dumps(ab) if ab is not None else None,
            ),
        )
        db.commit()
        db.close()
    except Exception as exc:
        print(f"[TIAPI] Cache write error: {exc}")


# ── HTTP helper ───────────────────────────────────────────────────────

def _http_get(url: str, headers: dict, timeout: int = 12) -> Optional[dict]:
    """GET *url* with *headers*, return parsed JSON or None."""
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        print(f"[TIAPI] HTTP {exc.code} → {url}")
        return None
    except Exception as exc:
        print(f"[TIAPI] Request error ({url}): {exc}")
        return None


# ── VirusTotal lookup ─────────────────────────────────────────────────

class VirusTotalLookup:
    """Queries VirusTotal v3 /ip_addresses/{ip} for IP reputation."""

    _URL = "https://www.virustotal.com/api/v3/ip_addresses/{ip}"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def lookup(self, ip: str) -> Optional[dict]:
        if not self.api_key:
            return None
        if not _vt_ok():
            print(f"[TIAPI] VT rate limit — skipping {ip}")
            return None

        data = _http_get(
            self._URL.format(ip=ip),
            headers={"x-apikey": self.api_key},
        )
        if data is None:
            return None
        _vt_record()

        try:
            attrs        = data.get("data", {}).get("attributes", {})
            stats        = attrs.get("last_analysis_stats", {})
            malicious    = stats.get("malicious",  0)
            suspicious   = stats.get("suspicious", 0)
            total        = sum(stats.values()) if stats else 0
            last_ts      = attrs.get("last_analysis_date")
            last_date    = (
                time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(last_ts))
                if last_ts else ""
            )
            return {
                "malicious":          malicious,
                "suspicious":         suspicious,
                "total_vendors":      total,
                "detection_ratio":    f"{malicious}/{total}" if total else "0/0",
                "country":            attrs.get("country", ""),
                "asn":                str(attrs.get("asn", "")),
                "asn_owner":          attrs.get("as_owner", ""),
                "reputation":         attrs.get("reputation", 0),
                "last_analysis_date": last_date,
            }
        except Exception as exc:
            print(f"[TIAPI] VT parse error: {exc}")
            return None


# ── AbuseIPDB lookup ──────────────────────────────────────────────────

class AbuseIPDBLookup:
    """Queries AbuseIPDB v2 /check for IP abuse reports."""

    _URL = "https://api.abuseipdb.com/api/v2/check"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def lookup(self, ip: str) -> Optional[dict]:
        if not self.api_key:
            return None
        if not _ab_ok():
            print(f"[TIAPI] AbuseIPDB daily quota exhausted — skipping {ip}")
            return None

        data = _http_get(
            f"{self._URL}?ipAddress={ip}&maxAgeInDays=90",
            headers={"Key": self.api_key, "Accept": "application/json"},
        )
        if data is None:
            return None
        _ab_record()

        try:
            d            = data.get("data", {})
            last_rpt     = (d.get("lastReportedAt") or "")
            if "T" in last_rpt:
                last_rpt = last_rpt[:10]
            return {
                "confidence_score": d.get("abuseConfidenceScore", 0),
                "total_reports":    d.get("totalReports", 0),
                "last_reported":    last_rpt,
                "country_code":     d.get("countryCode", ""),
                "isp":              d.get("isp", ""),
                "domain":           d.get("domain", ""),
                "is_whitelisted":   d.get("isWhitelisted", False),
            }
        except Exception as exc:
            print(f"[TIAPI] AbuseIPDB parse error: {exc}")
            return None


# ── Combined manager ──────────────────────────────────────────────────

class ThreatIntelAPI:
    """
    Orchestrates VirusTotal + AbuseIPDB lookups with SQLite caching.

    Usage
    -----
        api = ThreatIntelAPI(vt_key="…", ab_key="…", cache_ttl_hours=24)
        result = api.lookup("1.2.3.4")
        # result → {ip, virustotal: {…}, abuseipdb: {…}, risk_score: 0-100,
        #           cached: bool, cached_at: epoch}

    Thread-safety: each lookup opens/closes its own DB connection. Safe for
    concurrent asyncio.to_thread() calls.
    """

    def __init__(
        self,
        vt_key: str = "",
        ab_key: str = "",
        cache_ttl_hours: float = 24.0,
    ) -> None:
        self.vt              = VirusTotalLookup(vt_key)
        self.ab              = AbuseIPDBLookup(ab_key)
        self.cache_ttl_hours = cache_ttl_hours
        # Session-level memo: avoids redundant DB reads for the same IP
        self._memo: dict[str, dict] = {}

    def update_keys(
        self,
        vt_key: str,
        ab_key: str,
        cache_ttl_hours: float = 24.0,
    ) -> None:
        self.vt.api_key      = vt_key
        self.ab.api_key      = ab_key
        self.cache_ttl_hours = cache_ttl_hours
        self._memo.clear()

    def lookup(self, ip: str) -> dict:
        """
        Full lookup for *ip* (cache → live API).  Always returns a dict,
        never raises.  Returns ``{"ip": ip, "error": "…"}`` on failure.
        """
        # In-memory memo
        if ip in self._memo:
            return self._memo[ip]

        # DB cache hit
        cached = _cache_get(ip, self.cache_ttl_hours)
        if cached is not None:
            result = {**cached, "risk_score": self._risk_score(cached)}
            self._memo[ip] = result
            return result

        # Live lookups
        vt_result = self.vt.lookup(ip)
        ab_result = self.ab.lookup(ip)

        # Persist to DB only when at least one provider returned data
        if vt_result is not None or ab_result is not None:
            _cache_put(ip, vt_result, ab_result)

        result: dict = {
            "ip":        ip,
            "cached":    False,
            "cached_at": time.time(),
            "virustotal": vt_result,
            "abuseipdb":  ab_result,
        }
        result["risk_score"] = self._risk_score(result)
        self._memo[ip] = result
        return result

    def get_cached(self, ip: str) -> Optional[dict]:
        """Return cached result without making any API calls."""
        if ip in self._memo:
            return self._memo[ip]
        cached = _cache_get(ip, self.cache_ttl_hours)
        if cached is not None:
            result = {**cached, "risk_score": self._risk_score(cached)}
            self._memo[ip] = result
            return result
        return None

    def is_available(self) -> bool:
        """True if at least one API key is configured."""
        return bool(self.vt.api_key or self.ab.api_key)

    @staticmethod
    def _risk_score(data: dict) -> int:
        """
        Combined 0–100 risk score.

        VirusTotal malicious ratio → up to 70 points
        AbuseIPDB confidence score → up to 30 points
        """
        score = 0
        vt = data.get("virustotal")
        ab = data.get("abuseipdb")
        if vt:
            total     = vt.get("total_vendors", 0) or 1
            malicious = vt.get("malicious", 0)
            score    += int(min(malicious / total * 70, 70))
        if ab:
            score += int((ab.get("confidence_score", 0) / 100) * 30)
        return min(score, 100)
