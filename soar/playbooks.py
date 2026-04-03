"""
SOAR Phase 4 — Playbook Engine
================================
Loads YAML playbook definitions from ./playbooks/ and evaluates each
playbook's trigger against the current poll snapshot.  When a trigger
fires, a playbook-attributed incident is generated.

Trigger types
-------------
threat_flagged    — one or more connections matched a local threat feed
bandwidth_spike   — a correlator R4 incident is present (2× avg bandwidth)
new_process       — a correlator R5 incident is present (first outbound)
port_scan         — single remote IP appears on ≥5 distinct local ports

NEVER auto-executes: every playbook incident is a recommendation only.
All response actions still require explicit user confirmation.

YAML format (see ./playbooks/*.yml for examples)
-------------------------------------------------
name: my_playbook
display_name: Human-readable title
description: One-line description
enabled: true
trigger:
  type: threat_flagged       # | bandwidth_spike | new_process | port_scan
  min_severity: high         # optional – threat_flagged only
  min_port_count: 5          # optional – port_scan only
enrichment:
  virustotal: true
  abuseipdb: true
incident:
  severity: HIGH             # CRITICAL | HIGH | MEDIUM | LOW
  recommended_actions:
    - Action bullet 1
    - Action bullet 2
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Optional

# ── Minimal YAML parser (no PyYAML dependency) ────────────────────────

def _cast(v: str):
    v = v.strip()
    if not v:
        return None
    lv = v.lower()
    if lv in ("true", "yes"):   return True
    if lv in ("false", "no"):   return False
    if lv in ("null", "~"):     return None
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    # Strip surrounding quotes
    if len(v) >= 2 and v[0] in ('"', "'") and v[-1] == v[0]:
        return v[1:-1]
    return v


def _load_yaml(path: Path) -> dict:
    """
    Minimal YAML loader adequate for playbook files.
    Handles: scalars, two-level nested dicts, simple lists (- item).
    No anchors, aliases, multi-document, or flow style.
    """
    try:
        import yaml as _yaml
        with open(path, encoding="utf-8") as fh:
            return _yaml.safe_load(fh) or {}
    except ImportError:
        pass  # fall through to built-in parser
    except Exception as exc:
        print(f"[PB] PyYAML error loading {path.name}: {exc}")
        return {}

    # ── Built-in parser ─────────────────────────────────────────────
    with open(path, encoding="utf-8") as fh:
        raw_lines = fh.readlines()

    # Strip comments and trailing whitespace; build token list
    tokens: list[tuple[int, bool, Optional[str], str]] = []
    # (indent, is_list_item, key_or_None, value_str)
    for line in raw_lines:
        line = line.rstrip()
        s = line.lstrip()
        if not s or s.startswith("#"):
            continue
        indent = len(line) - len(s)
        if s.startswith("- "):
            tokens.append((indent, True, None, s[2:].strip()))
        elif ":" in s:
            key, _, val = s.partition(":")
            tokens.append((indent, False, key.strip(), val.strip()))

    root: dict = {}
    # Stack: list of (key_indent, container)
    # container is either dict or list
    stack: list[tuple[int, object]] = [(-1, root)]

    def parent():
        return stack[-1][1]

    for idx, (indent, is_list, key, val) in enumerate(tokens):
        # Pop stack until we find the right parent level
        while len(stack) > 1 and stack[-1][0] >= indent:
            stack.pop()

        p = parent()

        if is_list:
            if isinstance(p, list):
                p.append(_cast(val))
            continue

        # Determine value type by peeking at the next token
        if val:
            value = _cast(val)
        else:
            # Peek ahead
            next_is_list = False
            has_child = False
            for ni in range(idx + 1, len(tokens)):
                ni_indent, ni_is_list, _, _ = tokens[ni]
                if ni_indent > indent:
                    has_child   = True
                    next_is_list = ni_is_list
                    break
                break
            if has_child:
                value = [] if next_is_list else {}
            else:
                value = None

        if isinstance(p, dict) and key is not None:
            p[key] = value
        elif isinstance(p, list):
            p.append(value)

        if isinstance(value, (dict, list)):
            stack.append((indent, value))

    return root


# ── Playbook definition ───────────────────────────────────────────────

class Playbook:
    """A loaded and validated playbook definition."""

    def __init__(self, data: dict, path: Path) -> None:
        self.path         = path
        self.name         = data.get("name")         or path.stem
        self.display_name = data.get("display_name") or self.name
        self.description  = data.get("description")  or ""
        self.enabled      = bool(data.get("enabled", True))

        tr = data.get("trigger") or {}
        self.trigger_type     = tr.get("type", "")
        self.min_severity     = (tr.get("min_severity") or "").lower()
        self.min_port_count   = int(tr.get("min_port_count") or 5)

        en = data.get("enrichment") or {}
        self.enrich_vt   = bool(en.get("virustotal", False))
        self.enrich_ab   = bool(en.get("abuseipdb",  False))

        inc = data.get("incident") or {}
        self.severity    = (inc.get("severity") or "MEDIUM").upper()
        raw_actions      = inc.get("recommended_actions") or []
        self.recommended_actions: list[str] = [
            str(a) for a in raw_actions if a
        ]

        # Runtime stats — not persisted; reset on reload
        self.times_triggered:   int              = 0
        self.last_triggered_at: "float | None"   = None
        self.total_incidents:   int              = 0

    def to_dict(self) -> dict:
        return {
            "name":                self.name,
            "display_name":        self.display_name,
            "description":         self.description,
            "enabled":             self.enabled,
            "trigger_type":        self.trigger_type,
            "min_severity":        self.min_severity,
            "min_port_count":      self.min_port_count,
            "severity":            self.severity,
            "enrich_vt":           self.enrich_vt,
            "enrich_ab":           self.enrich_ab,
            "recommended_actions": self.recommended_actions,
            "filename":            self.path.name,
            "times_triggered":     self.times_triggered,
            "last_triggered_at":   self.last_triggered_at,
            "total_incidents":     self.total_incidents,
        }


# ── PlaybookEngine ────────────────────────────────────────────────────

class PlaybookEngine:
    """
    Evaluates loaded playbooks against each poll snapshot.

    Maintains its own incident dedup map so the same trigger does not
    generate duplicate incidents until the previous one is resolved.

    Thread safety: designed for single-threaded use from the main asyncio
    broadcast loop.
    """

    _PLAYBOOKS_DIR = Path(__file__).parent.parent / "playbooks"

    def __init__(self) -> None:
        self.playbooks: list[Playbook] = []
        # (playbook_name, key) → incident_id
        self._active_keys: dict[tuple[str, str], str] = {}
        # incident_id → incident dict
        self._incidents: dict[str, dict] = {}
        self._load_all()
        # Track seen port-scan triggers to avoid hammering
        self._port_scan_seen: dict[str, float] = {}  # remote_ip → last fired
        # Activity log — last 200 entries
        self._activity_log: list[dict] = []
        # Last snapshot for dry-run access
        self._last_snapshot: dict = {}

    def _load_all(self) -> None:
        """(Re)load all playbook YAML files from ./playbooks/."""
        self._PLAYBOOKS_DIR.mkdir(parents=True, exist_ok=True)
        self.playbooks.clear()
        for yml in sorted(self._PLAYBOOKS_DIR.glob("*.yml")):
            try:
                data = _load_yaml(yml)
                pb   = Playbook(data, yml)
                self.playbooks.append(pb)
                status = "enabled" if pb.enabled else "disabled"
                print(f"[PB] Loaded: {pb.display_name} ({pb.trigger_type}, {status})")
            except Exception as exc:
                print(f"[PB] Failed to load {yml.name}: {exc}")

        if not self.playbooks:
            print(f"[PB] No playbooks found in {self._PLAYBOOKS_DIR}")

    def reload(self) -> None:
        self._load_all()

    # ── Public API ────────────────────────────────────────────────────

    def run(
        self,
        connections: list[dict],
        apps: list[dict],
        threats: list[dict],
        correlator_incidents: list[dict],
    ) -> list[dict]:
        """
        Evaluate all enabled playbooks against the current snapshot.
        Returns the current list of playbook incidents (including unresolved
        ones from previous polls).
        """
        now = time.time()
        # Store snapshot for dry-run requests
        self._last_snapshot = {
            "connections":          connections,
            "apps":                 apps,
            "threats":              threats,
            "correlator_incidents": correlator_incidents,
        }

        for pb in self.playbooks:
            if not pb.enabled:
                continue
            try:
                self._check_playbook(pb, now, connections, apps, threats, correlator_incidents)
            except Exception as exc:
                print(f"[PB] Error in playbook '{pb.name}': {exc}")

        return self._serialize()

    def acknowledge(self, incident_id: str) -> bool:
        inc = self._incidents.get(incident_id)
        if inc and inc.get("status") == "OPEN":
            inc["status"] = "ACKNOWLEDGED"
            inc["updated_at"] = time.time()
            return True
        return False

    def resolve(self, incident_id: str) -> bool:
        inc = self._incidents.get(incident_id)
        if inc and inc.get("status") != "RESOLVED":
            inc["status"] = "RESOLVED"
            inc["updated_at"] = time.time()
            for k, v in list(self._active_keys.items()):
                if v == incident_id:
                    del self._active_keys[k]
            return True
        return False

    def get_playbooks_list(self) -> list[dict]:
        return [pb.to_dict() for pb in self.playbooks]

    def set_enabled(self, name: str, enabled: bool) -> bool:
        for pb in self.playbooks:
            if pb.name == name:
                pb.enabled = enabled
                return True
        return False

    def get_activity_log(self, limit: int = 50) -> list[dict]:
        return list(reversed(self._activity_log[-limit:]))

    def dry_run(self, name: "str | None" = None) -> list[dict]:
        """
        Check what playbooks would fire against the last snapshot.
        Returns match details without creating any incidents.
        """
        snap = self._last_snapshot
        if not snap:
            return []
        results = []
        for pb in self.playbooks:
            if name and pb.name != name:
                continue
            matches = self._dry_run_playbook(
                pb,
                snap.get("connections", []),
                snap.get("apps", []),
                snap.get("threats", []),
                snap.get("correlator_incidents", []),
            )
            results.append({
                "playbook_name":    pb.name,
                "playbook_display": pb.display_name,
                "would_fire":       len(matches) > 0,
                "matches":          matches,
            })
        return results

    def _dry_run_playbook(
        self,
        pb: Playbook,
        connections: list[dict],
        apps: list[dict],
        threats: list[dict],
        correlator_incidents: list[dict],
    ) -> list[dict]:
        matches: list[dict] = []
        t = pb.trigger_type

        if t == "threat_flagged":
            threat_by_ip = {th.get("ip", ""): th for th in threats if th.get("ip")}
            sev_rank = {"low": 0, "medium": 1, "high": 2}
            min_rank = sev_rank.get(pb.min_severity, 0)
            for conn in connections:
                ip = conn.get("remote", "")
                threat = threat_by_ip.get(ip)
                if not threat:
                    continue
                conn_sev_rank = sev_rank.get(
                    (threat.get("severity") or "high").lower(), 2
                )
                if conn_sev_rank < min_rank:
                    continue
                matches.append({
                    "ip":     ip,
                    "app":    conn.get("app", ""),
                    "host":   conn.get("host", ip),
                    "reason": (
                        f"Threat feed: {threat.get('feed', 'unknown')} "
                        f"({threat.get('severity', '')} / "
                        f"{threat.get('category', '')})"
                    ),
                })

        elif t == "bandwidth_spike":
            for ci in correlator_incidents:
                if ci.get("rule") == "R4" and ci.get("status") != "RESOLVED":
                    proc_list = ci.get("processes", [])
                    matches.append({
                        "ip":     "",
                        "app":    proc_list[0] if proc_list else "",
                        "host":   "",
                        "reason": "Bandwidth spike (correlator R4 — 2× rolling average)",
                    })

        elif t == "new_process":
            for ci in correlator_incidents:
                if ci.get("rule") == "R5" and ci.get("status") != "RESOLVED":
                    proc_list = ci.get("processes", [])
                    matches.append({
                        "ip":     "",
                        "app":    proc_list[0] if proc_list else "",
                        "host":   "",
                        "reason": "New process first outbound (correlator R5)",
                    })

        elif t == "port_scan":
            remote_local_ports: dict[str, set] = defaultdict(set)
            for conn in connections:
                rip   = conn.get("remote", "")
                lport = conn.get("local_port", 0)
                if rip and lport:
                    remote_local_ports[rip].add(lport)
            for rip, ports in remote_local_ports.items():
                if len(ports) >= pb.min_port_count:
                    matches.append({
                        "ip":     rip,
                        "app":    "",
                        "host":   rip,
                        "reason": f"Port scan: {len(ports)} local ports probed",
                    })

        return matches

    def save_playbook_yaml(self, yaml_content: str, filename: str) -> dict:
        """Write YAML to the playbooks/ dir, then reload all playbooks."""
        import re as _re
        if not _re.match(r'^[a-zA-Z0-9_\-]+\.yml$', filename):
            return {"success": False, "error": "Invalid filename — use letters, numbers, underscores, hyphens only"}
        path = self._PLAYBOOKS_DIR / filename
        try:
            path.write_text(yaml_content, encoding="utf-8")
            self._load_all()
            return {"success": True, "details": f"Playbook '{filename}' saved and reloaded"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def delete_playbook(self, name: str) -> dict:
        """Delete the YAML file for a playbook by name, then reload."""
        for pb in self.playbooks:
            if pb.name == name:
                try:
                    pb.path.unlink()
                    self._load_all()
                    return {"success": True, "details": f"Playbook '{name}' deleted"}
                except Exception as exc:
                    return {"success": False, "error": str(exc)}
        return {"success": False, "error": f"Playbook '{name}' not found"}

    # ── Internal trigger evaluators ───────────────────────────────────

    def _check_playbook(
        self,
        pb: Playbook,
        now: float,
        connections: list[dict],
        apps: list[dict],
        threats: list[dict],
        correlator_incidents: list[dict],
    ) -> None:
        t = pb.trigger_type

        if t == "threat_flagged":
            self._trigger_threat_flagged(pb, now, connections, threats)
        elif t == "bandwidth_spike":
            self._trigger_bandwidth_spike(pb, now, correlator_incidents)
        elif t == "new_process":
            self._trigger_new_process(pb, now, correlator_incidents, connections)
        elif t == "port_scan":
            self._trigger_port_scan(pb, now, connections)

    # threat_flagged ──────────────────────────────────────────────────

    def _trigger_threat_flagged(
        self,
        pb: Playbook,
        now: float,
        connections: list[dict],
        threats: list[dict],
    ) -> None:
        # Build map: threat ip → threat dict
        threat_by_ip: dict[str, dict] = {
            t.get("ip", ""): t for t in threats if t.get("ip")
        }
        if not threat_by_ip:
            return

        sev_rank = {"low": 0, "medium": 1, "high": 2}
        min_rank = sev_rank.get(pb.min_severity, 0)

        for conn in connections:
            ip = conn.get("remote", "")
            threat = threat_by_ip.get(ip)
            if not threat:
                continue
            conn_sev_rank = sev_rank.get(
                (threat.get("severity") or "high").lower(), 2
            )
            if conn_sev_rank < min_rank:
                continue

            key  = f"{ip}|{conn.get('app', '')}"
            inc  = self._get_or_create(pb, key, now)
            if len(inc["alerts"]) == 0:
                inc["alerts"].append({
                    "time":    time.strftime("%H:%M:%S", time.localtime(now)),
                    "rule":    pb.name,
                    "message": (
                        f"Playbook '{pb.display_name}' triggered: "
                        f"{conn.get('app','?')} → {conn.get('host', ip)} "
                        f"[{threat.get('feed','unknown feed')}] "
                        f"({threat.get('category','')} / {threat.get('severity','')})"
                    ),
                    "process": conn.get("app", ""),
                    "ip":      ip,
                })
            inc["ips"].add(ip)
            if conn.get("app"):
                inc["processes"].add(conn["app"])
            # Attach enrichment request hint for the dashboard
            if pb.enrich_vt or pb.enrich_ab:
                inc.setdefault("pending_enrichment", set()).add(ip)
            # Attach feed context
            inc.setdefault("trigger_context", {})
            inc["trigger_context"]["threat"] = threat

    # bandwidth_spike ─────────────────────────────────────────────────

    def _trigger_bandwidth_spike(
        self,
        pb: Playbook,
        now: float,
        correlator_incidents: list[dict],
    ) -> None:
        for ci in correlator_incidents:
            if ci.get("rule") != "R4":
                continue
            if ci.get("status") == "RESOLVED":
                continue
            proc_list = ci.get("processes", [])
            key = "bw|" + "|".join(sorted(proc_list))
            inc = self._get_or_create(pb, key, now)
            if len(inc["alerts"]) == 0:
                alert_text = (ci.get("alerts") or [{}])[-1].get("message", "bandwidth spike")
                inc["alerts"].append({
                    "time":    time.strftime("%H:%M:%S", time.localtime(now)),
                    "rule":    pb.name,
                    "message": f"Playbook '{pb.display_name}' triggered: {alert_text}",
                    "process": proc_list[0] if proc_list else "",
                    "ip":      "",
                })
            for p in proc_list:
                inc["processes"].add(p)
            for ip in ci.get("ips", []):
                inc["ips"].add(ip)
                if pb.enrich_vt or pb.enrich_ab:
                    inc.setdefault("pending_enrichment", set()).add(ip)

    # new_process ─────────────────────────────────────────────────────

    def _trigger_new_process(
        self,
        pb: Playbook,
        now: float,
        correlator_incidents: list[dict],
        connections: list[dict],
    ) -> None:
        for ci in correlator_incidents:
            if ci.get("rule") != "R5":
                continue
            if ci.get("status") == "RESOLVED":
                continue
            proc_list = ci.get("processes", [])
            key = "proc|" + "|".join(sorted(proc_list))
            inc = self._get_or_create(pb, key, now)
            if len(inc["alerts"]) == 0:
                alert_text = (ci.get("alerts") or [{}])[-1].get("message", "new process")
                inc["alerts"].append({
                    "time":    time.strftime("%H:%M:%S", time.localtime(now)),
                    "rule":    pb.name,
                    "message": f"Playbook '{pb.display_name}' triggered: {alert_text}",
                    "process": proc_list[0] if proc_list else "",
                    "ip":      "",
                })
            for p in proc_list:
                inc["processes"].add(p)
            for ip in ci.get("ips", []):
                inc["ips"].add(ip)
                if pb.enrich_vt or pb.enrich_ab:
                    inc.setdefault("pending_enrichment", set()).add(ip)

    # port_scan ───────────────────────────────────────────────────────

    def _trigger_port_scan(
        self,
        pb: Playbook,
        now: float,
        connections: list[dict],
    ) -> None:
        # Detect when a single remote IP is seen on many of our local ports
        # (inbound port scan) — or connecting to many remote ports (outbound probe).
        # We check INBOUND: same remote IP → distinct local_port values
        remote_local_ports: dict[str, set[int]] = defaultdict(set)
        for conn in connections:
            rip   = conn.get("remote", "")
            lport = conn.get("local_port", 0)
            if rip and lport:
                remote_local_ports[rip].add(lport)

        for rip, ports in remote_local_ports.items():
            if len(ports) < pb.min_port_count:
                continue
            # Cooldown: don't re-fire for same IP within 5 minutes
            last = self._port_scan_seen.get(rip, 0)
            if now - last < 300:
                continue
            self._port_scan_seen[rip] = now

            key = f"scan|{rip}"
            inc = self._get_or_create(pb, key, now)
            if len(inc["alerts"]) == 0:
                inc["alerts"].append({
                    "time":    time.strftime("%H:%M:%S", time.localtime(now)),
                    "rule":    pb.name,
                    "message": (
                        f"Playbook '{pb.display_name}' triggered: "
                        f"{rip} active on {len(ports)} local ports "
                        f"({', '.join(str(p) for p in sorted(ports)[:5])}…)"
                    ),
                    "process": "",
                    "ip":      rip,
                })
            inc["ips"].add(rip)
            if pb.enrich_vt or pb.enrich_ab:
                inc.setdefault("pending_enrichment", set()).add(rip)

    # ── Incident lifecycle helpers ────────────────────────────────────

    def _get_or_create(
        self,
        pb: Playbook,
        key: str,
        now: float,
    ) -> dict:
        """Return the live incident for (playbook, key), creating it if needed."""
        ikey = (pb.name, key)
        # Update stats every time the trigger fires
        pb.times_triggered    += 1
        pb.last_triggered_at   = now

        if ikey in self._active_keys:
            inc = self._incidents.get(self._active_keys[ikey])
            if inc and inc.get("status") != "RESOLVED":
                inc["updated_at"] = now
                self._log_activity(pb, key, now, "dedup_existing", inc["id"])
                return inc

        inc_id = str(uuid.uuid4())[:8]
        inc: dict = {
            "id":                  inc_id,
            "title":               f"[{pb.display_name}] {_title_from_key(key)}",
            "severity":            pb.severity,
            "rule":                pb.name,
            "source":              "playbook",
            "playbook_name":       pb.name,
            "playbook_display":    pb.display_name,
            "status":              "OPEN",
            "alerts":              [],
            "recommended_actions": list(pb.recommended_actions),
            "created_at":          now,
            "updated_at":          now,
            "processes":           set(),
            "ips":                 set(),
        }
        self._incidents[inc_id]  = inc
        self._active_keys[ikey]  = inc_id
        pb.total_incidents       += 1
        self._log_activity(pb, key, now, "new_incident", inc_id)
        return inc

    def _log_activity(
        self,
        pb: Playbook,
        key: str,
        now: float,
        result: str,
        incident_id: str,
    ) -> None:
        entry = {
            "timestamp":       now,
            "time_str":        time.strftime("%H:%M:%S", time.localtime(now)),
            "playbook_name":   pb.name,
            "playbook_display": pb.display_name,
            "trigger_event":   _title_from_key(key),
            "severity":        pb.severity,
            "result":          result,       # "new_incident" | "dedup_existing"
            "incident_id":     incident_id,
        }
        self._activity_log.append(entry)
        if len(self._activity_log) > 200:
            self._activity_log = self._activity_log[-200:]

    # ── Serialisation ─────────────────────────────────────────────────

    def _serialize(self) -> list[dict]:
        """Return sorted incident dicts with sets converted to sorted lists."""
        _SEV = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
        active   = [i for i in self._incidents.values() if i["status"] != "RESOLVED"]
        resolved = [i for i in self._incidents.values() if i["status"] == "RESOLVED"]

        active.sort(key=lambda i: _SEV.get(i["severity"], 0), reverse=True)
        resolved.sort(key=lambda i: i["updated_at"], reverse=True)

        result = []
        for inc in active + resolved[:10]:
            d = dict(inc)
            d["processes"]          = sorted(inc.get("processes", set()))
            d["ips"]                = sorted(inc.get("ips", set()))
            d["alert_count"]        = len(inc.get("alerts", []))
            d.pop("pending_enrichment", None)
            d.pop("trigger_context", None)
            result.append(d)

        return result


def _title_from_key(key: str) -> str:
    """Make a short human title from a dedup key like 'bw|chrome.exe'."""
    parts = key.split("|", 1)
    if len(parts) < 2:
        return key
    _type, rest = parts[0], parts[1]
    mapping = {
        "bw":   f"Bandwidth spike — {rest}",
        "proc": f"New process — {rest}",
        "scan": f"Port scan from {rest}",
    }
    return mapping.get(_type, rest or _type)
