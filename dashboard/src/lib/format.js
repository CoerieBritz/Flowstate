// ── App icon mapping ──────────────────────────────────────────────────
export function getAppIcon(name) {
  const n = name.toLowerCase();
  if (n.includes("chrome") || n.includes("firefox") || n.includes("edge") || n.includes("safari") || n.includes("brave") || n.includes("opera")) return "🌐";
  if (n.includes("spotify")) return "🎵";
  if (n.includes("discord")) return "💬";
  if (n.includes("code") || n.includes("vscode") || n.includes("cursor")) return "📝";
  if (n.includes("steam")) return "🎮";
  if (n.includes("slack")) return "📨";
  if (n.includes("outlook") || n.includes("thunderbird") || n.includes("mail")) return "📧";
  if (n.includes("node") || n.includes("python") || n.includes("java") || n.includes("ruby")) return "⚙️";
  if (n.includes("zoom") || n.includes("teams") || n.includes("meet") || n.includes("webex")) return "📹";
  if (n.includes("docker")) return "🐳";
  if (n.includes("git")) return "🔀";
  if (n.includes("ssh") || n.includes("curl") || n.includes("wget")) return "🔐";
  if (n.includes("torrent") || n.includes("transmission") || n.includes("qbittorrent")) return "📡";
  return "💻";
}

export function formatBytes(b) {
  if (b < 1024) return b.toFixed(0) + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}

export function formatRate(b) {
  if (b < 1024)    return b.toFixed(0) + " B/s";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB/s";
  return (b / 1048576).toFixed(2) + " MB/s";
}

// Returns { main, sub } for the two-line rate display on stat cards
export function formatRateDetailed(b) {
  if (b < 1024)    return { main: b.toFixed(0) + " B/s",         sub: null };
  if (b < 1048576) return { main: (b / 1024).toFixed(1) + " KB/s", sub: Math.round(b).toLocaleString() + " B/s" };
  return {
    main: (b / 1048576).toFixed(2) + " MB/s",
    sub:  (b / 1024).toFixed(1) + " KB/s",
  };
}

export function fmtRelTime(ts) {
  const secs = Math.floor(Date.now() / 1000 - ts);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}
