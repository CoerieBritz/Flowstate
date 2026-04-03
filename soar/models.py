"""
SOAR Data Models
================
Lightweight dataclasses shared by the threat intel engine and the backend.
No external dependencies — stdlib only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ThreatMatch:
    """
    A positive hit from a threat-intel feed lookup.

    Fields
    ------
    ip          : The queried IP address (or CIDR network string for range hits).
    feed_name   : Human-readable feed name, e.g. "Feodo Botnet C2".
    category    : Threat category — one of: botnet, malware, spam, compromised, phishing.
    severity    : "high" | "medium" | "low"
    description : Free-text description of the threat source.
    tags        : Optional list of extra tags (e.g. SBL reference numbers, threat types).
    """

    ip: str
    feed_name: str
    category: str
    severity: str
    description: str
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "ip": self.ip,
            "feed": self.feed_name,
            "category": self.category,
            "severity": self.severity,
            "description": self.description,
            "tags": self.tags,
        }


@dataclass
class FeedInfo:
    """
    Metadata about a loaded threat-intel feed.

    Populated after ThreatIntelEngine.load_all() runs.
    Sent to the dashboard inside the soar_stats payload so the UI
    can show which feeds are active and how fresh they are.
    """

    name: str
    filename: str
    url: str
    category: str
    severity: str
    description: str
    record_count: int = 0
    last_updated: Optional[str] = None   # e.g. "2025-03-15 04:12"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "filename": self.filename,
            "category": self.category,
            "severity": self.severity,
            "description": self.description,
            "record_count": self.record_count,
            "last_updated": self.last_updated,
        }
