"""
Threat Intel Feed Updater
=========================
Downloads the configured upstream feeds into soar/feeds/.
Uses only the Python standard library — no extra dependencies required.

Run manually whenever you want fresh data (recommended: daily):

    python -m soar.feed_updater            # download / update all feeds
    python -m soar.feed_updater --list     # show status of local files
    python -m soar.feed_updater --feed feodo_c2.txt   # update one feed

After updating, the running backend will use the new files the next time
ThreatIntelEngine.load_all() is called (or on next restart).

OPSEC note
----------
All requests carry a descriptive User-Agent so upstream operators can see
legitimate tool traffic.  A brief delay is inserted between requests to
avoid hammering free public infrastructure.
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

# ── Paths ─────────────────────────────────────────────────────────────────────

# Default feeds directory: soar/feeds/ relative to this file
FEEDS_DIR = Path(__file__).parent / "feeds"

# ── Feed catalogue ────────────────────────────────────────────────────────────
# Mirrors the definitions in threat_intel.py — both must stay in sync.

FEEDS: list[dict] = [
    {
        "name": "Feodo Botnet C2",
        "filename": "feodo_c2.txt",
        "url": "https://feodotracker.abuse.ch/downloads/ipblocklist.txt",
        "category": "botnet",
        "description": (
            "Active botnet C2 IPs from abuse.ch Feodo Tracker. "
            "Updated every 5 minutes by abuse.ch."
        ),
    },
    {
        "name": "URLhaus Malware URLs",
        "filename": "urlhaus.csv",
        "url": "https://urlhaus.abuse.ch/downloads/csv_online/",
        "category": "malware",
        "description": (
            "Active malware-distribution URLs from abuse.ch URLhaus. "
            "IP-based entries are extracted during load."
        ),
    },
    {
        "name": "Emerging Threats Compromised IPs",
        "filename": "et_compromised.txt",
        "url": "https://rules.emergingthreats.net/blockrules/compromised-ips.txt",
        "category": "compromised",
        "description": (
            "Known compromised hosts from Proofpoint Emerging Threats. "
            "Contains individual IPs and some CIDR ranges."
        ),
    },
    {
        "name": "Spamhaus DROP",
        "filename": "spamhaus_drop.txt",
        "url": "https://www.spamhaus.org/drop/drop.txt",
        "category": "spam",
        "description": (
            "Spamhaus Don't Route Or Peer list — CIDR ranges operated by "
            "professional spam gangs and hijacked netblocks."
        ),
    },
]

# ── Request settings ──────────────────────────────────────────────────────────

_UA = (
    "Netwatch-ThreatIntel/1.0 "
    "(open-source local network monitor; "
    "github.com/netwatch; contact: localhost)"
)
_TIMEOUT = 30        # seconds per request
_INTER_REQUEST_DELAY = 1.5  # seconds between requests (be polite)


# ── Core download helper ──────────────────────────────────────────────────────

def _download(url: str, dest: Path, timeout: int = _TIMEOUT) -> tuple[bool, str]:
    """
    Download *url* to *dest* atomically (write to a .tmp file, then rename).
    Returns (success: bool, message: str).
    """
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        tmp.write_bytes(data)
        tmp.replace(dest)           # atomic on POSIX; best-effort on Windows
        size_kb = len(data) / 1024
        lines = data.count(b"\n")
        return True, f"{size_kb:.1f} KB, ~{lines:,} lines"
    except urllib.error.HTTPError as exc:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        return False, f"HTTP {exc.code}: {exc.reason}"
    except urllib.error.URLError as exc:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        return False, f"Network error: {exc.reason}"
    except Exception as exc:  # noqa: BLE001
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        return False, str(exc)


# ── Public API ────────────────────────────────────────────────────────────────

def update_all_feeds(
    feeds_dir: Optional[Path] = None,
    verbose: bool = True,
) -> dict[str, dict]:
    """
    Download every configured feed into *feeds_dir*.

    Returns a result dict:
        { feed_name: {"ok": bool, "message": str, "file": str} }
    """
    target = Path(feeds_dir) if feeds_dir else FEEDS_DIR
    target.mkdir(parents=True, exist_ok=True)

    results: dict[str, dict] = {}
    for i, feed in enumerate(FEEDS):
        dest = target / feed["filename"]
        if verbose:
            print(
                f"  [{i + 1}/{len(FEEDS)}] {feed['name']:<38} … ",
                end="",
                flush=True,
            )
        ok, msg = _download(feed["url"], dest)
        if verbose:
            print(("OK  " if ok else "FAIL") + f" ({msg})")
        results[feed["name"]] = {"ok": ok, "message": msg, "file": str(dest)}

        # Be polite — don't hammer upstream servers
        if i < len(FEEDS) - 1:
            time.sleep(_INTER_REQUEST_DELAY)

    return results


def update_one_feed(
    filename: str,
    feeds_dir: Optional[Path] = None,
    verbose: bool = True,
) -> Optional[dict]:
    """Download a single feed by filename.  Returns result dict or None if not found."""
    target = Path(feeds_dir) if feeds_dir else FEEDS_DIR
    target.mkdir(parents=True, exist_ok=True)

    for feed in FEEDS:
        if feed["filename"] == filename:
            dest = target / feed["filename"]
            if verbose:
                print(f"  Updating {feed['name']} … ", end="", flush=True)
            ok, msg = _download(feed["url"], dest)
            if verbose:
                print(("OK  " if ok else "FAIL") + f" ({msg})")
            return {"ok": ok, "message": msg, "file": str(dest)}

    return None  # filename not found


def list_feeds(feeds_dir: Optional[Path] = None) -> None:
    """Print a status table of all configured feeds."""
    target = Path(feeds_dir) if feeds_dir else FEEDS_DIR
    print(f"\n  Feeds directory: {target}\n")
    print(f"  {'NAME':<38} {'FILE':<28} {'SIZE':>9}  LAST UPDATED")
    print("  " + "─" * 90)
    for feed in FEEDS:
        path = target / feed["filename"]
        if path.exists():
            size_kb = path.stat().st_size / 1024
            mtime = time.strftime(
                "%Y-%m-%d %H:%M", time.localtime(path.stat().st_mtime)
            )
            size_str = f"{size_kb:.1f} KB"
            status = mtime
        else:
            size_str = "—"
            status = "Not downloaded"
        print(
            f"  {feed['name']:<38} {feed['filename']:<28} {size_str:>9}  {status}"
        )
    print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Netwatch Threat Intel Feed Updater",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python -m soar.feed_updater             # update all feeds\n"
            "  python -m soar.feed_updater --list      # show feed status\n"
            "  python -m soar.feed_updater --feed feodo_c2.txt\n"
        ),
    )
    parser.add_argument(
        "--list", action="store_true",
        help="List configured feeds and their local file status",
    )
    parser.add_argument(
        "--feed", metavar="FILENAME",
        help="Update a single feed by filename (e.g. feodo_c2.txt)",
    )
    parser.add_argument(
        "--feeds-dir", metavar="PATH",
        help="Override the default feeds directory",
    )
    args = parser.parse_args()

    feeds_dir = Path(args.feeds_dir) if args.feeds_dir else None

    if args.list:
        list_feeds(feeds_dir)
        sys.exit(0)

    print("=" * 58)
    print("  Netwatch Threat Intel Feed Updater")
    print("=" * 58)
    print(f"  Target : {feeds_dir or FEEDS_DIR}\n")

    if args.feed:
        result = update_one_feed(args.feed, feeds_dir, verbose=True)
        if result is None:
            known = ", ".join(f["filename"] for f in FEEDS)
            print(f"  Unknown feed filename '{args.feed}'.")
            print(f"  Known files: {known}")
            sys.exit(1)
        sys.exit(0 if result["ok"] else 1)

    # Default: update all
    results = update_all_feeds(feeds_dir, verbose=True)
    ok_count = sum(1 for r in results.values() if r["ok"])
    print(f"\n  {ok_count}/{len(FEEDS)} feeds updated successfully.")
    if ok_count < len(FEEDS):
        failed = [n for n, r in results.items() if not r["ok"]]
        for name in failed:
            print(f"  ✗ {name}: {results[name]['message']}")
        print(
            "\n  The backend will load whichever feed files are present.\n"
            "  Check your internet connection and try again."
        )
    else:
        print(
            "\n  Restart the backend (or the engine will reload feeds\n"
            "  automatically on the next scheduled interval)."
        )
    print()


if __name__ == "__main__":
    main()
