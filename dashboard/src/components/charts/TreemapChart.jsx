import { useState, useRef, useMemo } from "react";
import { hierarchy, treemap } from "d3-hierarchy";
import { useContainerWidth } from "../../hooks/useContainerWidth";
import { PALETTE } from "../../lib/colors";
import { formatRate } from "../../lib/format";
import { T, withAlpha } from "../../lib/theme";

// ════════════════════════════════════════════════════════════════════
// TREEMAP CHART — color intensity ∝ bandwidth, custom hover tooltip
// ════════════════════════════════════════════════════════════════════
export function TreemapChart({ apps }) {
  const containerRef = useRef(null);
  const containerWidth = useContainerWidth(containerRef, 800);
  const HEIGHT = 300;
  const [tooltip, setTooltip] = useState(null);

  const activeApps = useMemo(
    () => [...apps].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent)).slice(0, 20).filter((a) => a.recv + a.sent > 0),
    [apps]
  );
  const maxBw = useMemo(() => Math.max(...activeApps.map((a) => a.recv + a.sent), 1), [activeApps]);

  const leaves = useMemo(() => {
    if (activeApps.length === 0) return [];
    const root = hierarchy({ children: activeApps }).sum((d) => Math.max(1, d.recv + d.sent));
    treemap().size([containerWidth, HEIGHT]).padding(3).round(true)(root);
    return root.leaves();
  }, [activeApps, containerWidth]);

  return (
    <div ref={containerRef} style={{ width: "100%", position: "relative" }}>
      {leaves.length === 0 ? (
        <div style={{ height: HEIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted, fontSize: 12 }}>Waiting for bandwidth data…</div>
      ) : (
        <div style={{ position: "relative", width: "100%", height: HEIGHT, background: T.panel, borderRadius: 8, overflow: "hidden" }}>
          {leaves.map((leaf, i) => {
            const w = leaf.x1 - leaf.x0, h = leaf.y1 - leaf.y0;
            const color = PALETTE[i % PALETTE.length];
            const frac = (leaf.data.recv + leaf.data.sent) / maxBw; // 0–1
            // Scale background and border alpha with bandwidth intensity
            const bgAlpha = Math.round((0.08 + frac * 0.40) * 255).toString(16).padStart(2, "0");
            const bdAlpha = Math.round((0.18 + frac * 0.45) * 255).toString(16).padStart(2, "0");
            // Show name label only on tiles big enough to be legible
            const showName = w > 72 && h > 30;
            const showRate = w > 90 && h > 52;
            const fontSize = Math.max(9, Math.min(13, w / 8));
            return (
              <div
                key={leaf.data.name}
                style={{
                  position: "absolute", left: leaf.x0, top: leaf.y0, width: w, height: h,
                  background: `${color}${bgAlpha}`,
                  border: `1px solid ${color}${bdAlpha}`,
                  overflow: "hidden", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  cursor: "default", transition: "background 0.3s, border-color 0.3s",
                }}
                onMouseEnter={(e) => setTooltip({ data: leaf.data, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                onMouseLeave={() => setTooltip(null)}
              >
                {showName && (
                  <div style={{ fontSize, fontWeight: 700, color, textAlign: "center", padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", lineHeight: 1.2 }}>
                    {leaf.data.icon && <span style={{ marginRight: 3 }}>{leaf.data.icon}</span>}
                    {leaf.data.name}
                  </div>
                )}
                {showRate && (
                  <div style={{ fontSize: Math.max(8, fontSize - 2), color: `${color}bb`, marginTop: 3 }}>
                    ↓{formatRate(leaf.data.recv)} ↑{formatRate(leaf.data.sent)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Custom hover tooltip (fixed position so it's never clipped) */}
      {tooltip && (
        <div style={{
          position: "fixed", left: tooltip.x + 14, top: tooltip.y - 10,
          background: T.inset, border: `1px solid ${withAlpha(T.accent, 0.2)}`,
          borderRadius: 8, padding: "8px 12px", fontSize: 11,
          pointerEvents: "none", zIndex: 9999,
          boxShadow: "0 4px 20px rgba(0,0,0,0.6)", minWidth: 160,
        }}>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: 5 }}>
            {tooltip.data.icon} {tooltip.data.name}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: T.textSecondary }}>
            <div>Download: <span style={{ color: T.download, fontWeight: 600 }}>{formatRate(tooltip.data.recv)}</span></div>
            <div>Upload:   <span style={{ color: T.upload, fontWeight: 600 }}>{formatRate(tooltip.data.sent)}</span></div>
            <div>Total:    <span style={{ color: T.text, fontWeight: 600 }}>{formatRate(tooltip.data.recv + tooltip.data.sent)}</span></div>
            <div>Connections: <span style={{ color: T.text }}>{tooltip.data.connections || 0}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
