"""
SOAR Response Engine — Phase 3
================================
Executes one-click response actions from the dashboard.

Safety contract
---------------
• EVERY action requires ``confirm=True`` in the command dict.
  If absent or False the action is rejected immediately with no side effects.
• Every executed action is appended to ``./data/audit.log`` (JSONL).
• Reversible actions (block/unblock IP, blocklist add/remove) push an entry
  onto the undo stack so the user can roll back from the dashboard.
• Non-reversible actions (kill process, snapshot) are logged but have no undo.

Windows-native commands
-----------------------
Block IP    : netsh advfirewall firewall add rule …   (two rules: IN + OUT)
Unblock IP  : netsh advfirewall firewall delete rule …
Kill process: taskkill /PID {pid} /F

ALERT-ONLY-by-default: nothing runs without explicit confirm=True from the UI.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

# ── Platform helpers ──────────────────────────────────────────────────
_WIN32 = sys.platform == "win32"
_POPEN_FLAGS: dict = ({"creationflags": 0x08000000} if _WIN32 else {})

# ── Data paths ────────────────────────────────────────────────────────
_DATA_DIR       = Path(__file__).parent.parent / "data"
_BLOCKLIST_PATH = _DATA_DIR / "blocklist.txt"
_AUDIT_LOG_PATH = _DATA_DIR / "audit.log"
_SNAPSHOTS_DIR  = _DATA_DIR / "snapshots"

# ── Action names handled by ResponseEngine ────────────────────────────
RESPONSE_ACTIONS = frozenset({
    "block_ip", "unblock_ip",
    "kill_process",
    "add_blocklist", "remove_blocklist",
    "capture_snapshot",
    "undo_action",
})


# ══════════════════════════════════════════════════════════════════════
# UndoEntry
# ══════════════════════════════════════════════════════════════════════

@dataclass
class UndoEntry:
    id: str
    description: str
    undo_action: str
    undo_params: dict
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "id":          self.id,
            "description": self.description,
            "undo_action": self.undo_action,
            "timestamp":   self.timestamp,
        }


# ══════════════════════════════════════════════════════════════════════
# ResponseEngine
# ══════════════════════════════════════════════════════════════════════

class ResponseEngine:
    """
    Executes response actions, maintains an undo stack, and logs everything.

    Thread safety: designed for single-threaded asyncio use.
    All blocking operations (subprocess) must be awaited via
    ``asyncio.to_thread(engine.execute, cmd)`` from the WS handler.
    """

    MAX_AUDIT  = 200    # entries kept in memory
    MAX_UNDO   = 50     # undo stack depth

    def __init__(self) -> None:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)

        self._audit_log: list[dict] = []        # newest first
        self._undo_stack: list[UndoEntry] = []  # newest first
        self._blocked_ips: set[str] = set()     # IPs blocked this session
        self._blocklist: list[str] = []         # persistent blocklist.txt

        self._load_blocklist()
        self._load_audit_log()
        print(f"[RESP] ResponseEngine ready — {len(self._blocklist)} blocklist entries")

    # ── Public entry point ────────────────────────────────────────────

    def execute(self, cmd: dict) -> dict:
        """
        Dispatch a command dict to the appropriate action handler.

        The command MUST contain ``"confirm": true`` — otherwise it is
        rejected with ``{"success": False, "requires_confirm": True}``.
        """
        if not cmd.get("confirm"):
            return {
                "type":             "action_result",
                "success":          False,
                "requires_confirm": True,
                "error":            "Action requires confirm: true",
            }

        action = cmd.get("action", "")
        dispatch = {
            "block_ip":         lambda: self._block_ip(cmd.get("ip", "")),
            "unblock_ip":       lambda: self._unblock_ip(cmd.get("ip", "")),
            "kill_process":     lambda: self._kill_process(
                                    int(cmd.get("pid", 0)),
                                    str(cmd.get("name", "unknown"))),
            "add_blocklist":    lambda: self._add_blocklist(cmd.get("ip", "")),
            "remove_blocklist": lambda: self._remove_blocklist(cmd.get("ip", "")),
            "capture_snapshot": lambda: self._capture_snapshot(),
            "undo_action":      lambda: self._undo(cmd.get("undo_id", "")),
        }
        handler = dispatch.get(action)
        if handler is None:
            return {"type": "action_result", "success": False,
                    "error": f"Unknown action: {action}"}

        result = handler()
        result["type"] = "action_result"
        return result

    # ── Action: block IP ─────────────────────────────────────────────

    def _block_ip(self, ip: str) -> dict:
        if not ip:
            return {"success": False, "action": "block_ip",
                    "error": "No IP address provided"}

        errors: list[str] = []
        for direction in ("out", "in"):
            rule_name = f"Netwatch Block {direction.upper()} {ip}"
            try:
                r = subprocess.run(
                    ["netsh", "advfirewall", "firewall", "add", "rule",
                     f"name={rule_name}",
                     f"dir={direction}",
                     "action=block",
                     f"remoteip={ip}",
                     "enable=yes",
                     "profile=any"],
                    capture_output=True, text=True, timeout=15, **_POPEN_FLAGS,
                )
                if r.returncode != 0:
                    errors.append(
                        f"{direction.upper()}: "
                        + (r.stderr.strip() or r.stdout.strip() or "unknown error")
                    )
            except Exception as exc:
                errors.append(f"{direction.upper()}: {exc}")

        success = len(errors) == 0
        details = (
            "Firewall rules added (inbound + outbound)"
            if success else
            "Partial failure — " + "; ".join(errors)
        )

        undo_id: Optional[str] = None
        if success:
            self._blocked_ips.add(ip)
            e = UndoEntry(
                id=str(uuid.uuid4())[:8],
                description=f"Unblock IP {ip}",
                undo_action="unblock_ip",
                undo_params={"ip": ip},
            )
            self._push_undo(e)
            undo_id = e.id

        self._log("block_ip", ip, success, details, reversible=True, undo_id=undo_id)
        return {
            "success": success, "action": "block_ip", "target": ip,
            "details": details, "reversible": True, "undo_id": undo_id,
            "error": None if success else "; ".join(errors),
        }

    # ── Action: unblock IP ────────────────────────────────────────────

    def _unblock_ip(self, ip: str) -> dict:
        if not ip:
            return {"success": False, "action": "unblock_ip",
                    "error": "No IP address provided"}

        errors: list[str] = []
        for direction in ("OUT", "IN"):
            rule_name = f"Netwatch Block {direction} {ip}"
            try:
                r = subprocess.run(
                    ["netsh", "advfirewall", "firewall", "delete", "rule",
                     f"name={rule_name}"],
                    capture_output=True, text=True, timeout=15, **_POPEN_FLAGS,
                )
                # netsh may return 0 even when no rule matched; check stdout
                out = r.stdout.strip()
                if r.returncode != 0 and "No rules match" not in out:
                    errors.append(f"{direction}: {r.stderr.strip() or out or 'error'}")
            except Exception as exc:
                errors.append(f"{direction}: {exc}")

        success = len(errors) == 0
        details = (
            "Firewall rules removed (inbound + outbound)"
            if success else
            "Partial failure — " + "; ".join(errors)
        )
        self._blocked_ips.discard(ip)

        undo_id: Optional[str] = None
        if success:
            e = UndoEntry(
                id=str(uuid.uuid4())[:8],
                description=f"Re-block IP {ip}",
                undo_action="block_ip",
                undo_params={"ip": ip},
            )
            self._push_undo(e)
            undo_id = e.id

        self._log("unblock_ip", ip, success, details, reversible=True, undo_id=undo_id)
        return {
            "success": success, "action": "unblock_ip", "target": ip,
            "details": details, "reversible": True, "undo_id": undo_id,
            "error": None if success else "; ".join(errors),
        }

    # ── Action: kill process ──────────────────────────────────────────

    def _kill_process(self, pid: int, name: str) -> dict:
        if not pid:
            return {"success": False, "action": "kill_process",
                    "error": "No PID provided"}

        try:
            r = subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"],
                capture_output=True, text=True, timeout=10, **_POPEN_FLAGS,
            )
            success = r.returncode == 0
            details = (
                f"Process {name} (PID {pid}) terminated"
                if success else
                f"taskkill failed: {r.stderr.strip() or r.stdout.strip() or 'unknown error'}"
            )
        except Exception as exc:
            success = False
            details = f"Exception: {exc}"

        target = f"{name} (PID {pid})"
        self._log("kill_process", target, success, details, reversible=False)
        return {
            "success": success, "action": "kill_process", "target": target,
            "details": details, "reversible": False, "undo_id": None,
            "error": None if success else details,
        }

    # ── Action: add to blocklist ──────────────────────────────────────

    def _add_blocklist(self, ip: str) -> dict:
        if not ip:
            return {"success": False, "action": "add_blocklist",
                    "error": "No IP provided"}

        if ip in self._blocklist:
            details = f"{ip} already in blocklist"
            self._log("add_blocklist", ip, True, details, reversible=True)
            return {"success": True, "action": "add_blocklist", "target": ip,
                    "details": details, "reversible": True, "undo_id": None}

        self._blocklist.append(ip)
        self._save_blocklist()

        e = UndoEntry(
            id=str(uuid.uuid4())[:8],
            description=f"Remove {ip} from blocklist",
            undo_action="remove_blocklist",
            undo_params={"ip": ip},
        )
        self._push_undo(e)
        details = f"{ip} added to blocklist.txt"
        self._log("add_blocklist", ip, True, details, reversible=True, undo_id=e.id)
        return {"success": True, "action": "add_blocklist", "target": ip,
                "details": details, "reversible": True, "undo_id": e.id}

    # ── Action: remove from blocklist ─────────────────────────────────

    def _remove_blocklist(self, ip: str) -> dict:
        if not ip:
            return {"success": False, "action": "remove_blocklist",
                    "error": "No IP provided"}

        if ip not in self._blocklist:
            return {"success": False, "action": "remove_blocklist", "target": ip,
                    "error": f"{ip} not found in blocklist"}

        self._blocklist.remove(ip)
        self._save_blocklist()

        e = UndoEntry(
            id=str(uuid.uuid4())[:8],
            description=f"Re-add {ip} to blocklist",
            undo_action="add_blocklist",
            undo_params={"ip": ip},
        )
        self._push_undo(e)
        details = f"{ip} removed from blocklist.txt"
        self._log("remove_blocklist", ip, True, details, reversible=True, undo_id=e.id)
        return {"success": True, "action": "remove_blocklist", "target": ip,
                "details": details, "reversible": True, "undo_id": e.id}

    # ── Action: capture snapshot ──────────────────────────────────────

    def _capture_snapshot(self) -> dict:
        try:
            import psutil
        except ImportError:
            return {"success": False, "action": "capture_snapshot",
                    "error": "psutil not available"}

        # Gather process list
        procs: list[dict] = []
        for p in psutil.process_iter(["pid", "name", "status"]):
            try:
                procs.append({"pid": p.pid, "name": p.name(), "status": p.status()})
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        # Gather active connections
        conns: list[dict] = []
        try:
            for c in psutil.net_connections(kind="inet"):
                if c.raddr:
                    conns.append({
                        "pid":    c.pid,
                        "laddr":  f"{c.laddr.ip}:{c.laddr.port}" if c.laddr else "",
                        "raddr":  f"{c.raddr.ip}:{c.raddr.port}",
                        "status": c.status,
                    })
        except (psutil.AccessDenied, PermissionError):
            pass

        ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        snapshot = {
            "timestamp":        datetime.now().isoformat(),
            "process_count":    len(procs),
            "connection_count": len(conns),
            "processes":        procs,
            "connections":      conns,
        }

        filename = f"snapshot_{ts_str}.json"
        path = _SNAPSHOTS_DIR / filename
        try:
            _SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(snapshot, fh, indent=2)
            details = (
                f"Saved {filename} — "
                f"{len(procs)} processes, {len(conns)} connections"
            )
            success = True
        except Exception as exc:
            details = f"Write failed: {exc}"
            success = False

        self._log("capture_snapshot", filename, success, details, reversible=False)
        return {
            "success": success, "action": "capture_snapshot",
            "target": filename if success else "",
            "details": details, "reversible": False, "undo_id": None,
            "error": None if success else details,
        }

    # ── Action: undo ─────────────────────────────────────────────────

    def _undo(self, undo_id: str) -> dict:
        entry = next((e for e in self._undo_stack if e.id == undo_id), None)
        if entry is None:
            return {"success": False, "action": "undo_action",
                    "error": f"Undo entry '{undo_id}' not found (already used or expired)"}

        # Remove from stack first to prevent infinite undo loops
        self._undo_stack = [e for e in self._undo_stack if e.id != undo_id]

        undo_cmd = {"action": entry.undo_action, "confirm": True, **entry.undo_params}
        result = self.execute(undo_cmd)
        if result.get("success"):
            result["details"] = f"Undone: {entry.description}"
        return result

    # ── Persistence ───────────────────────────────────────────────────

    def _load_blocklist(self) -> None:
        if not _BLOCKLIST_PATH.exists():
            return
        with open(_BLOCKLIST_PATH, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    self._blocklist.append(line)

    def _save_blocklist(self) -> None:
        _BLOCKLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_BLOCKLIST_PATH, "w", encoding="utf-8") as fh:
            fh.write("# Netwatch Persistent Blocklist\n")
            for ip in self._blocklist:
                fh.write(f"{ip}\n")

    def _load_audit_log(self) -> None:
        if not _AUDIT_LOG_PATH.exists():
            return
        entries: list[dict] = []
        with open(_AUDIT_LOG_PATH, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        # Keep last MAX_AUDIT entries, store newest-first
        self._audit_log = list(reversed(entries[-self.MAX_AUDIT:]))

    def _log(
        self,
        action: str,
        target: str,
        success: bool,
        details: str,
        reversible: bool,
        undo_id: Optional[str] = None,
    ) -> None:
        entry: dict = {
            "timestamp":  datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "action":     action,
            "target":     target,
            "result":     "success" if success else "failure",
            "details":    details,
            "reversible": reversible,
            "undo_id":    undo_id,
        }
        self._audit_log.insert(0, entry)
        if len(self._audit_log) > self.MAX_AUDIT:
            self._audit_log = self._audit_log[: self.MAX_AUDIT]

        _AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_AUDIT_LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

        icon = "✓" if success else "✗"
        print(f"[RESP] {icon} {action} → {target}: {details}")

    # ── Undo-stack helpers ────────────────────────────────────────────

    def _push_undo(self, entry: UndoEntry) -> None:
        self._undo_stack.insert(0, entry)
        if len(self._undo_stack) > self.MAX_UNDO:
            self._undo_stack = self._undo_stack[: self.MAX_UNDO]

    # ── Poll-payload getters ──────────────────────────────────────────

    def get_audit_log(self) -> list[dict]:
        """Return the 50 most-recent audit entries (newest first)."""
        return self._audit_log[:50]

    def get_blocklist(self) -> list[str]:
        return list(self._blocklist)

    def get_blocked_ips(self) -> list[str]:
        """Session-level IPs currently blocked via netsh."""
        return sorted(self._blocked_ips)

    def get_undo_stack(self) -> list[dict]:
        return [e.to_dict() for e in self._undo_stack]
