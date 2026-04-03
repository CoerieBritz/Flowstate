"""
NETWATCH SOAR — Security Orchestration, Automation & Response
=============================================================
Phase 1: Threat Intelligence Engine

Operates exclusively in ALERT-ONLY mode.  No automated blocking,
no remote execution, no changes to firewall rules.  Every match
is surfaced to the operator through the dashboard for review.

Package layout:
    models.py        — Data classes (ThreatMatch, FeedInfo)
    threat_intel.py  — ThreatIntelEngine: loads feeds, checks IPs
    feed_updater.py  — Downloads upstream feeds into feeds/
    feeds/           — Local copy of threat-intel feed files
"""

from .models import ThreatMatch, FeedInfo
from .threat_intel import ThreatIntelEngine

__all__ = ["ThreatMatch", "FeedInfo", "ThreatIntelEngine"]
