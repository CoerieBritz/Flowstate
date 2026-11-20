// ── Trend badge ───────────────────────────────────────────────────────
export function TrendBadge({ history, field }) {
  if (history.length < 20) return null;
  const recent = history.slice(-10).reduce((s, h) => s + h[field], 0) / 10;
  const older = history.slice(-Math.min(history.length, 70), -10);
  if (older.length < 5) return null;
  const olderAvg = older.reduce((s, h) => s + h[field], 0) / older.length;
  if (olderAvg === 0 && recent === 0) return null;
  const pct = olderAvg === 0 ? 100 : ((recent - olderAvg) / olderAvg) * 100;
  const up = pct >= 0;
  return (
    <div style={{ fontSize: 9, color: up ? "#4ade80" : "#94a3b8", marginTop: 4, display: "flex", alignItems: "center", gap: 3 }}>
      <span>{up ? "▲" : "▼"}</span>
      <span>{Math.abs(pct).toFixed(0)}% vs last min</span>
    </div>
  );
}
