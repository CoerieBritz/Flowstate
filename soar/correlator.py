"""
SOAR Incident Correlator — Phase 2
====================================
Groups raw connection/alert events into higher-level Incidents using
5 correlation rules.  Alert-only mode: never executes actions, only
creates recommendations.

Rules
-----
R1  Same process + same destination within 5 min  → LOW   (group)
R2  Same process + ≥2 threat-flagged IPs in 10 min → HIGH
R3  ≥2 processes + same destination in 15 min      → CRITICAL
R4  Bandwidth ≥ 2× rolling 1-hr average            → MEDIUM
R5  New process + first outbound connection         → LOW
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict, deque
from datetime import datetime
from typing import Optional

# ── Severity ordering (used for sort) ─────────────────────────────────
_SEV_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}


def _fmt_bw(b: float) -> str:
    if b < 1024:        return f"{b:.0f} B/s"
    if b < 1_048_576:   return f"{b/1024:.1f} KB/s"
    return f"{b/1_048_576:.1f} MB/s"


# ── Recommended-action templates (keyed by rule) ──────────────────────
_ACTIONS: dict[str, list[str]] = {
    "R1": [
        "Review {process}'s repeated connections to {destination}",
        "Verify {destination} is an expected destination for {process}",
        "Check if the connection pattern matches C2 polling behaviour",
        "Consider applying a firewall rule if behaviour is unexplained",
    ],
    "R2": [
        "Immediately investigate {process} — it contacted multiple threat-listed IPs",
        "Check {process} for malware or compromise indicators",
        "Consider isolating or blocking {process} pending investigation",
        "Review threat-intel details for each flagged destination below",
    ],
    "R3": [
        "Multiple processes are contacting {destination} — possible coordinated exfiltration",
        "Involved processes: {processes}",
        "Determine whether {destination} is a legitimate shared CDN or suspicious host",
        "Consider blocking outbound access to {destination} during investigation",
    ],
    "R4": [
        "{process} bandwidth is {ratio}× its 1-hour rolling average",
        "Check what {process} is currently sending or receiving",
        "Inspect recent file access, clipboard usage, or background syncs for {process}",
        "Consider temporarily blocking {process} if exfiltration is suspected",
    ],
    "R5": [
        "New process {process} made its first observed outbound connection",
        "Verify {process} is a trusted and expected application",
        "Check the process launch path, parent process, and signature",
        "If unknown, consider blocking via the Firewall tab until verified",
    ],
}


# ══════════════════════════════════════════════════════════════════════
# Incident
# ══════════════════════════════════════════════════════════════════════

class Incident:
    """A correlated security incident grouping one or more raw events."""

    def __init__(
        self,
        *,
        title: str,
        severity: str,
        rule: str,
        recommended_actions: list[str],
    ) -> None:
        self.id: str = str(uuid.uuid4())[:8]
        self.title = title
        self.severity = severity
        self.rule = rule
        self.status = "OPEN"           # OPEN | ACKNOWLEDGED | RESOLVED
        self.alerts: list[dict] = []
        self.recommended_actions = recommended_actions
        self.created_at = time.time()
        self.updated_at = time.time()
        self.processes: set[str] = set()
        self.ips: set[str] = set()

    # ── helpers ──────────────────────────────────────────────────────

    def add_alert(self, alert: dict) -> None:
        self.alerts.append(alert)
        self.updated_at = time.time()
        if p := alert.get("process"):
            self.processes.add(p)
        if ip := alert.get("ip"):
            self.ips.add(ip)

    def to_dict(self) -> dict:
        return {
            "id":                  self.id,
            "title":               self.title,
            "severity":            self.severity,
            "rule":                self.rule,
            "status":              self.status,
            "alerts":              self.alerts,
            "recommended_actions": self.recommended_actions,
            "created_at":          self.created_at,
            "updated_at":          self.updated_at,
            "processes":           sorted(self.processes),
            "ips":                 sorted(self.ips),
            "alert_count":         len(self.alerts),
        }


# ══════════════════════════════════════════════════════════════════════
# IncidentCorrelator
# ══════════════════════════════════════════════════════════════════════

class IncidentCorrelator:
    """
    Correlates connection/alert events into higher-level Incidents.

    Maintains a sliding 1-hour window of observed events.  Each call to
    ``correlate()`` receives a snapshot from the backend poll; the
    correlator applies the 5 rules and returns the current incident list.

    ALERT-ONLY: never blocks traffic, never modifies system state.
    """

    # Window sizes (seconds) per rule
    WINDOW_1HR     = 3600
    WINDOW_R1      = 300     # R1 : 5  min
    WINDOW_R2      = 600     # R2 : 10 min
    WINDOW_R3      = 900     # R3 : 15 min

    # Thresholds
    R1_OBS_MIN     = 4       # ≥4 distinct minute-bucket observations
    R1_SKIP_PORTS  = {80, 443, 53}   # skip standard web/DNS ports for R1
    R2_THREAT_MIN  = 2       # ≥2 distinct threat IPs → R2
    R3_PROC_MIN    = 2       # ≥2 distinct processes → R3
    R4_MULTIPLIER  = 2.0     # 2× rolling avg
    R4_MIN_BW      = 50_000  # minimum spike value (50 KB/s) to avoid false positives
    R4_MIN_SAMPLES = 30      # need ≥30 historical samples before R4 fires
    R4_COOLDOWN    = 120     # seconds between successive R4 alerts for same process

    def __init__(self) -> None:
        # (proc, dest) → deque of minute-bucket timestamps (for R1, R3)
        #   We record at most one entry per (proc, dest) per 60-second bucket.
        self._conn_obs: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._conn_last_seen: dict[tuple[str, str], float] = {}

        # proc → deque of (timestamp, threat_dest_ip) (for R2)
        self._threat_obs: dict[str, deque[tuple[float, str]]] = defaultdict(deque)

        # proc → deque of (timestamp, bytes_per_poll) (for R4)
        self._proc_bw: dict[str, deque[tuple[float, float]]] = defaultdict(deque)

        # proc → last R4 alert timestamp (cooldown)
        self._r4_last_alert: dict[str, float] = {}

        # Known processes (for R5)
        self._known_procs: set[str] = set()

        # Active / resolved incidents
        self._incidents: dict[str, Incident] = {}

        # Dedup map: (rule_id, key) → incident_id
        # When an incident is resolved its key is removed so the same
        # pattern can generate a fresh incident later.
        self._incident_keys: dict[tuple[str, str], str] = {}

    # ── Public interface ──────────────────────────────────────────────

    def correlate(
        self,
        connections: list[dict],
        apps: list[dict],
        threats: list[dict],
        new_app_names: set[str],
        timestamp: Optional[float] = None,
    ) -> list[dict]:
        """
        Process one backend-poll snapshot and return the incident list.

        Parameters
        ----------
        connections   : Active connections from poll().
        apps          : Per-app bandwidth dicts from poll().
        threats       : Threat hits produced by this poll (may be empty).
        new_app_names : Process names that are new *this poll* (Rule 5).
        timestamp     : Epoch override for testing; defaults to time.time().
        """
        now = timestamp or time.time()

        # Build threat-IP set for fast lookup
        threat_ips: set[str] = {t.get("ip", "") for t in threats if t.get("ip")}

        # ── Ingest connection observations ────────────────────────────
        for conn in connections:
            proc = conn.get("app", "unknown")
            dest = conn.get("remote", "")
            port = conn.get("port", 0)
            if not dest or proc in ("unknown", ""):
                continue

            pair = (proc, dest)
            # Minute-bucket de-dup: record at most once per 60 s per pair
            last = self._conn_last_seen.get(pair, 0.0)
            if now - last >= 60:
                self._conn_last_seen[pair] = now
                dq = self._conn_obs[pair]
                dq.append(now)
                # Expire events older than 1 hr
                while dq and now - dq[0] > self.WINDOW_1HR:
                    dq.popleft()

            # Track threat observations (no de-dup — count every hit)
            if dest in threat_ips:
                tdq = self._threat_obs[proc]
                tdq.append((now, dest))
                while tdq and now - tdq[0][0] > self.WINDOW_1HR:
                    tdq.popleft()

        # ── Update per-process bandwidth history ──────────────────────
        for app in apps:
            name = app.get("name", "")
            if not name or name == "unknown":
                continue
            bw = app.get("sent", 0.0) + app.get("recv", 0.0)
            bdq = self._proc_bw[name]
            bdq.append((now, bw))
            while bdq and now - bdq[0][0] > self.WINDOW_1HR:
                bdq.popleft()

        # ── Apply correlation rules ───────────────────────────────────
        self._rule1(now, connections)
        self._rule2(now, threats, connections)
        self._rule3(now, connections)
        self._rule4(now, apps)
        self._rule5(now, new_app_names, connections)

        # ── Update known-process set ──────────────────────────────────
        self._known_procs.update(new_app_names)
        self._known_procs.update(
            c.get("app", "") for c in connections if c.get("app")
        )

        return self._serialize()

    def acknowledge(self, incident_id: str) -> bool:
        inc = self._incidents.get(incident_id)
        if inc and inc.status == "OPEN":
            inc.status = "ACKNOWLEDGED"
            inc.updated_at = time.time()
            return True
        return False

    def resolve(self, incident_id: str) -> bool:
        inc = self._incidents.get(incident_id)
        if inc and inc.status != "RESOLVED":
            inc.status = "RESOLVED"
            inc.updated_at = time.time()
            # Remove dedup key so same pattern can create a new incident later
            for k, v in list(self._incident_keys.items()):
                if v == incident_id:
                    del self._incident_keys[k]
            return True
        return False

    # ── Internal helpers ──────────────────────────────────────────────

    def _get_or_create(
        self,
        rule: str,
        key: str,
        title: str,
        severity: str,
        actions: list[str],
    ) -> Incident:
        """Return the existing non-resolved incident for (rule, key) or make one."""
        ik = (rule, key)
        if ik in self._incident_keys:
            existing = self._incidents.get(self._incident_keys[ik])
            if existing and existing.status != "RESOLVED":
                return existing
        inc = Incident(
            title=title,
            severity=severity,
            rule=rule,
            recommended_actions=actions,
        )
        self._incidents[inc.id] = inc
        self._incident_keys[ik] = inc.id
        return inc

    @staticmethod
    def _ts_str(ts: float) -> str:
        return datetime.fromtimestamp(ts).strftime("%H:%M:%S")

    def _make_alert(
        self,
        rule: str,
        message: str,
        *,
        process: str = "",
        ip: str = "",
        host: str = "",
        ts: Optional[float] = None,
    ) -> dict:
        return {
            "time":    self._ts_str(ts or time.time()),
            "rule":    rule,
            "message": message,
            "process": process,
            "ip":      ip,
            "host":    host,
        }

    # ── Rule 1 ────────────────────────────────────────────────────────
    # Same process + same destination (non-standard port) ≥R1_OBS_MIN
    # distinct minute observations within WINDOW_R1 → LOW incident.

    def _rule1(self, now: float, connections: list[dict]) -> None:
        cutoff = now - self.WINDOW_R1

        # Build a quick lookup: (proc, dest) → host/port
        pair_meta: dict[tuple[str, str], dict] = {}
        for conn in connections:
            proc = conn.get("app", "unknown")
            dest = conn.get("remote", "")
            port = conn.get("port", 0)
            if not dest or proc in ("unknown", ""):
                continue
            if port in self.R1_SKIP_PORTS:
                continue
            pair_meta[(proc, dest)] = {
                "host": conn.get("host") or dest,
                "port": port,
            }

        for pair, meta in pair_meta.items():
            proc, dest = pair
            dq = self._conn_obs.get(pair)
            if dq is None:
                continue

            obs_in_window = sum(1 for t in dq if t >= cutoff)
            if obs_in_window < self.R1_OBS_MIN:
                continue

            host = meta["host"]
            port = meta["port"]
            key = f"{proc}|{dest}"
            actions = [
                a.format(process=proc, destination=f"{host}:{port}")
                for a in _ACTIONS["R1"]
            ]
            inc = self._get_or_create(
                "R1", key,
                title=f"Repeated connection: {proc} → {host}:{port}",
                severity="LOW",
                actions=actions,
            )
            # Append an alert only when the count grows (avoid per-poll spam)
            if len(inc.alerts) == 0 or obs_in_window > inc.alerts[-1].get("_count", 0):
                alert = self._make_alert(
                    "R1",
                    f"{proc} made {obs_in_window} connection{'s' if obs_in_window != 1 else ''} "
                    f"to {host}:{port} in the last 5 min",
                    process=proc, ip=dest, host=host, ts=now,
                )
                alert["_count"] = obs_in_window
                inc.add_alert(alert)

    # ── Rule 2 ────────────────────────────────────────────────────────
    # Same process contacted ≥R2_THREAT_MIN distinct threat IPs in
    # WINDOW_R2 → HIGH.

    def _rule2(
        self, now: float, threats: list[dict], connections: list[dict]
    ) -> None:
        cutoff = now - self.WINDOW_R2

        # proc → set of distinct threat IPs in window
        proc_threat_ips: dict[str, set[str]] = defaultdict(set)
        for proc, dq in self._threat_obs.items():
            for ts, tip in dq:
                if ts >= cutoff:
                    proc_threat_ips[proc].add(tip)

        for proc, tip_set in proc_threat_ips.items():
            if len(tip_set) < self.R2_THREAT_MIN:
                continue

            ip_list = ", ".join(sorted(tip_set)[:5])
            key = proc
            actions = [a.format(process=proc) for a in _ACTIONS["R2"]]
            inc = self._get_or_create(
                "R2", key,
                title=f"Multiple threat IPs contacted by {proc}",
                severity="HIGH",
                actions=actions,
            )
            prev_count = len(inc.ips)
            for ip in tip_set:
                inc.ips.add(ip)
            inc.processes.add(proc)
            if len(inc.ips) > prev_count:
                alert = self._make_alert(
                    "R2",
                    f"{proc} contacted {len(tip_set)} threat-listed IP"
                    f"{'s' if len(tip_set) != 1 else ''} within 10 min: {ip_list}",
                    process=proc, ts=now,
                )
                inc.add_alert(alert)

    # ── Rule 3 ────────────────────────────────────────────────────────
    # ≥R3_PROC_MIN distinct processes connecting to the same destination
    # within WINDOW_R3 → CRITICAL.

    def _rule3(self, now: float, connections: list[dict]) -> None:
        cutoff = now - self.WINDOW_R3

        # dest → set of processes seen in window
        dest_procs: dict[str, set[str]] = defaultdict(set)
        dest_host: dict[str, str] = {}
        for (proc, dest), dq in self._conn_obs.items():
            if any(t >= cutoff for t in dq):
                dest_procs[dest].add(proc)

        # Also grab hostnames from latest connections
        for conn in connections:
            dest = conn.get("remote", "")
            if dest and conn.get("host"):
                dest_host[dest] = conn["host"]

        for dest, procs in dest_procs.items():
            if len(procs) < self.R3_PROC_MIN:
                continue

            host = dest_host.get(dest, dest)
            proc_list = ", ".join(sorted(procs)[:5])
            key = dest
            actions = [
                a.format(destination=host, processes=proc_list)
                for a in _ACTIONS["R3"]
            ]
            inc = self._get_or_create(
                "R3", key,
                title=f"Multi-process fan-out: {len(procs)} processes → {host}",
                severity="CRITICAL",
                actions=actions,
            )
            prev_procs = set(inc.processes)
            for p in procs:
                inc.processes.add(p)
            inc.ips.add(dest)
            if inc.processes != prev_procs or len(inc.alerts) == 0:
                alert = self._make_alert(
                    "R3",
                    f"{len(procs)} process{'es' if len(procs) != 1 else ''} "
                    f"contacting {host} within 15 min: {proc_list}",
                    ip=dest, host=host, ts=now,
                )
                inc.add_alert(alert)

    # ── Rule 4 ────────────────────────────────────────────────────────
    # Process bandwidth ≥ R4_MULTIPLIER × rolling 1-hr average → MEDIUM.

    def _rule4(self, now: float, apps: list[dict]) -> None:
        for app in apps:
            name = app.get("name", "")
            if not name or name == "unknown":
                continue

            bw_now = app.get("sent", 0.0) + app.get("recv", 0.0)
            if bw_now < self.R4_MIN_BW:
                continue

            bdq = self._proc_bw.get(name)
            if not bdq or len(bdq) < self.R4_MIN_SAMPLES:
                continue

            samples = [v for _, v in bdq]
            # Use all but the current sample for the baseline average
            baseline = samples[:-1]
            avg = sum(baseline) / len(baseline)
            if avg == 0:
                continue

            ratio = bw_now / avg
            if ratio < self.R4_MULTIPLIER:
                continue

            # Cooldown check
            last_alert = self._r4_last_alert.get(name, 0.0)
            if now - last_alert < self.R4_COOLDOWN:
                continue
            self._r4_last_alert[name] = now

            key = name
            actions = [
                a.format(process=name, ratio=f"{ratio:.1f}")
                for a in _ACTIONS["R4"]
            ]
            inc = self._get_or_create(
                "R4", key,
                title=f"Bandwidth spike: {name} ({ratio:.1f}× average)",
                severity="MEDIUM",
                actions=actions,
            )
            inc.processes.add(name)
            alert = self._make_alert(
                "R4",
                f"{name} bandwidth {_fmt_bw(bw_now)} is {ratio:.1f}× above "
                f"1-hr average ({_fmt_bw(avg)})",
                process=name, ts=now,
            )
            inc.add_alert(alert)

    # ── Rule 5 ────────────────────────────────────────────────────────
    # New process (not previously seen) makes its first outbound
    # connection → LOW.

    def _rule5(
        self,
        now: float,
        new_app_names: set[str],
        connections: list[dict],
    ) -> None:
        for name in new_app_names:
            if name in self._known_procs or name in ("unknown", ""):
                continue
            proc_conns = [c for c in connections if c.get("app") == name]
            if not proc_conns:
                continue

            c = proc_conns[0]
            dest = c.get("remote", "")
            host = c.get("host") or dest
            port = c.get("port", 0)

            key = name
            actions = [
                a.format(process=name, destination=f"{host}:{port}")
                for a in _ACTIONS["R5"]
            ]
            inc = self._get_or_create(
                "R5", key,
                title=f"New process first outbound: {name}",
                severity="LOW",
                actions=actions,
            )
            if len(inc.alerts) == 0:
                inc.processes.add(name)
                if dest:
                    inc.ips.add(dest)
                alert = self._make_alert(
                    "R5",
                    f"New process {name} made its first outbound connection "
                    f"to {host}:{port}",
                    process=name, ip=dest, host=host, ts=now,
                )
                inc.add_alert(alert)

    # ── Serialisation ─────────────────────────────────────────────────

    def _serialize(self) -> list[dict]:
        """
        Return incidents sorted by:
          1. Active (OPEN / ACKNOWLEDGED) before RESOLVED
          2. Within active: highest severity first
          3. Resolved: most-recently-resolved first (capped at 10)
        """
        active = [
            i for i in self._incidents.values()
            if i.status != "RESOLVED"
        ]
        resolved = [
            i for i in self._incidents.values()
            if i.status == "RESOLVED"
        ]

        active.sort(key=lambda i: _SEV_RANK.get(i.severity, 0), reverse=True)
        resolved.sort(key=lambda i: i.updated_at, reverse=True)

        return [i.to_dict() for i in active + resolved[:10]]
