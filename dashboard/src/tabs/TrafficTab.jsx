import { formatRateDetailed } from "../lib/format";
import { T, withAlpha } from "../lib/theme";
import { AppBandwidthBarsWithDrillIn } from "../components/charts/AppBandwidthBarsWithDrillIn";
import { GlobalConnectionMap } from "../components/charts/GlobalConnectionMap";
import { TrafficGraph } from "../components/charts/TrafficGraph";
import { TrendBadge } from "../components/charts/TrendBadge";

export function TrafficTab({ history, apps, blockedApps, connections, soarStats, incidents, graphContainerRef, graphWidth, toggleBlock, triggerAction, threatCount, openIncidentCount }) {
  // Smoothed rates: average last 5 polls to avoid 0-spike display
  const smoothRate = (field) => {
    if (history.length === 0) return 0;
    const s = history.slice(-5);
    return s.reduce((acc, h) => acc + (h[field] || 0), 0) / s.length;
  };
  const criticalIncidentCount = incidents.filter((i) => i.status === "OPEN" && i.severity === "CRITICAL").length;
  const _dlRate = formatRateDetailed(smoothRate("recv"));
  const _ulRate = formatRateDetailed(smoothRate("sent"));
  const statCards = [
    { label: "DOWNLOAD RATE", value: _dlRate.main, rateSub: _dlRate.sub, color: T.download, bg: withAlpha(T.download, 0.08), border: withAlpha(T.download, 0.12), trend: <TrendBadge history={history} field="recv" /> },
    { label: "UPLOAD RATE", value: _ulRate.main, rateSub: _ulRate.sub, color: T.upload, bg: withAlpha(T.upload, 0.08), border: withAlpha(T.upload, 0.12), trend: <TrendBadge history={history} field="sent" /> },
    { label: "ACTIVE APPS", value: apps.filter((a) => !blockedApps.has(a.name)).length, color: "#a78bfa", bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.12)", trend: null },
    { label: "CONNECTIONS", value: connections.length, color: T.success, bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.12)", trend: null },
    {
      label: "THREATS",
      value: threatCount,
      color: threatCount > 0 ? T.danger : "#334155",
      bg: threatCount > 0 ? "rgba(239,68,68,0.10)" : "rgba(51,65,85,0.06)",
      border: threatCount > 0 ? "rgba(239,68,68,0.25)" : "rgba(51,65,85,0.12)",
      trend: soarStats
        ? <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{(soarStats.total_indicators || 0).toLocaleString()} indicators loaded</div>
        : <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>no feeds loaded</div>,
    },
    {
      label: "INCIDENTS",
      value: openIncidentCount,
      color: criticalIncidentCount > 0 ? T.danger : openIncidentCount > 0 ? T.warning : "#334155",
      bg:    criticalIncidentCount > 0 ? "rgba(239,68,68,0.10)" : openIncidentCount > 0 ? "rgba(251,191,36,0.08)" : "rgba(51,65,85,0.06)",
      border: criticalIncidentCount > 0 ? "rgba(239,68,68,0.25)" : openIncidentCount > 0 ? "rgba(251,191,36,0.2)" : "rgba(51,65,85,0.12)",
      trend: <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
        {criticalIncidentCount > 0 ? `${criticalIncidentCount} CRITICAL` : openIncidentCount > 0 ? "open incidents" : "all clear"}
      </div>,
    },
  ];

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        {statCards.map((card) => (
          <div key={card.label} style={{ flex: 1, padding: "14px 18px", borderRadius: 10, background: `linear-gradient(135deg,${card.bg},${card.bg.replace("0.08","0.02")})`, border: `1px solid ${card.border}` }}>
            <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1.5, marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
            {card.rateSub && <div style={{ fontSize: 11, color: `${card.color}88`, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{card.rateSub}</div>}
            {card.trend}
          </div>
        ))}
      </div>

      {/* Real-time traffic graph */}
      <div ref={graphContainerRef} style={{ borderRadius: 10, border: `1px solid ${withAlpha(T.accent, 0.08)}`, background: T.panel, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1 }}>REAL-TIME TRAFFIC <span style={{ color: T.textMuted, fontWeight: 400 }}>(last 2 min)</span></div>
          <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: T.download, marginRight: 4 }} />Download</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: T.upload, marginRight: 4 }} />Upload</span>
          </div>
        </div>
        <TrafficGraph history={history} width={graphWidth} height={260} />
      </div>

      {/* Per-app bandwidth bars with drill-in */}
      <div style={{ borderRadius: 10, border: `1px solid ${withAlpha(T.accent, 0.08)}`, background: T.panel, padding: 16, marginBottom: 16 }}>
        <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1, marginBottom: 12 }}>
          TOP APPS BY BANDWIDTH <span style={{ color: T.textMuted, fontWeight: 400 }}>(solid = download, faded = upload)</span>
        </div>
        <AppBandwidthBarsWithDrillIn
          apps={apps}
          connections={connections}
          blockedApps={blockedApps}
          triggerAction={triggerAction}
          toggleBlock={toggleBlock}
        />
      </div>

      {/* Global connection map */}
      <div style={{ borderRadius: 10, border: `1px solid ${withAlpha(T.accent, 0.08)}`, background: T.panel, padding: 16, marginBottom: 0 }}>
        <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1, marginBottom: 12 }}>
          GLOBAL CONNECTION MAP <span style={{ color: T.textMuted, fontWeight: 400 }}>(dot size = bandwidth · hover for details · click to inspect)</span>
        </div>
        <GlobalConnectionMap connections={connections} apps={apps} />
      </div>
    </div>
  );
}
