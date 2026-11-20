import { useState, useRef, useMemo } from "react";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { useContainerWidth } from "../../hooks/useContainerWidth";
import { PALETTE } from "../../lib/colors";
import { formatRate } from "../../lib/format";

// ════════════════════════════════════════════════════════════════════
// SANKEY CHART
// ════════════════════════════════════════════════════════════════════
function buildSankeyGraph(apps, connections) {
  const topApps = [...apps].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent)).slice(0, 10);
  if (topApps.length === 0) return null;
  const nodeIndex = new Map();
  const nodes = [];
  const getOrAdd = (key, label, side) => {
    if (!nodeIndex.has(key)) { nodeIndex.set(key, nodes.length); nodes.push({ name: label, side }); }
    return nodeIndex.get(key);
  };
  topApps.forEach((app) => getOrAdd(`app:${app.name}`, app.name, "app"));
  const links = [];
  topApps.forEach((app) => {
    const appConns = connections.filter((c) => c.app === app.name);
    if (appConns.length === 0) return;
    const hostCount = new Map();
    appConns.forEach((c) => hostCount.set(c.host, (hostCount.get(c.host) || 0) + 1));
    const totalConns = appConns.length;
    const appBw = Math.max(1, app.recv + app.sent);
    [...hostCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([host, count]) => {
      const destIdx = getOrAdd(`dest:${host}`, host, "dest");
      links.push({ source: nodeIndex.get(`app:${app.name}`), target: destIdx, value: Math.max(1, (appBw * count) / totalConns) });
    });
  });
  return links.length > 0 ? { nodes, links } : null;
}

export function SankeyChart({ apps, connections }) {
  const containerRef = useRef(null);
  const containerWidth = useContainerWidth(containerRef, 800);
  const [tooltip, setTooltip] = useState(null);
  // Reserve 230px on right for destination labels, 100px left for app labels
  const LABEL_R = 230, LABEL_L = 100;
  const HEIGHT = 660;
  const graph = useMemo(() => buildSankeyGraph(apps, connections), [apps, connections]);
  const rendered = useMemo(() => {
    if (!graph || containerWidth < 300) return null;
    const layout = sankey()
      .nodeWidth(14)
      .nodePadding(12)
      .extent([[LABEL_L, 5], [containerWidth - LABEL_R, HEIGHT - 5]]);
    try { return layout({ nodes: graph.nodes.map((d) => ({ ...d })), links: graph.links.map((d) => ({ ...d })) }); }
    catch { return null; }
  }, [graph, containerWidth]);
  const appColorMap = useMemo(() => {
    const m = new Map();
    [...apps].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent)).slice(0, 10)
      .forEach((app, i) => m.set(app.name, PALETTE[i % PALETTE.length]));
    return m;
  }, [apps]);

  // Truncate for display, keep full name for tooltip
  const truncate = (s, max) => s.length > max ? s.slice(0, max - 1) + "…" : s;

  return (
    <div ref={containerRef} style={{ width: "100%", overflow: "visible" }}>
      {!rendered ? (
        <div style={{ height: HEIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12 }}>
          {connections.length === 0 ? "Waiting for connection data…" : "No traffic flow data yet — flows appear once apps have active connections."}
        </div>
      ) : (
        <svg width={containerWidth} height={HEIGHT} style={{ display: "block", overflow: "visible" }}>
          {/* Flow links */}
          {rendered.links.map((link, i) => {
            const color = appColorMap.get(link.source.name) || "#38bdf8";
            return (
              <path key={i} d={sankeyLinkHorizontal()(link)} fill="none"
                stroke={color} strokeWidth={Math.max(1.5, link.width)} strokeOpacity={0.30}>
                <title>{link.source.name} → {link.target.name}: {formatRate(link.value)}</title>
              </path>
            );
          })}
          {/* Nodes */}
          {rendered.nodes.map((node, i) => {
            const isApp = node.side === "app";
            const color = isApp ? (appColorMap.get(node.name) || "#38bdf8") : "#94a3b8";
            const nodeH = Math.max(3, node.y1 - node.y0);
            const midY = (node.y0 + node.y1) / 2;
            // Dynamic char limit: approx 6px per char at 10px monospace
            const labelChars = isApp ? Math.floor(LABEL_L / 6.2) : Math.floor(LABEL_R / 6.2);
            const displayLabel = truncate(node.name, Math.max(8, labelChars));
            const isTruncated = node.name.length > labelChars;
            return (
              <g key={i} style={{ cursor: isTruncated ? "help" : "default" }}
                onMouseEnter={(e) => setTooltip({ node, x: e.clientX, y: e.clientY, color })}
                onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                onMouseLeave={() => setTooltip(null)}>
                <rect x={node.x0} y={node.y0} width={node.x1 - node.x0} height={nodeH}
                  fill={color} fillOpacity={0.9} rx={2} />
                <text
                  x={isApp ? node.x0 - 10 : node.x1 + 10}
                  y={midY}
                  textAnchor={isApp ? "end" : "start"}
                  dominantBaseline="middle"
                  fill={color} fontSize={10} fontFamily="monospace">
                  {displayLabel}
                </text>
                {/* Show rate for destination nodes when there's room */}
                {!isApp && nodeH >= 18 && (
                  <text x={node.x1 + 10} y={midY + 13}
                    textAnchor="start" fontSize={8} fill={`${color}88`} fontFamily="monospace">
                    {formatRate(node.value || 0)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* Hover tooltip — fixed position so it's never clipped */}
      {tooltip && (
        <div style={{
          position: "fixed", left: tooltip.x + 14, top: tooltip.y - 10,
          background: "#0f1422", border: `1px solid ${tooltip.color}44`,
          borderRadius: 8, padding: "8px 12px", fontSize: 11,
          pointerEvents: "none", zIndex: 9999,
          boxShadow: "0 4px 20px rgba(0,0,0,0.7)", minWidth: 180,
        }}>
          <div style={{ fontWeight: 700, color: tooltip.color, marginBottom: 5, wordBreak: "break-all" }}>
            {tooltip.node.name}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, color: "#94a3b8" }}>
            <div>Type: <span style={{ color: "#e2e8f0" }}>{tooltip.node.side === "app" ? "Application" : "Destination"}</span></div>
            <div>Bandwidth: <span style={{ color: tooltip.color, fontWeight: 600 }}>{formatRate(tooltip.node.value || 0)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
