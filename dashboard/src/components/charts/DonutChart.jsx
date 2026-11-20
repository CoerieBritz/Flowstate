import { useState, useMemo } from "react";
import { PALETTE } from "../../lib/colors";
import { formatRate } from "../../lib/format";

// Donut chart — bandwidth share, top 5 apps + other
export function DonutChart({ apps }) {
  const [hovered, setHovered] = useState(null);

  const slices = useMemo(() => {
    const sorted = [...apps].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent));
    const total = sorted.reduce((s, a) => s + a.recv + a.sent, 0);
    if (total === 0) return [];
    const top5 = sorted.slice(0, 5);
    const otherBw = sorted.slice(5).reduce((s, a) => s + a.recv + a.sent, 0);
    const items = top5.map((a, i) => ({
      name: a.name, icon: a.icon || "💻",
      value: a.recv + a.sent, pct: (a.recv + a.sent) / total, color: PALETTE[i],
    }));
    if (otherBw > 0) items.push({ name: "Other", icon: "📦", value: otherBw, pct: otherBw / total, color: "#334155" });
    // Compute arc start/end
    let angle = -Math.PI / 2; // start at 12 o'clock
    return items.map((item) => {
      const start = angle;
      const sweep = item.pct * 2 * Math.PI;
      angle += sweep;
      return { ...item, start, end: angle };
    });
  }, [apps]);

  const SZ = 200, cx = 100, cy = 100, Ro = 84, Ri = 54;

  function arc(s, e, ro, ri) {
    if (e - s >= 2 * Math.PI - 0.001) e = s + 2 * Math.PI - 0.001;
    const cos = Math.cos, sin = Math.sin;
    const p = (r, a) => `${cx + r * cos(a)},${cy + r * sin(a)}`;
    const lg = e - s > Math.PI ? 1 : 0;
    return `M${p(ro,s)} A${ro},${ro} 0 ${lg} 1 ${p(ro,e)} L${p(ri,e)} A${ri},${ri} 0 ${lg} 0 ${p(ri,s)}Z`;
  }

  if (slices.length === 0) {
    return <div style={{ height: SZ, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12 }}>Waiting for app data…</div>;
  }

  const hov = hovered !== null ? slices[hovered] : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
      {/* Donut */}
      <svg width={SZ} height={SZ} style={{ flexShrink: 0 }}>
        {slices.map((sl, i) => {
          const mid = (sl.start + sl.end) / 2;
          const nudge = hovered === i ? 6 : 0;
          return (
            <path key={i}
              d={arc(sl.start, sl.end, Ro, Ri)}
              fill={sl.color}
              fillOpacity={hovered === null || hovered === i ? 0.82 : 0.35}
              stroke="#080d18" strokeWidth={2.5}
              transform={nudge ? `translate(${Math.cos(mid) * nudge},${Math.sin(mid) * nudge})` : ""}
              style={{ cursor: "pointer", transition: "fill-opacity 0.15s, transform 0.15s" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
        {/* Center text */}
        {hov ? (
          <>
            <text x={cx} y={cy - 10} textAnchor="middle" fontSize={9} fill={hov.color} fontFamily="monospace" fontWeight={700}>{hov.name.slice(0, 14)}</text>
            <text x={cx} y={cy + 6}  textAnchor="middle" fontSize={15} fill="#e2e8f0" fontFamily="monospace" fontWeight={700}>{(hov.pct * 100).toFixed(1)}%</text>
            <text x={cx} y={cy + 22} textAnchor="middle" fontSize={9}  fill="#64748b" fontFamily="monospace">{formatRate(hov.value)}</text>
          </>
        ) : (
          <>
            <text x={cx} y={cy - 4} textAnchor="middle" fontSize={9} fill="#475569" fontFamily="monospace" letterSpacing={1}>BANDWIDTH</text>
            <text x={cx} y={cy + 11} textAnchor="middle" fontSize={9} fill="#475569" fontFamily="monospace" letterSpacing={1}>SHARE</text>
          </>
        )}
      </svg>

      {/* Legend */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        {slices.map((sl, i) => (
          <div key={i}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", opacity: hovered === null || hovered === i ? 1 : 0.4, transition: "opacity 0.15s" }}
            onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: sl.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#e2e8f0" }}>{sl.icon} {sl.name}</span>
            <span style={{ fontSize: 11, color: sl.color, fontWeight: 600, minWidth: 38, textAlign: "right" }}>{(sl.pct * 100).toFixed(1)}%</span>
            <span style={{ fontSize: 10, color: "#64748b", minWidth: 72, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatRate(sl.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
