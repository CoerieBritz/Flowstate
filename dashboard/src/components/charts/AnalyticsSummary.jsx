import { formatRate } from "../../lib/format";
import { T } from "../../lib/theme";

// Summary stat cards row
export function AnalyticsSummary({ apps, connections }) {
  const totalRecv = apps.reduce((s, a) => s + a.recv, 0);
  const totalSent = apps.reduce((s, a) => s + a.sent, 0);
  const active = apps.filter((a) => a.recv + a.sent > 0);
  const topApp = [...active].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent))[0];

  // Compute per-host estimated bandwidth (proportional allocation from each app's totals)
  const hostBw = new Map();
  apps.forEach((app) => {
    const appConns = connections.filter((c) => c.app === app.name);
    const total = appConns.length || 1;
    const seen = new Map();
    appConns.forEach((c) => { if (c.host) seen.set(c.host, (seen.get(c.host) || 0) + 1); });
    seen.forEach((cnt, host) => {
      const bw = ((app.recv + app.sent) * cnt) / total;
      hostBw.set(host, (hostBw.get(host) || 0) + bw);
    });
  });
  const topHostBwEntry = [...hostBw.entries()].sort((a, b) => b[1] - a[1])[0];

  const cards = [
    { label: "DOWNLOAD RATE", value: formatRate(totalRecv), color: T.download, sub: "total across all apps" },
    { label: "UPLOAD RATE",   value: formatRate(totalSent), color: T.upload, sub: "total across all apps" },
    { label: "ACTIVE APPS",   value: `${active.length}`,   color: "#a78bfa",
      sub: topApp ? `Top: ${topApp.name.slice(0, 16)} (${formatRate(topApp.recv + topApp.sent)})` : "—" },
    { label: "TOP DESTINATION", value: topHostBwEntry ? topHostBwEntry[0].slice(0, 22) : "—", color: T.success,
      sub: topHostBwEntry ? formatRate(topHostBwEntry[1]) : "—",
      title: topHostBwEntry ? topHostBwEntry[0] : undefined },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
      {cards.map((c) => (
        <div key={c.label} title={c.title} style={{
          padding: "14px 16px", borderRadius: T.radius,
          background: `${c.color}0d`, border: `1px solid ${c.color}22`,
        }}>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1.5, marginBottom: 6 }}>{c.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: c.color, marginBottom: 4 }}>{c.value}</div>
          <div style={{ fontSize: 11, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
