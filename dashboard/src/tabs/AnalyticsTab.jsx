import { SectionHeader } from "../components/SectionHeader";
import { PALETTE } from "../lib/colors";
import { T, withAlpha } from "../lib/theme";
import { AnalyticsSummary } from "../components/charts/AnalyticsSummary";
import { ConnectionsTable } from "../components/charts/ConnectionsTable";
import { DonutChart } from "../components/charts/DonutChart";
import { SankeyChart } from "../components/charts/SankeyChart";
import { TreemapChart } from "../components/charts/TreemapChart";

export function AnalyticsTab({ apps, connections }) {
  return (
    <div>
      {/* ── 1. Summary stat cards ─────────────────────────── */}
      <AnalyticsSummary apps={apps} connections={connections} />

      {/* ── 2. Bandwidth distribution + top hosts ─────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Donut chart */}
        <div style={{ borderRadius: 10, border: `1px solid ${withAlpha(T.accent, 0.08)}`, background: T.panel, padding: "18px 20px" }}>
          <SectionHeader
            title="BANDWIDTH DISTRIBUTION"
            desc="Share of total bandwidth consumed by each app (hover slices or legend to highlight)" />
          <DonutChart apps={apps} />
        </div>

        {/* Top destinations compact list */}
        <div style={{ borderRadius: 10, border: `1px solid ${withAlpha(T.accent, 0.08)}`, background: T.panel, padding: "18px 20px" }}>
          <SectionHeader
            title="TOP DESTINATIONS"
            desc="Most-connected remote hosts across all apps right now" />
          {connections.length === 0 ? (
            <div style={{ color: T.textMuted, fontSize: 12, padding: "20px 0" }}>Waiting for connection data…</div>
          ) : (() => {
            const hostMap = new Map();
            connections.forEach((c) => {
              if (!c.host) return;
              if (!hostMap.has(c.host)) hostMap.set(c.host, { count: 0, apps: new Set() });
              const e = hostMap.get(c.host);
              e.count++;
              if (c.app) e.apps.add(c.app);
            });
            const top = [...hostMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
            const maxCount = top[0]?.[1].count || 1;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {top.map(([host, info], i) => (
                  <div key={host}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                      <span style={{ color: T.accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }} title={host}>{host}</span>
                      <span style={{ color: T.textSecondary }}>{info.count} conn{info.count !== 1 ? "s" : ""}</span>
                    </div>
                    <div style={{ height: 5, background: T.inset, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(info.count / maxCount) * 100}%`, background: PALETTE[i % PALETTE.length], borderRadius: 3, transition: "width 0.3s" }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── 3. Traffic flow (Sankey) ───────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader
          title="TRAFFIC FLOW"
          desc="Sankey diagram showing how bandwidth flows from each app to its network destinations. Link thickness is proportional to bandwidth. Hover links for exact rates." />
        <div style={{ borderRadius: 10, border: `1px solid ${withAlpha(T.accent, 0.08)}`, background: T.panel, padding: 16, overflow: "visible" }}>
          <SankeyChart apps={apps} connections={connections} />
        </div>
      </div>

      {/* ── 4. Top 10 connections table ────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader
          title="TOP 10 CONNECTIONS"
          desc="Aggregated by app + destination. Click column headers to sort. Bandwidth is estimated proportionally from each app's total." />
        <ConnectionsTable connections={connections} apps={apps} />
      </div>

      {/* ── 5. Treemap ─────────────────────────────────────── */}
      <div>
        <SectionHeader
          title="BANDWIDTH TREEMAP"
          desc="Tile area ∝ total bandwidth. Color intensity ∝ traffic level — brighter tiles are using more bandwidth. Hover any tile for detailed stats." />
        <div style={{ borderRadius: 10, border: `1px solid ${withAlpha(T.accent, 0.08)}`, background: T.panel, padding: 16 }}>
          <TreemapChart apps={apps} />
        </div>
      </div>
    </div>
  );
}
