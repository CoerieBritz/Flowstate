import { useState, useEffect, useRef, useMemo } from "react";
import {
  geoNaturalEarth1, geoPath, geoInterpolate, geoGraticule,
} from "d3-geo";
import * as topojson from "topojson-client";
import { useContainerWidth } from "../../hooks/useContainerWidth";
import { formatRate } from "../../lib/format";
import { T, withAlpha } from "../../lib/theme";

// ════════════════════════════════════════════════════════════════════
// GLOBAL CONNECTION MAP — d3-geo Natural Earth + TopoJSON world atlas
// ════════════════════════════════════════════════════════════════════

const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const PROTO_COLOR = { HTTPS: "#22c55e", HTTP: T.warning };

function protoColor(proto) {
  return PROTO_COLOR[proto] || "#f97316";
}

export function GlobalConnectionMap({ connections, apps }) {
  const containerRef   = useRef(null);
  const canvasRef      = useRef(null);
  const animRef        = useRef(null);
  const phaseRef       = useRef(0);
  const dotsPixRef     = useRef([]);
  const containerWidth = useContainerWidth(containerRef, 760);
  const H              = Math.max(200, Math.round(containerWidth * 9 / 16));

  const [topoData, setTopoData] = useState(null);
  const [geoError, setGeoError] = useState(false);
  const [tooltip,  setTooltip]  = useState(null);
  const [selected, setSelected] = useState(null);

  const ORIGIN = { lat: -26.2, lon: 28.0 };

  // Fetch world TopoJSON once
  useEffect(() => {
    let cancelled = false;
    fetch(TOPO_URL)
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((d)  => { if (!cancelled) setTopoData(d); })
      .catch(()  => { if (!cancelled) setGeoError(true); });
    return () => { cancelled = true; };
  }, []);

  // Aggregate connections into unique geo dots
  const dots = useMemo(() => {
    const appBwMap     = new Map(apps.map((a) => [a.name, a.recv + a.sent]));
    const appConnCount = new Map();
    connections.forEach((c) => appConnCount.set(c.app, (appConnCount.get(c.app) || 0) + 1));

    const geoMap = new Map();
    let unknownCount = 0;
    connections.forEach((c) => {
      if (c.lat == null || c.lon == null) { unknownCount++; return; }
      const key = `${c.lat.toFixed(1)},${c.lon.toFixed(1)}`;
      if (!geoMap.has(key)) {
        geoMap.set(key, {
          lat: c.lat, lon: c.lon, cc: c.country_code || "?",
          apps: new Set(), hosts: new Set(), protocols: new Set(),
          count: 0, bw: 0,
        });
      }
      const d = geoMap.get(key);
      d.apps.add(c.app);
      d.hosts.add(c.host || c.remote);
      d.protocols.add(c.protocol);
      d.count++;
      d.bw += (appBwMap.get(c.app) || 0) / (appConnCount.get(c.app) || 1);
    });
    const list = [...geoMap.values()];
    if (unknownCount > 0) {
      list.push({
        lat: null, lon: null, cc: "??", isUnknown: true,
        apps: new Set(), hosts: new Set(["unknown"]),
        protocols: new Set(), count: unknownCount, bw: 0,
      });
    }
    return list;
  }, [connections, apps]);

  // Dominant-protocol colour for a dot
  const dotColor = (d) => {
    const c = { HTTPS: 0, HTTP: 0, other: 0 };
    d.protocols.forEach((p) => { if (p === "HTTPS") c.HTTPS++; else if (p === "HTTP") c.HTTP++; else c.other++; });
    if (c.HTTPS >= c.HTTP && c.HTTPS >= c.other) return "#22c55e";
    if (c.HTTP >= c.other) return T.warning;
    return "#f97316";
  };

  const maxBw = useMemo(() => Math.max(...dots.map((d) => d.bw), 1), [dots]);
  const dotR  = (bw) => 4 + (Math.log(bw + 1) / Math.log(maxBw + 1)) * 12;

  // ── Main animation / draw loop ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !topoData || containerWidth < 100) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = containerWidth * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const W = containerWidth;

    // Build GeoJSON objects from TopoJSON
    const countries = topojson.feature(topoData, topoData.objects.countries);
    const borders   = topojson.mesh(topoData, topoData.objects.countries, (a, b) => a !== b);
    const gratLines = geoGraticule()();

    // Natural Earth projection fitted to canvas
    const projection = geoNaturalEarth1()
      .fitExtent([[4, 4], [W - 4, H - 4]], { type: "Sphere" });
    const pathGen = geoPath(projection, ctx);

    // Pre-project origin once
    const oPx = projection([ORIGIN.lon, ORIGIN.lat]);

    const draw = () => {
      phaseRef.current += 0.006;
      const phase = phaseRef.current;
      ctx.clearRect(0, 0, W, H);

      // Ocean fill (sphere outline clips everything nicely)
      ctx.beginPath();
      pathGen({ type: "Sphere" });
      ctx.fillStyle = T.panel;
      ctx.fill();

      // Graticule
      ctx.beginPath();
      pathGen(gratLines);
      ctx.strokeStyle = withAlpha(T.accent, 0.05);
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Country fills
      ctx.beginPath();
      pathGen(countries);
      ctx.fillStyle = T.inset;
      ctx.fill();

      // Internal borders
      ctx.beginPath();
      pathGen(borders);
      ctx.strokeStyle = "#2a3a5a";
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Sphere ring
      ctx.beginPath();
      pathGen({ type: "Sphere" });
      ctx.strokeStyle = withAlpha(T.accent, 0.18);
      ctx.lineWidth = 1;
      ctx.stroke();

      const knownDots = dots.filter((d) => d.lat !== null);

      // ── Great-circle arcs ───────────────────────────────────────
      knownDots.forEach((d, di) => {
        const color = dotColor(d);

        // Static arc (great-circle LineString rendered by d3-geo)
        ctx.beginPath();
        pathGen({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [[ORIGIN.lon, ORIGIN.lat], [d.lon, d.lat]],
          },
        });
        ctx.strokeStyle = `${color}2a`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Travelling packet along great circle
        const interp = geoInterpolate([ORIGIN.lon, ORIGIN.lat], [d.lon, d.lat]);
        const tOff   = (di * 0.37) % 1;
        const t      = (phase * 0.7 + tOff) % 1;
        const alpha  = Math.sin(t * Math.PI);
        const iPx    = projection(interp(t));
        if (iPx) {
          const hexA = Math.round(alpha * 220).toString(16).padStart(2, "0");
          ctx.beginPath();
          ctx.arc(iPx[0], iPx[1], 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `${color}${hexA}`;
          ctx.shadowColor = color; ctx.shadowBlur = 10;
          ctx.fill(); ctx.shadowBlur = 0;
        }
      });

      // ── Destination dots ────────────────────────────────────────
      const newDotsPix = [];
      knownDots.forEach((d) => {
        const px = projection([d.lon, d.lat]);
        if (!px) return;
        const color = dotColor(d);
        const r     = dotR(d.bw);
        const isSel = selected === `${d.lat.toFixed(1)},${d.lon.toFixed(1)}`;

        // Soft halo
        ctx.beginPath();
        ctx.arc(px[0], px[1], r + 4, 0, Math.PI * 2);
        ctx.fillStyle = `${color}14`; ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(px[0], px[1], r, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? color : `${color}aa`;
        ctx.shadowColor = color; ctx.shadowBlur = isSel ? 18 : 8;
        ctx.fill(); ctx.shadowBlur = 0;

        // CC label on larger dots
        if (r > 7) {
          ctx.font = `${Math.min(9, Math.floor(r * 0.9))}px monospace`;
          ctx.textAlign = "center";
          ctx.fillStyle = `${T.text}cc`;
          ctx.fillText(d.cc, px[0], px[1] + 3);
        }

        newDotsPix.push({ x: px[0], y: px[1], r, dot: d, key: `${d.lat.toFixed(1)},${d.lon.toFixed(1)}` });
      });
      dotsPixRef.current = newDotsPix;

      // ── Unresolved counter ──────────────────────────────────────
      const unk = dots.find((d) => d.isUnknown);
      if (unk && unk.count > 0) {
        ctx.beginPath(); ctx.arc(22, H - 14, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#334155aa"; ctx.fill();
        ctx.fillStyle = T.textSecondary; ctx.font = "11px monospace"; ctx.textAlign = "left";
        ctx.fillText(`?? ${unk.count} unresolved`, 31, H - 10);
      }

      // ── JHB pulsing home dot ────────────────────────────────────
      if (oPx) {
        const pr = 5 + Math.sin(phase * 4) * 1.5;
        ctx.beginPath(); ctx.arc(oPx[0], oPx[1], pr + 5, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(T.accent, 0.10); ctx.fill();
        ctx.beginPath(); ctx.arc(oPx[0], oPx[1], pr, 0, Math.PI * 2);
        ctx.fillStyle = T.accent;
        ctx.shadowColor = T.accent; ctx.shadowBlur = 16;
        ctx.fill(); ctx.shadowBlur = 0;
        ctx.font = "11px monospace"; ctx.textAlign = "left";
        ctx.fillStyle = `${T.accent}cc`;
        ctx.fillText("JHB", oPx[0] + pr + 4, oPx[1] + 3);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [topoData, dots, containerWidth, H, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mouse helpers ─────────────────────────────────────────────
  const toCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width  / (window.devicePixelRatio || 1);
    const scaleY = canvas.height / rect.height / (window.devicePixelRatio || 1);
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  };

  const nearestDot = (cx, cy, threshold = 32) => {
    let best = null, bestDist = threshold;
    dotsPixRef.current.forEach(({ x, y, r, dot, key }) => {
      const d = Math.hypot(cx - x, cy - y);
      if (d < Math.max(bestDist, r + 4)) { best = { dot, key }; bestDist = d; }
    });
    return best;
  };

  const handleMouseMove = (e) => {
    const cc = toCanvasCoords(e);
    if (!cc) return;
    const hit = nearestDot(cc[0], cc[1]);
    setTooltip(hit ? { ...hit, mx: e.clientX, my: e.clientY } : null);
  };

  const handleClick = (e) => {
    const cc = toCanvasCoords(e);
    if (!cc) return;
    const hit = nearestDot(cc[0], cc[1]);
    setSelected((prev) => (hit && prev !== hit.key ? hit.key : null));
  };

  const selectedConns = useMemo(() => {
    if (!selected) return [];
    const [slat, slon] = selected.split(",").map(Number);
    return connections.filter(
      (c) => c.lat != null && Math.abs(c.lat - slat) < 0.2 && Math.abs(c.lon - slon) < 0.2
    );
  }, [selected, connections]);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div ref={containerRef} style={{ position: "relative" }}>

      {/* Loading / error states */}
      {geoError && (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted, fontSize: 12, background: T.panel, borderRadius: 8 }}>
          Map unavailable
        </div>
      )}
      {!geoError && !topoData && (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted, fontSize: 12, background: T.panel, borderRadius: 8 }}>
          Map loading...
        </div>
      )}

      {/* Canvas (hidden until data is ready; avoids layout jump) */}
      <canvas
        ref={canvasRef}
        style={{ width: containerWidth, height: H, borderRadius: 8, display: topoData && !geoError ? "block" : "none", cursor: "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        onClick={handleClick}
      />

      {/* Legend */}
      {topoData && !geoError && (
        <div style={{ position: "absolute", top: 14, right: 14, background: "rgba(5,8,16,0.85)", border: `1px solid ${withAlpha(T.accent, 0.12)}`, borderRadius: 8, padding: "8px 12px", fontSize: 11, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontFamily: T.fontLabel, color: T.textSecondary, letterSpacing: 1, marginBottom: 2 }}>PROTOCOL</div>
          {[["#22c55e","HTTPS"],[T.warning,"HTTP"],["#f97316","Other TCP"]].map(([c,l]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />
              <span style={{ color: T.textSecondary }}>{l}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${withAlpha(T.accent, 0.08)}`, marginTop: 4, paddingTop: 4, color: T.textSecondary }}>
            Dot size = bandwidth<br/>Click dot to inspect
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div style={{ position: "fixed", left: tooltip.mx + 14, top: tooltip.my - 10, background: T.inset, border: `1px solid ${dotColor(tooltip.dot)}44`, borderRadius: 8, padding: "10px 14px", fontSize: 11, pointerEvents: "none", zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.7)", minWidth: 200 }}>
          <div style={{ fontWeight: 700, color: dotColor(tooltip.dot), marginBottom: 6 }}>
            {tooltip.dot.cc} — {[...tooltip.dot.hosts].slice(0, 2).join(", ")}{tooltip.dot.hosts.size > 2 ? ` +${tooltip.dot.hosts.size - 2}` : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: T.textSecondary }}>
            <div>Bandwidth: <span style={{ color: dotColor(tooltip.dot), fontWeight: 600 }}>{formatRate(tooltip.dot.bw)}</span></div>
            <div>Apps: <span style={{ color: T.text }}>{[...tooltip.dot.apps].join(", ").slice(0, 40)}</span></div>
            <div>Protocols: <span style={{ color: T.text }}>{[...tooltip.dot.protocols].join(", ")}</span></div>
            <div>Connections: <span style={{ color: T.text }}>{tooltip.dot.count}</span></div>
          </div>
        </div>
      )}

      {/* Selected destination detail panel */}
      {selected && selectedConns.length > 0 && (
        <div style={{ marginTop: 10, background: T.panel, border: `1px solid ${withAlpha(T.accent, 0.10)}`, borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1, marginBottom: 10 }}>
            CONNECTIONS TO SELECTED DESTINATION
            <button onClick={() => setSelected(null)} style={{ float: "right", background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>✕</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflow: "auto" }}>
            {selectedConns.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <span style={{ color: "#a78bfa", minWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.app}</span>
                <span style={{ color: T.accent, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.host}>{c.host || c.remote}</span>
                <span style={{ color: T.textSecondary, minWidth: 40 }}>:{c.port}</span>
                <span style={{ padding: "1px 5px", borderRadius: 3, fontSize: 11, background: `${protoColor(c.protocol)}18`, color: protoColor(c.protocol) }}>{c.protocol}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
