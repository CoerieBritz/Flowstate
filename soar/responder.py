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

import ipaddress
import json
import os
import re
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

# ── Action names handled by ResponseEngine ────────────────────────────
RESPONSE_ACTIONS = frozenset({
    "block_ip", "unblock_ip",
    "kill_process",
    "add_blocklist", "remove_blocklist",
    "capture_snapshot",
    "undo_action",
})


# ── Critical process names ────────────────────────────────────────────
_CRITICAL_PNAMES = frozenset({
    "csrss.exe", "lsass.exe", "wininit.exe", "winlogon.exe",
    "services.exe", "smss.exe", "svchost.exe", "system", "registry",
    "lsaiso.exe", "dwm.exe", "fontdrvhost.exe", "secure system", "memory compression",
})

# ── IP validation helpers ─────────────────────────────────────────────

def _get_local_gateway() -> str:
    """Return the default gateway IP (Windows only), or '' if unavailable."""
    if not _WIN32:
        return ""
    try:
        r = subprocess.run(
            ["route", "print", "0.0.0.0"],
            capture_output=True, text=True, timeout=5, **_POPEN_FLAGS,
        )
        for line in r.stdout.splitlines():
            parts = line.split()
            if (len(parts) >= 3 and parts[0] == "0.0.0.0"
                    and parts[1] == "0.0.0.0"
                    and re.match(r"^\d+\.\d+\.\d+\.\d+$", parts[2])
                    and parts[2] != "On-link"):
                return parts[2]
    except Exception:
        pass
    return ""


def _validate_ip(ip: str) -> "str | None":
    """
    Validate that *ip* is a safe, routable public IP address.
    Returns None if valid, or a human-readable error string if rejected.
    """
    if not ip:
        return "No IP address provided"
    if "/" in ip or " " in ip:
        return f"'{ip}' is not a single IP address (CIDR ranges are not accepted)"
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return f"'{ip}' is not a valid IP address"
    if addr.is_loopback:
        return f"{ip} is a loopback address and cannot be targeted"
    if addr.is_private:
        return f"{ip} is a private address and cannot be targeted"
    if addr.is_link_local:
        return f"{ip} is a link-local address and cannot be targeted"
    if addr.is_multicast:
        return f"{ip} is a multicast address and cannot be targeted"
    if addr.is_unspecified:
        return f"{ip} is an unspecified address (0.0.0.0) and cannot be targeted"
    if not addr.is_global:  # catches remaining reserved/shared ranges, e.g. 100.64.0.0/10 CGNAT
        return f"{ip} is not a public internet address and cannot be targeted"
    gateway = _get_local_gateway()
    if gateway and ip == gateway:
        return f"{ip} is the local gateway and cannot be targeted"
    return None     # Valid


def _validate_removal_target(ip: str) -> "str | None":
    """
    Looser check for unblock / remove-from-blocklist.

    Removing a block can never make the machine less reachable, so entries
    that _validate_ip would now refuse (private IPs, CIDR ranges created by
    older versions) must still be removable.  Only require that the value is
    a syntactically valid IP address or network, with no stray whitespace.
    """
    if not ip:
        return "No IP address provided"
    try:
        ipaddress.ip_network(ip, strict=False)
    except ValueError:
        return f"'{ip}' is not a valid IP address or network"
    return None


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

    def __init__(self, data_dir: Path) -> None:
        self._data_dir       = data_dir
        self._blocklist_path = data_dir / "blocklist.txt"
        self._audit_log_path = data_dir / "audit.log"
        self._snapshots_dir  = data_dir / "snapshots"
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._snapshots_dir.mkdir(parents=True, exist_ok=True)

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
        err = _validate_ip(ip)
        if err:
            return {"success": False, "action": "block_ip", "error": err}

        errors: list[str] = []
        for direction in ("out", "in"):
            rule_name = f"FlowState Block {direction.upper()} {ip}"
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
        err = _validate_removal_target(ip)
        if err:
            return {"success": False, "action": "unblock_ip", "error": err}

        errors: list[str] = []
        # Try both current "FlowState Block" and legacy "Netwatch Block" rule names
        for direction in ("OUT", "IN"):
            for prefix in ("FlowState Block", "Netwatch Block"):
                rule_name = f"{prefix} {direction} {ip}"
                try:
                    r = subprocess.run(
                        ["netsh", "advfirewall", "firewall", "delete", "rule",
                         f"name={rule_name}"],
                        capture_output=True, text=True, timeout=15, **_POPEN_FLAGS,
                    )
                    # netsh may return 0 even when no rule matched; check stdout
                    out = r.stdout.strip()
                    if r.returncode != 0 and "No rules match" not in out:
                        errors.append(
                            f"{direction}/{prefix}: {r.stderr.strip() or out or 'error'}"
                        )
                except Exception as exc:
                    errors.append(f"{direction}/{prefix}: {exc}")

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

        # Guard: reject protected PIDs
        if pid in (0, 4):
            return {"success": False, "action": "kill_process",
                    "error": f"PID {pid} is a protected system process and cannot be terminated"}

        # Guard: reject the backend's own PID
        if pid in (os.getpid(), os.getppid()):  # self + PyInstaller onefile bootloader
            return {"success": False, "action": "kill_process",
                    "error": "Refusing to terminate the backend's own process"}

        # Guard: reject known critical process names (sent by client)
        if name.lower() in _CRITICAL_PNAMES:
            return {"success": False, "action": "kill_process",
                    "error": f"'{name}' is a critical system process and cannot be terminated"}

        # Verify the actual process name via psutil to guard against PID reuse
        try:
            import psutil as _psutil
            actual_name = _psutil.Process(pid).name()
        except Exception as exc:
            return {"success": False, "action": "kill_process",
                    "error": f"Cannot verify process for PID {pid}: {exc}"}

        if actual_name.lower() != name.lower():
            return {"success": False, "action": "kill_process",
                    "error": (
                        f"PID {pid} belongs to '{actual_name}', not '{name}' — "
                        "refusing to kill (possible PID reuse)"
                    )}

        # Guard: reject critical actual name even if the client lied
        if actual_name.lower() in _CRITICAL_PNAMES:
            return {"success": False, "action": "kill_process",
                    "error": f"'{actual_name}' is a critical system process and cannot be terminated"}

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
        err = _validate_ip(ip)
        if err:
            return {"success": False, "action": "add_blocklist", "error": err}

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
        # Anything already in the list may be removed, even entries the
        # current validator would refuse to add (legacy private/CIDR entries).
        if ip not in self._blocklist:
            err = _validate_removal_target(ip)
            if err:
                return {"success": False, "action": "remove_blocklist", "error": err}
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
        path = self._snapshots_dir / filename
        try:
            self._snapshots_dir.mkdir(parents=True, exist_ok=True)
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
        if not self._blocklist_path.exists():
            return
        with open(self._blocklist_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    self._blocklist.append(line)

    def _save_blocklist(self) -> None:
        self._blocklist_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._blocklist_path, "w", encoding="utf-8") as fh:
            fh.write("# Netwatch Persistent Blocklist\n")
            for ip in self._blocklist:
                fh.write(f"{ip}\n")

    def _load_audit_log(self) -> None:
        if not self._audit_log_path.exists():
            return
        entries: list[dict] = []
        with open(self._audit_log_path, encoding="utf-8") as fh:
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

        self._audit_log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._audit_log_path, "a", encoding="utf-8") as fh:
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
