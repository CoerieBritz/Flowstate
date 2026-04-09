import { useState, useEffect, useRef, useMemo } from "react";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { hierarchy, treemap } from "d3-hierarchy";
import {
  forceSimulation, forceLink, forceManyBody,
  forceCollide, forceX, forceY,
} from "d3-force";
import {
  geoNaturalEarth1, geoPath, geoInterpolate, geoGraticule,
} from "d3-geo";
import * as topojson from "topojson-client";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const WS_URL = "ws://localhost:8765";

// ── App icon mapping ──────────────────────────────────────────────────
function getAppIcon(name) {
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

function formatBytes(b) {
  if (b < 1024) return b.toFixed(0) + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}
function formatRate(b) {
  if (b < 1024)    return b.toFixed(0) + " B/s";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB/s";
  return (b / 1048576).toFixed(2) + " MB/s";
}
// Returns { main, sub } for the two-line rate display on stat cards
function formatRateDetailed(b) {
  if (b < 1024)    return { main: b.toFixed(0) + " B/s",         sub: null };
  if (b < 1048576) return { main: (b / 1024).toFixed(1) + " KB/s", sub: Math.round(b).toLocaleString() + " B/s" };
  return {
    main: (b / 1048576).toFixed(2) + " MB/s",
    sub:  (b / 1024).toFixed(1) + " KB/s",
  };
}

const PALETTE = [
  "#38bdf8","#fb923c","#a78bfa","#4ade80","#f472b6",
  "#34d399","#fbbf24","#60a5fa","#e879f9","#2dd4bf",
  "#0ea5e9","#f97316","#8b5cf6","#22c55e","#ec4899",
  "#10b981","#f59e0b","#3b82f6","#d946ef","#14b8a6",
];

// ── Responsive-width hook ─────────────────────────────────────────────
function useContainerWidth(ref, fallback = 800) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0].contentRect.width))
    );
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// ── Trend badge ───────────────────────────────────────────────────────
function TrendBadge({ history, field }) {
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

// ════════════════════════════════════════════════════════════════════
// TRAFFIC GRAPH (canvas — rolling 2-min area chart)
// ════════════════════════════════════════════════════════════════════
function TrafficGraph({ history, width, height }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 10 || height < 10) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = "rgba(56,189,248,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = 20 + ((height - 50) / 5) * i;
      ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(width - 10, y); ctx.stroke();
    }

    if (history.length < 1) {
      ctx.fillStyle = "#475569";
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for data…", width / 2, height / 2);
      return;
    }

    const pts = history.length >= 2 ? history : [history[0], history[0]];
    const maxVal = Math.max(...pts.map((h) => Math.max(h.sent || 0, h.recv || 0)), 1024);
    const gH = height - 50, gW = width - 60;
    const step = gW / (pts.length - 1);
    const xOf = (i) => 50 + i * step;
    const yOf = (v) => 20 + gH - (v / maxVal) * gH;

    const drawArea = (field, gradTop, gradBot, lineColor) => {
      ctx.beginPath();
      ctx.moveTo(xOf(0), 20 + gH);
      pts.forEach((h, i) => ctx.lineTo(xOf(i), yOf(h[field] || 0)));
      ctx.lineTo(xOf(pts.length - 1), 20 + gH);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 20, 0, 20 + gH);
      g.addColorStop(0, gradTop); g.addColorStop(1, gradBot);
      ctx.fillStyle = g; ctx.fill();

      ctx.beginPath();
      pts.forEach((h, i) => {
        const x = xOf(i), y = yOf(h[field] || 0);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = lineColor; ctx.lineWidth = 2;
      ctx.shadowColor = lineColor; ctx.shadowBlur = 8;
      ctx.stroke(); ctx.shadowBlur = 0;

      const last = pts[pts.length - 1];
      const lx = xOf(pts.length - 1);
      const ly = yOf(last[field] || 0);
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fillStyle = lineColor; ctx.shadowColor = lineColor; ctx.shadowBlur = 12;
      ctx.fill(); ctx.shadowBlur = 0;
    };

    drawArea("recv", "rgba(56,189,248,0.40)", "rgba(56,189,248,0.02)", "#38bdf8");
    drawArea("sent", "rgba(251,146,60,0.35)", "rgba(251,146,60,0.02)", "#fb923c");

    ctx.fillStyle = "rgba(148,163,184,0.6)"; ctx.font = "10px monospace"; ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
      ctx.fillText(formatRate((maxVal / 5) * (5 - i)), 46, 24 + (gH / 5) * i);
    }
  }, [history, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 8 }} />;
}

// ════════════════════════════════════════════════════════════════════
// SPARKLINE — 80 px tall with gradient area fill
// ════════════════════════════════════════════════════════════════════
function Sparkline({ data, color, w = 80, h = 80 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || data.length < 2) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const max = Math.max(...data, 1);
    const step = (w - 2) / (data.length - 1);
    const xOf = (i) => 1 + i * step;
    const yOf = (v) => h - 2 - (v / max) * (h - 6);

    // Area fill
    ctx.beginPath();
    ctx.moveTo(xOf(0), h - 2);
    data.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
    ctx.lineTo(xOf(data.length - 1), h - 2);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `${color}66`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad; ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => { i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)); });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  }, [data, color, w, h]);
  return <canvas ref={canvasRef} style={{ width: w, height: h }} />;
}

// ════════════════════════════════════════════════════════════════════
// APP BANDWIDTH BARS — horizontal stacked bars with click-to-drill-in
// ════════════════════════════════════════════════════════════════════
function AppBandwidthBarsWithDrillIn({ apps, connections, blockedApps, triggerAction, toggleBlock }) {
  const [expandedApp, setExpandedApp] = useState(null);

  const top10 = useMemo(
    () => [...apps].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent)).slice(0, 10),
    [apps]
  );
  if (top10.length === 0) {
    return <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>Waiting for data…</div>;
  }
  const maxBw = Math.max(...top10.map((a) => a.recv + a.sent), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {top10.map((app, i) => {
        const recvPct = (app.recv / maxBw) * 100;
        const sentPct = (app.sent / maxBw) * 100;
        const color = PALETTE[i % PALETTE.length];
        const isExpanded = expandedApp === app.name;

        // Aggregate app's connections by destination
        const appConns = connections.filter((c) => c.app === app.name);
        const totalAppConns = appConns.length || 1;
        const destMap = new Map();
        appConns.forEach((c) => {
          const key = c.host || c.remote;
          if (!destMap.has(key)) destMap.set(key, { host: key, ip: c.remote, port: c.port, protocol: c.protocol, pid: c.pid, count: 0, bw: 0 });
          const d = destMap.get(key);
          d.count++;
          d.bw += ((app.recv + app.sent) * (1 / totalAppConns));
        });
        const dests = [...destMap.values()].sort((a, b) => b.bw - a.bw);
        const maxDestBw = Math.max(...dests.map((d) => d.bw), 1);

        return (
          <div key={app.name}>
            {/* Bar row — clickable */}
            <div
              onClick={() => setExpandedApp(isExpanded ? null : app.name)}
              style={{ cursor: "pointer", padding: "6px 0", borderRadius: isExpanded ? "6px 6px 0 0" : 6, transition: "background 0.15s",
                background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, marginBottom: 4 }}>
                <span style={{ color, fontWeight: 600 }}>
                  {isExpanded ? "▼ " : "▶ "}{app.icon} {app.name}
                </span>
                <span style={{ color: "#64748b" }}>
                  <span style={{ color: "#38bdf8" }}>↓{formatRate(app.recv)}</span>
                  {" "}
                  <span style={{ color: "#fb923c" }}>↑{formatRate(app.sent)}</span>
                  <span style={{ marginLeft: 8, color: "#475569" }}>{appConns.length} conn{appConns.length !== 1 ? "s" : ""}</span>
                </span>
              </div>
              <div style={{ height: 12, background: "#0f1422", borderRadius: 6, overflow: "hidden", display: "flex" }}>
                <div style={{ width: `${recvPct}%`, background: `${color}cc`, transition: "width 0.4s", borderRadius: "6px 0 0 6px" }} />
                <div style={{ width: `${sentPct}%`, background: `${color}55`, transition: "width 0.4s" }} />
              </div>
            </div>

            {/* Drill-in panel */}
            {isExpanded && (
              <div style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${color}22`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "12px 14px" }}>
                {/* Summary + actions */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>
                    <span style={{ color }}>{appConns.length}</span> connections · total <span style={{ color }}>{formatRate(app.recv + app.sent)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {app.pid > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); triggerAction("kill_process", { pid: app.pid, name: app.name }, `Kill Process: ${app.name}`, `Terminate ${app.name} (PID ${app.pid}) immediately.`, `taskkill /PID ${app.pid} /F`, true); }}
                        style={{ padding: "4px 10px", borderRadius: 5, border: "none", background: "rgba(251,146,60,0.15)", color: "#fb923c", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        ☠️ Kill
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleBlock(app.name); }}
                      style={{ padding: "4px 10px", borderRadius: 5, border: "none", background: blockedApps?.has(app.name) ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", color: blockedApps?.has(app.name) ? "#ef4444" : "#4ade80", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      {blockedApps?.has(app.name) ? "🚫 Blocked" : "🛡️ Block"}
                    </button>
                  </div>
                </div>

                {dests.length === 0 ? (
                  <div style={{ color: "#475569", fontSize: 10 }}>No active connections.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {dests.slice(0, 8).map((d) => (
                      <div key={d.host} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* Mini bar */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 2 }}>
                            <span style={{ color: "#38bdf8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }} title={d.host}>{d.host}</span>
                            <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>
                              :{d.port}
                              <span style={{ marginLeft: 6, padding: "1px 5px", borderRadius: 3, fontSize: 8, background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>{d.protocol}</span>
                              <span style={{ marginLeft: 6 }}>{d.count}×</span>
                            </span>
                          </div>
                          <div style={{ height: 5, background: "#0f1422", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(d.bw / maxDestBw) * 100}%`, background: `${color}99`, transition: "width 0.3s", borderRadius: 3 }} />
                          </div>
                        </div>
                        <div style={{ fontSize: 9, color, minWidth: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatRate(d.bw)}</div>
                      </div>
                    ))}
                    {dests.length > 8 && (
                      <div style={{ fontSize: 9, color: "#475569" }}>+{dests.length - 8} more destinations</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 9, color: "#475569" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 6, background: "#38bdf8cc", borderRadius: 2, marginRight: 4 }} />Download (solid)</span>
        <span><span style={{ display: "inline-block", width: 10, height: 6, background: "#fb923c55", borderRadius: 2, marginRight: 4 }} />Upload (faded)</span>
        <span style={{ marginLeft: "auto" }}>Click any row to expand</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// STACKED AREA CHART — top-5 apps over last 5 min (canvas)
// ════════════════════════════════════════════════════════════════════
function StackedAreaChart({ appHistory, apps, width, height }) {
  const canvasRef = useRef(null);

  const top5 = useMemo(
    () => [...apps].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent)).slice(0, 5),
    [apps]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 10) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, width, height);

    if (top5.length === 0) {
      ctx.fillStyle = "#475569"; ctx.font = "11px monospace"; ctx.textAlign = "center";
      ctx.fillText("Waiting for app data…", width / 2, height / 2);
      return;
    }

    const histories = top5.map((a) => appHistory[a.name] || []);
    const maxLen = Math.max(...histories.map((h) => h.length), 2);
    if (maxLen < 2) return;

    // Build stacked cumulative values per sample slot
    const stackedPts = []; // stackedPts[i] = [baseline0, val0top, val1top, ...]
    for (let i = 0; i < maxLen; i++) {
      const row = [0];
      for (let j = 0; j < top5.length; j++) {
        const h = histories[j];
        const idx = h.length - maxLen + i;
        const v = idx >= 0 ? (h[idx] || 0) : 0;
        row.push(row[row.length - 1] + v);
      }
      stackedPts.push(row);
    }

    const maxTotal = Math.max(...stackedPts.map((r) => r[r.length - 1]), 1);
    const padL = 58, padT = 16, padB = 28;
    const gW = width - padL - 10;
    const gH = height - padT - padB;

    const xOf = (i) => padL + (i / (maxLen - 1)) * gW;
    const yOf = (v) => padT + gH - (v / maxTotal) * gH;

    // Draw each layer top-down (last app = bottom)
    for (let j = top5.length - 1; j >= 0; j--) {
      const color = PALETTE[j % PALETTE.length];
      ctx.beginPath();
      // Lower boundary
      for (let i = 0; i < maxLen; i++) {
        const x = xOf(i), y = yOf(stackedPts[i][j]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      // Upper boundary (reversed)
      for (let i = maxLen - 1; i >= 0; i--) {
        ctx.lineTo(xOf(i), yOf(stackedPts[i][j + 1]));
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(0, padT, 0, padT + gH);
      g.addColorStop(0, `${color}aa`); g.addColorStop(1, `${color}33`);
      ctx.fillStyle = g; ctx.fill();

      // Top stroke
      ctx.beginPath();
      for (let i = 0; i < maxLen; i++) {
        const x = xOf(i), y = yOf(stackedPts[i][j + 1]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `${color}dd`; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = "rgba(148,163,184,0.55)"; ctx.font = "9px monospace"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      ctx.fillText(formatRate((maxTotal / 4) * (4 - i)), padL - 4, padT + (gH / 4) * i + 3);
    }
    // Time axis
    ctx.textAlign = "left";
    ctx.fillText(`-${Math.round(maxLen / 60)}m`, padL, height - 8);
    ctx.textAlign = "right";
    ctx.fillText("now", padL + gW, height - 8);

    // Legend
    const legY = height - 10;
    let legX = padL + 20;
    top5.forEach((app, j) => {
      ctx.fillStyle = PALETTE[j % PALETTE.length];
      ctx.fillRect(legX - 16, legY - 7, 10, 7);
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText(app.name.slice(0, 14), legX - 4, legY - 1);
      legX += Math.min(app.name.length, 14) * 5 + 24;
    });
  }, [appHistory, top5, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 8 }} />;
}

// ════════════════════════════════════════════════════════════════════
// GLOBAL CONNECTION MAP — d3-geo Natural Earth + TopoJSON world atlas
// ════════════════════════════════════════════════════════════════════

const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const PROTO_COLOR = { HTTPS: "#22c55e", HTTP: "#fbbf24" };
function protoColor(proto) {
  return PROTO_COLOR[proto] || "#f97316";
}

function GlobalConnectionMap({ connections, apps }) {
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
    if (c.HTTP >= c.other) return "#fbbf24";
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
      ctx.fillStyle = "#060c18";
      ctx.fill();

      // Graticule
      ctx.beginPath();
      pathGen(gratLines);
      ctx.strokeStyle = "rgba(56,189,248,0.05)";
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Country fills
      ctx.beginPath();
      pathGen(countries);
      ctx.fillStyle = "#151d2e";
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
      ctx.strokeStyle = "rgba(56,189,248,0.18)";
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
          ctx.fillStyle = "#e2e8f0cc";
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
        ctx.fillStyle = "#64748b"; ctx.font = "8px monospace"; ctx.textAlign = "left";
        ctx.fillText(`?? ${unk.count} unresolved`, 31, H - 10);
      }

      // ── JHB pulsing home dot ────────────────────────────────────
      if (oPx) {
        const pr = 5 + Math.sin(phase * 4) * 1.5;
        ctx.beginPath(); ctx.arc(oPx[0], oPx[1], pr + 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(56,189,248,0.10)"; ctx.fill();
        ctx.beginPath(); ctx.arc(oPx[0], oPx[1], pr, 0, Math.PI * 2);
        ctx.fillStyle = "#38bdf8";
        ctx.shadowColor = "#38bdf8"; ctx.shadowBlur = 16;
        ctx.fill(); ctx.shadowBlur = 0;
        ctx.font = "8px monospace"; ctx.textAlign = "left";
        ctx.fillStyle = "#38bdf8cc";
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
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12, background: "#0a0e17", borderRadius: 8 }}>
          Map unavailable
        </div>
      )}
      {!geoError && !topoData && (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12, background: "#0a0e17", borderRadius: 8 }}>
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
        <div style={{ position: "absolute", top: 14, right: 14, background: "rgba(5,8,16,0.85)", border: "1px solid rgba(56,189,248,0.12)", borderRadius: 8, padding: "8px 12px", fontSize: 9, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ color: "#64748b", letterSpacing: 1, marginBottom: 2 }}>PROTOCOL</div>
          {[["#22c55e","HTTPS"],["#fbbf24","HTTP"],["#f97316","Other TCP"]].map(([c,l]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />
              <span style={{ color: "#94a3b8" }}>{l}</span>
            </div>
          ))}
          <div style={{ borderTop: "1px solid rgba(56,189,248,0.08)", marginTop: 4, paddingTop: 4, color: "#64748b" }}>
            Dot size = bandwidth<br/>Click dot to inspect
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div style={{ position: "fixed", left: tooltip.mx + 14, top: tooltip.my - 10, background: "#0f1422", border: `1px solid ${dotColor(tooltip.dot)}44`, borderRadius: 8, padding: "10px 14px", fontSize: 11, pointerEvents: "none", zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.7)", minWidth: 200 }}>
          <div style={{ fontWeight: 700, color: dotColor(tooltip.dot), marginBottom: 6 }}>
            {tooltip.dot.cc} — {[...tooltip.dot.hosts].slice(0, 2).join(", ")}{tooltip.dot.hosts.size > 2 ? ` +${tooltip.dot.hosts.size - 2}` : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, color: "#94a3b8" }}>
            <div>Bandwidth: <span style={{ color: dotColor(tooltip.dot), fontWeight: 600 }}>{formatRate(tooltip.dot.bw)}</span></div>
            <div>Apps: <span style={{ color: "#e2e8f0" }}>{[...tooltip.dot.apps].join(", ").slice(0, 40)}</span></div>
            <div>Protocols: <span style={{ color: "#e2e8f0" }}>{[...tooltip.dot.protocols].join(", ")}</span></div>
            <div>Connections: <span style={{ color: "#e2e8f0" }}>{tooltip.dot.count}</span></div>
          </div>
        </div>
      )}

      {/* Selected destination detail panel */}
      {selected && selectedConns.length > 0 && (
        <div style={{ marginTop: 10, background: "#080d18", border: "1px solid rgba(56,189,248,0.10)", borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 1, marginBottom: 10 }}>
            CONNECTIONS TO SELECTED DESTINATION
            <button onClick={() => setSelected(null)} style={{ float: "right", background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>✕</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflow: "auto" }}>
            {selectedConns.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 10, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <span style={{ color: "#a78bfa", minWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.app}</span>
                <span style={{ color: "#38bdf8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.host}>{c.host || c.remote}</span>
                <span style={{ color: "#64748b", minWidth: 40 }}>:{c.port}</span>
                <span style={{ padding: "1px 5px", borderRadius: 3, fontSize: 8, background: `${protoColor(c.protocol)}18`, color: protoColor(c.protocol) }}>{c.protocol}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ANALYTICS — shared helpers
// ════════════════════════════════════════════════════════════════════

// Section header with horizontal rule divider
function SectionHeader({ title, desc }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1.5, whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ flex: 1, height: 1, background: "rgba(56,189,248,0.10)" }} />
      </div>
      {desc && <div style={{ fontSize: 10, color: "#475569", marginTop: 5 }}>{desc}</div>}
    </div>
  );
}

// Summary stat cards row
function AnalyticsSummary({ apps, connections }) {
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
    { label: "DOWNLOAD RATE", value: formatRate(totalRecv), color: "#38bdf8", sub: "total across all apps" },
    { label: "UPLOAD RATE",   value: formatRate(totalSent), color: "#fb923c", sub: "total across all apps" },
    { label: "ACTIVE APPS",   value: `${active.length}`,   color: "#a78bfa",
      sub: topApp ? `Top: ${topApp.name.slice(0, 16)} (${formatRate(topApp.recv + topApp.sent)})` : "—" },
    { label: "TOP DESTINATION", value: topHostBwEntry ? topHostBwEntry[0].slice(0, 22) : "—", color: "#4ade80",
      sub: topHostBwEntry ? formatRate(topHostBwEntry[1]) : "—",
      title: topHostBwEntry ? topHostBwEntry[0] : undefined },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
      {cards.map((c) => (
        <div key={c.label} title={c.title} style={{
          padding: "14px 16px", borderRadius: 10,
          background: `${c.color}0d`, border: `1px solid ${c.color}22`,
        }}>
          <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 6 }}>{c.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: c.color, marginBottom: 4 }}>{c.value}</div>
          <div style={{ fontSize: 9, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// Donut chart — bandwidth share, top 5 apps + other
function DonutChart({ apps }) {
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

// Top connections — aggregated by (app, host, protocol), sortable
function ConnectionsTable({ connections, apps }) {
  const [sortField, setSortField] = useState("bw");
  const [sortDir, setSortDir] = useState("desc");
  const startTimesRef = useRef(new Map());

  // Record first-seen time for each (app, host, protocol) triple
  useEffect(() => {
    const now = Date.now();
    connections.forEach((c) => {
      const key = `${c.app}||${c.host}||${c.protocol}`;
      if (!startTimesRef.current.has(key)) startTimesRef.current.set(key, now);
    });
  }, [connections]);

  const rows = useMemo(() => {
    // Aggregate by (app, host, protocol)
    const agg = new Map();
    connections.forEach((c) => {
      const key = `${c.app}||${c.host}||${c.protocol}`;
      if (!agg.has(key)) agg.set(key, { app: c.app, host: c.host, protocol: c.protocol, count: 0 });
      agg.get(key).count++;
    });

    // Proportional bandwidth per aggregated row
    const appTotals = new Map(
      apps.map((a) => [a.name, { recv: a.recv, sent: a.sent, n: connections.filter((c) => c.app === a.name).length || 1 }])
    );

    return [...agg.entries()].map(([key, row]) => {
      const ab = appTotals.get(row.app);
      const frac = ab ? row.count / ab.n : 0;
      const recv = ab ? ab.recv * frac : 0;
      const sent = ab ? ab.sent * frac : 0;
      const startTs = startTimesRef.current.get(key);
      const duration = startTs ? Math.floor((Date.now() - startTs) / 1000) : 0;
      return { key, ...row, recv, sent, bw: recv + sent, duration };
    });
  }, [connections, apps]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    }).slice(0, 10);
  }, [rows, sortField, sortDir]);

  const toggle = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const fmtDur = (s) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  const Th = ({ field, children, align = "left" }) => (
    <th onClick={() => toggle(field)} style={{
      padding: "10px 12px", textAlign: align, cursor: "pointer", userSelect: "none",
      fontSize: 9, letterSpacing: 1.2, fontWeight: 600, whiteSpace: "nowrap",
      color: sortField === field ? "#38bdf8" : "#64748b",
      borderBottom: "1px solid rgba(56,189,248,0.08)",
      background: "rgba(56,189,248,0.04)",
      transition: "color 0.15s",
    }}>
      {children}{sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  if (sorted.length === 0) {
    return <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>Waiting for connection data…</div>;
  }

  return (
    <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(56,189,248,0.08)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <Th field="app">App</Th>
            <Th field="host">Destination</Th>
            <Th field="protocol">Protocol</Th>
            <Th field="recv" align="right">↓ Download</Th>
            <Th field="sent" align="right">↑ Upload</Th>
            <Th field="duration" align="right">Duration</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.key} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <td style={{ padding: "8px 12px", fontWeight: 600 }}>{row.app}</td>
              <td style={{ padding: "8px 12px", color: "#38bdf8", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.host}>{row.host}</td>
              <td style={{ padding: "8px 12px" }}>
                <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, background: "rgba(139,92,246,0.12)", color: "#a78bfa", letterSpacing: 0.5 }}>{row.protocol}</span>
              </td>
              <td style={{ padding: "8px 12px", textAlign: "right", color: "#38bdf8", fontVariantNumeric: "tabular-nums" }}>{formatRate(row.recv)}</td>
              <td style={{ padding: "8px 12px", textAlign: "right", color: "#fb923c", fontVariantNumeric: "tabular-nums" }}>{formatRate(row.sent)}</td>
              <td style={{ padding: "8px 12px", textAlign: "right", color: "#64748b", fontVariantNumeric: "tabular-nums" }}>{fmtDur(row.duration)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

function SankeyChart({ apps, connections }) {
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

// ════════════════════════════════════════════════════════════════════
// TREEMAP CHART — color intensity ∝ bandwidth, custom hover tooltip
// ════════════════════════════════════════════════════════════════════
function TreemapChart({ apps }) {
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
        <div style={{ height: HEIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12 }}>Waiting for bandwidth data…</div>
      ) : (
        <div style={{ position: "relative", width: "100%", height: HEIGHT, background: "#0a0e17", borderRadius: 8, overflow: "hidden" }}>
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
          background: "#0f1422", border: "1px solid rgba(56,189,248,0.2)",
          borderRadius: 8, padding: "8px 12px", fontSize: 11,
          pointerEvents: "none", zIndex: 9999,
          boxShadow: "0 4px 20px rgba(0,0,0,0.6)", minWidth: 160,
        }}>
          <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 5 }}>
            {tooltip.data.icon} {tooltip.data.name}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, color: "#94a3b8" }}>
            <div>Download: <span style={{ color: "#38bdf8", fontWeight: 600 }}>{formatRate(tooltip.data.recv)}</span></div>
            <div>Upload:   <span style={{ color: "#fb923c", fontWeight: 600 }}>{formatRate(tooltip.data.sent)}</span></div>
            <div>Total:    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{formatRate(tooltip.data.recv + tooltip.data.sent)}</span></div>
            <div>Connections: <span style={{ color: "#e2e8f0" }}>{tooltip.data.connections || 0}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// NETWORK MAP — d3-force with stable simulation
// ════════════════════════════════════════════════════════════════════

// Node visual properties
const NODE_COLOR = {
  gateway: "#f59e0b", this_pc: "#38bdf8", internet: "#a78bfa",
  phone: "#4ade80", printer: "#fb923c", tv: "#e879f9", pc: "#64748b",
};
const getNodeColor = (type) => NODE_COLOR[type] || NODE_COLOR.pc;

const NODE_ABBR = { gateway: "GW", this_pc: "PC", internet: "IN", phone: "PH", printer: "PR", tv: "TV" };
const getNodeAbbr = (type) => NODE_ABBR[type] || "PC";

// Compute per-internet-destination estimated bandwidth from app data
function computeInetBandwidth(connections, apps) {
  const bwMap = new Map(); // ip -> { recv, sent, count }
  const countMap = new Map();
  connections.forEach((c) => {
    if (!c.remote || c.remote === "N/A") return;
    countMap.set(c.remote, (countMap.get(c.remote) || 0) + 1);
  });
  (apps || []).forEach((app) => {
    const appConns = connections.filter((c) => c.app === app.name);
    const totalConns = appConns.length || 1;
    const ipCnt = new Map();
    appConns.forEach((c) => { if (c.remote) ipCnt.set(c.remote, (ipCnt.get(c.remote) || 0) + 1); });
    ipCnt.forEach((cnt, ip) => {
      const frac = cnt / totalConns;
      if (!bwMap.has(ip)) bwMap.set(ip, { recv: 0, sent: 0, count: countMap.get(ip) || 0 });
      const b = bwMap.get(ip);
      b.recv += app.recv * frac;
      b.sent += app.sent * frac;
    });
  });
  return bwMap;
}

// Build topology nodes/links — internet nodes come from stableInetRef (pre-accumulated set)
function buildMapGraph(gateway, localIp, lanDevices, connections, stableInetIPs) {
  const nodes = [];
  const links = [];
  const seen = new Set();
  const addNode = (n) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };

  const gwId = gateway || "__gw__";
  addNode({ id: gwId, type: "gateway", label: gateway || "Gateway", ip: gateway || "", mac: "", hostname: "Router/Gateway", r: 20 });

  if (localIp) {
    addNode({ id: localIp, type: "this_pc", label: "This PC", ip: localIp, mac: "", hostname: "This PC", r: 17 });
    links.push({ id: `${localIp}-${gwId}`, source: localIp, target: gwId, kind: "lan", count: 1 });
  }

  (lanDevices || []).forEach((dev) => {
    if (!dev.ip || dev.ip === localIp || dev.ip === gateway) return;
    addNode({ id: dev.ip, type: dev.type || "pc", label: dev.hostname || dev.ip, ip: dev.ip, mac: dev.mac || "", hostname: dev.hostname || dev.ip, r: 13 });
    links.push({ id: `${dev.ip}-${gwId}`, source: dev.ip, target: gwId, kind: "lan", count: 1 });
  });

  // Connection count per inet IP (for line thickness)
  const connCount = new Map();
  connections.forEach((c) => { if (c.remote && c.remote !== "N/A") connCount.set(c.remote, (connCount.get(c.remote) || 0) + 1); });

  // Apps per inet IP (for tooltip)
  const inetApps = new Map();
  connections.forEach((c) => {
    if (!c.remote || c.remote === "N/A") return;
    if (!inetApps.has(c.remote)) inetApps.set(c.remote, new Set());
    if (c.app) inetApps.get(c.remote).add(c.app);
  });

  // Use stable accumulated set for internet nodes
  stableInetIPs.forEach((ip) => {
    if (ip === gateway || ip === localIp) return;
    const count = connCount.get(ip) || 0;
    addNode({
      id: ip, type: "internet",
      label: ip, ip, mac: "", hostname: ip,
      apps: [...(inetApps.get(ip) || [])],
      r: Math.min(14, 7 + Math.log(count + 1) * 1.5),
      count,
    });
    links.push({ id: `${gwId}-${ip}`, source: gwId, target: ip, kind: "internet", count });
  });

  return { nodes, links };
}

function NetworkMap({ gateway, localIp, lanDevices, connections, apps }) {
  const containerRef = useRef(null);
  const W = useContainerWidth(containerRef, 920);
  const H = 560;

  const [renderNodes, setRenderNodes] = useState([]);
  const [renderLinks, setRenderLinks] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const simRef = useRef(null);

  // === STABLE INTERNET NODES ===
  // Accumulate inet IPs — only grows, never shrinks.
  // The simulation restarts only when NEW inet IPs are discovered (or LAN changes).
  const stableInetRef = useRef(new Set());
  const [simVersion, setSimVersion] = useState(0);

  // LAN topology key (changes only when gateway/localIp/lanDevices change)
  const lanTopoKey = useMemo(
    () => [gateway || "", localIp || "", ...(lanDevices || []).map((d) => d.ip).sort()].join("|"),
    [gateway, localIp, lanDevices]
  );

  // Update stable inet set from current connections (top 20 by count)
  useEffect(() => {
    const counts = new Map();
    (connections || []).forEach((c) => {
      if (c.remote && c.remote !== "N/A" && c.remote !== gateway && c.remote !== localIp)
        counts.set(c.remote, (counts.get(c.remote) || 0) + 1);
    });
    const top20 = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([ip]) => ip);
    let added = false;
    top20.forEach((ip) => { if (!stableInetRef.current.has(ip)) { stableInetRef.current.add(ip); added = true; } });
    if (added) setSimVersion((v) => v + 1);
  }, [connections, gateway, localIp]);

  // X target per node type — enforces three-column layout
  const xTarget = (type) => {
    if (type === "gateway") return W * 0.50;
    if (type === "internet") return W * 0.82;
    return W * 0.18; // LAN (this_pc, phone, printer, tv, pc)
  };

  // === SIMULATION ===
  // Only restarts when lanTopoKey, simVersion, or W/H changes — NOT on every poll
  useEffect(() => {
    const { nodes, links } = buildMapGraph(gateway, localIp, lanDevices, connections, stableInetRef.current);
    if (nodes.length === 0) return;

    // Preserve positions from the previous run
    const prevByID = new Map((simRef.current?.nodes() || []).map((n) => [n.id, n]));

    // Assign target Y for internet nodes to spread them vertically
    const inetNodes = nodes.filter((n) => n.type === "internet");
    inetNodes.forEach((n, i) => {
      n.targetY = ((i + 1) / (inetNodes.length + 1)) * H;
    });

    const simNodes = nodes.map((n) => {
      const prev = prevByID.get(n.id);
      if (prev) return { ...n, x: prev.x, y: prev.y, fx: prev.fx ?? undefined, fy: prev.fy ?? undefined };
      // First appearance — start in zone, random spread
      const scatter = n.type === "internet" ? 30 : 50;
      return { ...n, x: xTarget(n.type) + (Math.random() - 0.5) * scatter, y: n.targetY ?? H / 2 + (Math.random() - 0.5) * 200 };
    });
    const simLinks = links.map((l) => ({ ...l }));

    if (simRef.current) simRef.current.stop();

    // Fix gateway at center
    const gwNode = simNodes.find((n) => n.type === "gateway");
    if (gwNode) { gwNode.fx = W * 0.50; gwNode.fy = H / 2; }

    const sim = forceSimulation(simNodes)
      .force("link",
        forceLink(simLinks)
          .id((d) => d.id)
          .distance((d) => d.kind === "lan" ? 120 : 140)
          .strength(0.4))
      .force("charge", forceManyBody().strength(-160))
      .force("collide", forceCollide((d) =>
        d.type === "internet" ? d.r + 22 : d.r + 18))
      // Strong zone forces — this is what fixes the layout
      .force("xZone", forceX((d) => xTarget(d.type)).strength((d) =>
        d.type === "gateway" ? 0 : d.type === "internet" ? 0.75 : 0.70))
      // Vertical spread for internet nodes, mild centering for others
      .force("ySpread", forceY((d) => d.targetY ?? H / 2).strength((d) =>
        d.type === "internet" ? 0.18 : 0.06));

    sim.on("tick", () => {
      setRenderNodes([...simNodes]);
      setRenderLinks([...simLinks]);
    });

    simRef.current = sim;
    return () => sim.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanTopoKey, simVersion, W, H]);

  // Drag handling — fixes node on drag end (keeps user arrangement)
  const handleDragStart = (nodeId, e) => {
    e.preventDefault();
    const node = simRef.current?.nodes().find((n) => n.id === nodeId);
    if (!node) return;
    node.fx = node.x; node.fy = node.y;
    simRef.current?.alphaTarget(0.2).restart();
    const rect = containerRef.current?.getBoundingClientRect();
    const onMove = (ev) => {
      if (!rect) return;
      node.fx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      node.fy = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
    };
    const onUp = () => { simRef.current?.alphaTarget(0); document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  // Live bandwidth (recomputed every second from connections+apps — does NOT restart sim)
  const inetBandwidth = useMemo(() => computeInetBandwidth(connections, apps), [connections, apps]);
  const connCounts = useMemo(() => {
    const m = new Map();
    (connections || []).forEach((c) => { if (c.remote) m.set(c.remote, (m.get(c.remote) || 0) + 1); });
    return m;
  }, [connections]);

  // Stats panel values
  const totalRecvRate = (apps || []).reduce((s, a) => s + a.recv, 0);
  const totalSentRate = (apps || []).reduce((s, a) => s + a.sent, 0);
  const topTalker = [...(apps || [])].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent))[0];
  const inetNodeCount = renderNodes.filter((n) => n.type === "internet").length;
  const lanNodeCount = renderNodes.filter((n) => n.type !== "internet" && n.type !== "gateway").length;

  const zones = [
    { x: 0,         w: W * 0.33, label: "LAN",      fill: "rgba(56,189,248,0.025)",  border: "rgba(56,189,248,0.08)"  },
    { x: W * 0.33,  w: W * 0.34, label: "GATEWAY",  fill: "rgba(245,158,11,0.030)",  border: "rgba(245,158,11,0.08)"  },
    { x: W * 0.67,  w: W * 0.33, label: "INTERNET", fill: "rgba(167,139,250,0.025)", border: "rgba(167,139,250,0.08)" },
  ];

  return (
    <div ref={containerRef} style={{ width: "100%", position: "relative" }}>
      {renderNodes.length === 0 ? (
        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12, background: "#080d18", borderRadius: 8 }}>
          {!gateway ? "Waiting for topology data from backend… (requires netwatch_backend_win.py)" : "Building network map…"}
        </div>
      ) : (
        <>
          <svg width={W} height={H} style={{ display: "block", borderRadius: 8, background: "#080d18", overflow: "visible" }}>
            {/* Zone backgrounds */}
            {zones.map((z) => (
              <g key={z.label}>
                <rect x={z.x} y={0} width={z.w} height={H} fill={z.fill} />
                <line x1={z.x} y1={0} x2={z.x} y2={H} stroke={z.border} strokeWidth={1} />
                <text x={z.x + z.w / 2} y={22} textAnchor="middle"
                  fill={z.border.replace("0.08", "0.55")}
                  fontSize={9} fontFamily="monospace" letterSpacing={2}>{z.label}</text>
              </g>
            ))}

            {/* Links */}
            {renderLinks.map((link, i) => {
              const src = typeof link.source === "object" ? link.source : null;
              const tgt = typeof link.target === "object" ? link.target : null;
              if (!src || !tgt || src.x == null || tgt.x == null) return null;
              const cnt = link.kind === "internet" ? (connCounts.get(tgt.id) || link.count || 1) : 1;
              const sw = link.kind === "internet" ? Math.max(1, Math.log(cnt + 1) * 1.8) : 1.5;
              const stroke = link.kind === "internet" ? "rgba(167,139,250,0.35)" : "rgba(56,189,248,0.30)";
              const mx = (src.x + tgt.x) / 2;
              const my = (src.y + tgt.y) / 2;
              const bw = link.kind === "internet" ? inetBandwidth.get(tgt.id) : null;
              const bwLabel = bw && (bw.recv + bw.sent) > 100 ? formatRate(bw.recv + bw.sent) : null;
              return (
                <g key={link.id || i}>
                  <line x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
                  {bwLabel && (
                    <text x={mx} y={my - 5} textAnchor="middle" fontSize={8} fill="rgba(167,139,250,0.7)" fontFamily="monospace" style={{ pointerEvents: "none" }}>{bwLabel}</text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {renderNodes.map((node) => {
              const cx = node.x ?? 0, cy = node.y ?? 0;
              const color = getNodeColor(node.type);
              const isPrimary = node.type === "gateway" || node.type === "this_pc";
              const shortLabel = (node.label || "").length > 18 ? node.label.slice(0, 17) + "…" : node.label;
              // Per-node bandwidth
              const bw = node.type === "internet" ? inetBandwidth.get(node.id) : null;
              const thisBw = node.type === "this_pc" ? { recv: totalRecvRate, sent: totalSentRate } : null;
              const bwStr = bw && (bw.recv + bw.sent) > 100
                ? `↓${formatRate(bw.recv)}`
                : thisBw ? `↓${formatRate(thisBw.recv)} ↑${formatRate(thisBw.sent)}`
                : null;
              return (
                <g key={node.id}
                  transform={`translate(${cx.toFixed(1)},${cy.toFixed(1)})`}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => handleDragStart(node.id, e)}
                  onMouseEnter={(e) => {
                    const r = containerRef.current?.getBoundingClientRect();
                    if (r) setTooltip({ node, x: e.clientX - r.left, y: e.clientY - r.top, bw });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {/* Outer pulse ring for primary nodes */}
                  {isPrimary && (
                    <circle r={node.r + 8} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.25}
                      style={{ animation: "pulse 2.5s ease-in-out infinite" }} />
                  )}
                  {/* Extra glow ring for this_pc */}
                  {node.type === "this_pc" && (
                    <circle r={node.r + 14} fill="none" stroke={color} strokeWidth={0.5} strokeOpacity={0.12}
                      style={{ animation: "pulse 2.5s ease-in-out infinite 0.5s" }} />
                  )}
                  {/* Circle */}
                  <circle r={node.r} fill={`${color}1c`} stroke={color}
                    strokeWidth={isPrimary ? 2.5 : 1.5}
                    style={{ filter: isPrimary ? `drop-shadow(0 0 8px ${color}88)` : "none" }} />
                  {/* Abbreviation */}
                  <text textAnchor="middle" dominantBaseline="central"
                    fontSize={node.type === "internet" ? 8 : 10} fontWeight={700}
                    fill={color} fontFamily="monospace" style={{ pointerEvents: "none", userSelect: "none" }}>
                    {getNodeAbbr(node.type)}
                  </text>
                  {/* Label */}
                  <text textAnchor="middle" y={node.r + 13} fontSize={9}
                    fill={color} fontFamily="monospace"
                    style={{ pointerEvents: "none", userSelect: "none" }}>
                    {shortLabel}
                  </text>
                  {/* Bandwidth sub-label */}
                  {bwStr && (
                    <text textAnchor="middle" y={node.r + 24} fontSize={8}
                      fill={`${color}99`} fontFamily="monospace"
                      style={{ pointerEvents: "none", userSelect: "none" }}>
                      {bwStr}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Mini stats panel (top-right overlay) */}
          <div style={{
            position: "absolute", top: 12, right: 12,
            background: "rgba(8,13,24,0.92)", border: "1px solid rgba(56,189,248,0.15)",
            borderRadius: 8, padding: "10px 14px", fontSize: 10, minWidth: 170,
            backdropFilter: "blur(4px)",
          }}>
            <div style={{ fontSize: 9, letterSpacing: 1.5, color: "#475569", marginBottom: 8, fontWeight: 600 }}>NETWORK STATS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>LAN Devices</span>
                <span style={{ color: "#38bdf8", fontWeight: 600 }}>{lanNodeCount}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>Internet Dests</span>
                <span style={{ color: "#a78bfa", fontWeight: 600 }}>{inetNodeCount}</span>
              </div>
              <div style={{ height: 1, background: "rgba(56,189,248,0.08)", margin: "2px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>↓ Download</span>
                <span style={{ color: "#38bdf8", fontWeight: 600 }}>{formatRate(totalRecvRate)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>↑ Upload</span>
                <span style={{ color: "#fb923c", fontWeight: 600 }}>{formatRate(totalSentRate)}</span>
              </div>
              {topTalker && (
                <>
                  <div style={{ height: 1, background: "rgba(56,189,248,0.08)", margin: "2px 0" }} />
                  <div style={{ color: "#64748b", fontSize: 9 }}>Top Talker</div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {topTalker.icon} {topTalker.name}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 9 }}>
                    {formatRate(topTalker.recv + topTalker.sent)} total
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute",
          left: Math.min(tooltip.x + 14, W - 210),
          top: Math.max(tooltip.y - 10, 8),
          background: "#0f1422",
          border: `1px solid ${getNodeColor(tooltip.node.type)}44`,
          borderRadius: 8, padding: "8px 12px", fontSize: 11,
          pointerEvents: "none", zIndex: 100, minWidth: 180, maxWidth: 250,
          boxShadow: "0 4px 24px rgba(0,0,0,0.7)",
        }}>
          <div style={{ fontWeight: 700, color: getNodeColor(tooltip.node.type), marginBottom: 6, fontSize: 12 }}>
            {tooltip.node.hostname || tooltip.node.label}
          </div>
          <div style={{ color: "#94a3b8", lineHeight: 1.8, fontSize: 10 }}>
            {tooltip.node.ip && <div>IP: <span style={{ color: "#e2e8f0" }}>{tooltip.node.ip}</span></div>}
            {tooltip.node.mac && tooltip.node.mac !== "" && <div>MAC: <span style={{ color: "#e2e8f0" }}>{tooltip.node.mac}</span></div>}
            {tooltip.bw && (tooltip.bw.recv + tooltip.bw.sent) > 0 && (
              <div>Bandwidth: <span style={{ color: "#38bdf8" }}>↓{formatRate(tooltip.bw.recv)}</span> <span style={{ color: "#fb923c" }}>↑{formatRate(tooltip.bw.sent)}</span></div>
            )}
            {tooltip.node.count > 0 && <div>Connections: <span style={{ color: "#e2e8f0" }}>{tooltip.node.count}</span></div>}
            {tooltip.node.apps && tooltip.node.apps.length > 0 && <div>Apps: <span style={{ color: "#e2e8f0" }}>{tooltip.node.apps.slice(0, 4).join(", ")}</span></div>}
            <div style={{ marginTop: 4, color: "#334155", fontSize: 9, letterSpacing: 0.5 }}>{tooltip.node.type.toUpperCase().replace("_", " ")}</div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap", fontSize: 10, color: "#64748b" }}>
        {Object.entries({ "This PC": "#38bdf8", "Gateway": "#f59e0b", "LAN Device": "#64748b", "Phone": "#4ade80", "Internet Dest": "#a78bfa" }).map(([label, color]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 4px ${color}` }} />
            {label}
          </div>
        ))}
        <div style={{ marginLeft: "auto", color: "#334155", fontSize: 9 }}>
          Drag to rearrange · Line thickness = connection count
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// INCIDENTS TAB — SOAR Phase 2 alert correlation
// ════════════════════════════════════════════════════════════════════

const INC_SEV = {
  CRITICAL: { color: "#ef4444", bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.35)",  pulse: true  },
  HIGH:     { color: "#fb923c", bg: "rgba(251,146,60,0.12)", border: "rgba(251,146,60,0.35)", pulse: false },
  MEDIUM:   { color: "#fbbf24", bg: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.30)", pulse: false },
  LOW:      { color: "#94a3b8", bg: "rgba(148,163,184,0.08)",border: "rgba(148,163,184,0.2)", pulse: false },
};

const RULE_LABELS = {
  R1: "Repeated Connection",
  R2: "Multi-Threat Contact",
  R3: "Multi-Process Fan-out",
  R4: "Bandwidth Anomaly",
  R5: "New Process",
};

const STATUS_STYLE = {
  OPEN:         { color: "#ef4444", bg: "rgba(239,68,68,0.12)",    label: "OPEN"         },
  ACKNOWLEDGED: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)",   label: "ACKNOWLEDGED" },
  RESOLVED:     { color: "#4ade80", bg: "rgba(34,197,94,0.10)",    label: "RESOLVED"     },
};

function fmtRelTime(ts) {
  const secs = Math.floor(Date.now() / 1000 - ts);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function IncidentCard({ incident, onAcknowledge, onResolve, onAction, apps }) {
  const [expanded, setExpanded] = useState(false);
  const sev = INC_SEV[incident.severity] || INC_SEV.LOW;
  const st  = STATUS_STYLE[incident.status] || STATUS_STYLE.OPEN;
  const isResolved = incident.status === "RESOLVED";

  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${sev.border}`,
      background: isResolved ? "rgba(255,255,255,0.015)" : sev.bg,
      marginBottom: 10,
      overflow: "hidden",
      opacity: isResolved ? 0.6 : 1,
      transition: "opacity 0.2s",
    }}>
      {/* ── Card header ── */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}
      >
        {/* Severity badge */}
        <div style={{
          flexShrink: 0, padding: "3px 8px", borderRadius: 5,
          background: `${sev.color}22`, border: `1px solid ${sev.color}44`,
          fontSize: 9, fontWeight: 800, color: sev.color, letterSpacing: 1,
          minWidth: 64, textAlign: "center",
          boxShadow: sev.pulse ? `0 0 8px ${sev.color}55` : "none",
        }}>
          {incident.severity}
        </div>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: isResolved ? "#64748b" : "#e2e8f0",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {incident.title}
            </div>
            {incident.source === "playbook" && (
              <span style={{
                flexShrink: 0, padding: "1px 6px", borderRadius: 4, fontSize: 8,
                background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)",
                color: "#fbbf24", fontWeight: 700, letterSpacing: 0.5,
              }}>
                📋 PLAYBOOK
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap", fontSize: 9, color: "#475569" }}>
            <span style={{ color: "#64748b" }}>
              {incident.source === "playbook"
                ? (incident.playbook_display || incident.rule)
                : (RULE_LABELS[incident.rule] || incident.rule)}
            </span>
            <span>·</span>
            <span>{incident.alert_count} event{incident.alert_count !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>{fmtRelTime(incident.created_at)}</span>
            {incident.processes.length > 0 && (
              <>
                <span>·</span>
                <span style={{ color: "#a78bfa" }}>
                  {incident.processes.slice(0, 3).join(", ")}
                  {incident.processes.length > 3 ? ` +${incident.processes.length - 3}` : ""}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div style={{
          flexShrink: 0, padding: "2px 8px", borderRadius: 4,
          background: st.bg, fontSize: 9, fontWeight: 700, color: st.color,
          letterSpacing: 0.5,
        }}>
          {st.label}
        </div>

        {/* Chevron */}
        <div style={{ flexShrink: 0, color: "#475569", fontSize: 11, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${sev.border}`, padding: "14px 16px", background: "rgba(0,0,0,0.2)" }}>
          {/* Metadata row */}
          <div style={{ display: "flex", gap: 24, marginBottom: 14, flexWrap: "wrap" }}>
            {incident.processes.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 4 }}>PROCESSES</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {incident.processes.map((p) => (
                    <span key={p} style={{ padding: "2px 7px", borderRadius: 4, background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)", fontSize: 10, color: "#a78bfa" }}>{p}</span>
                  ))}
                </div>
              </div>
            )}
            {incident.ips.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 4 }}>IPs / DESTINATIONS</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {incident.ips.slice(0, 6).map((ip) => (
                    <span key={ip} style={{ padding: "2px 7px", borderRadius: 4, background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", fontSize: 10, color: "#38bdf8", fontVariantNumeric: "tabular-nums" }}>{ip}</span>
                  ))}
                  {incident.ips.length > 6 && (
                    <span style={{ fontSize: 10, color: "#475569" }}>+{incident.ips.length - 6} more</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Alert timeline */}
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 8 }}>ALERT TIMELINE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14, maxHeight: 200, overflowY: "auto" }}>
            {incident.alerts.map((a, i) => (
              <div key={i} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "6px 10px", borderRadius: 6,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.04)",
                fontSize: 10,
              }}>
                <span style={{ color: "#475569", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{a.time}</span>
                <span style={{ color: "#94a3b8", flex: 1 }}>{a.message}</span>
                {a.rule && (
                  <span style={{ flexShrink: 0, fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "rgba(56,189,248,0.08)", color: "#64748b" }}>{a.rule}</span>
                )}
              </div>
            ))}
          </div>

          {/* Recommended actions */}
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 8 }}>RECOMMENDED ACTIONS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
            {incident.recommended_actions.map((action, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11 }}>
                <span style={{ color: sev.color, flexShrink: 0, marginTop: 1 }}>›</span>
                <span style={{ color: "#94a3b8" }}>{action}</span>
              </div>
            ))}
          </div>

          {/* Response actions */}
          {onAction && !isResolved && (incident.ips.length > 0 || incident.processes.length > 0) && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 8 }}>RESPONSE ACTIONS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {incident.ips.slice(0, 5).map((ip) => (
                  <ActionBtn key={ip} icon="🚫" label={`Block ${ip}`} color="#ef4444"
                    onClick={() => onAction(
                      "block_ip", { ip },
                      `Block IP ${ip}`,
                      `Add Windows Firewall rules blocking all inbound and outbound traffic to/from ${ip}. Triggered by incident: "${incident.title}".`,
                      `netsh advfirewall firewall add rule name="FlowState Block OUT ${ip}" dir=out action=block remoteip=${ip}`,
                      false,
                    )}
                  />
                ))}
                {incident.processes.slice(0, 3).map((proc) => {
                  const app = (apps || []).find((a) => a.name === proc);
                  if (!app?.pid) return null;
                  return (
                    <ActionBtn key={proc} icon="☠️" label={`Kill ${proc}`} color="#fb923c"
                      onClick={() => onAction(
                        "kill_process", { pid: app.pid, name: proc },
                        `Kill Process: ${proc}`,
                        `Terminate ${proc} (PID ${app.pid}) immediately. This cannot be undone.`,
                        `taskkill /PID ${app.pid} /F`,
                        true,
                      )}
                    />
                  );
                })}
                {incident.ips.slice(0, 3).map((ip) => (
                  <ActionBtn key={`bl-${ip}`} icon="📋" label={`Blocklist ${ip}`} color="#a78bfa"
                    onClick={() => onAction(
                      "add_blocklist", { ip },
                      `Add ${ip} to Blocklist`,
                      `Append ${ip} to data/blocklist.txt for persistent tracking. This does not automatically block the IP — use "Block IP" for that.`,
                      `echo ${ip} >> data/blocklist.txt`,
                      false,
                    )}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Snapshot + status buttons */}
          {!isResolved && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onAction && (
                <ActionBtn icon="📸" label="Snapshot" color="#38bdf8"
                  onClick={() => onAction(
                    "capture_snapshot", {},
                    "Capture System Snapshot",
                    "Save the current process list and all active connections to data/snapshots/. Useful for forensic analysis.",
                    "snapshot → data/snapshots/snapshot_{timestamp}.json",
                    false,
                  )}
                />
              )}
              {incident.status === "OPEN" && (
                <button
                  onClick={() => onAcknowledge(incident.id)}
                  style={{
                    padding: "6px 16px", borderRadius: 6, border: "none",
                    background: "rgba(251,191,36,0.15)", color: "#fbbf24",
                    fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Acknowledge
                </button>
              )}
              <button
                onClick={() => onResolve(incident.id)}
                style={{
                  padding: "6px 16px", borderRadius: 6, border: "none",
                  background: "rgba(34,197,94,0.15)", color: "#4ade80",
                  fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Resolve
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IncidentsTab({ incidents, onAcknowledge, onResolve, onAction, apps }) {
  const open        = incidents.filter((i) => i.status === "OPEN");
  const acked       = incidents.filter((i) => i.status === "ACKNOWLEDGED");
  const resolved    = incidents.filter((i) => i.status === "RESOLVED");

  const sevCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  open.concat(acked).forEach((i) => { if (sevCounts[i.severity] !== undefined) sevCounts[i.severity]++; });

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "OPEN",         value: open.length,     color: "#ef4444" },
          { label: "ACKNOWLEDGED", value: acked.length,    color: "#fbbf24" },
          { label: "RESOLVED",     value: resolved.length, color: "#4ade80" },
        ].map((s) => (
          <div key={s.label} style={{
            padding: "10px 16px", borderRadius: 8, flex: 1, minWidth: 100,
            background: `${s.color}0d`, border: `1px solid ${s.color}22`,
          }}>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
        {Object.entries(sevCounts).filter(([, v]) => v > 0).map(([sev, count]) => {
          const c = INC_SEV[sev];
          return (
            <div key={sev} style={{ padding: "10px 16px", borderRadius: 8, background: c.bg, border: `1px solid ${c.border}` }}>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 4 }}>{sev}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{count}</div>
            </div>
          );
        })}
      </div>

      {/* Alert-only mode notice */}
      <div style={{
        padding: "8px 14px", borderRadius: 8, marginBottom: 16,
        background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.12)",
        fontSize: 10, color: "#475569", display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ color: "#38bdf8" }}>ℹ</span>
        Alert-only mode — the correlator groups and recommends, never executes.
        No traffic has been blocked automatically.
      </div>

      {incidents.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 12, padding: "40px 0", textAlign: "center" }}>
          No incidents yet — the correlator is watching for patterns.
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 10 }}>OPEN INCIDENTS</div>
              {open.map((inc) => (
                <IncidentCard key={inc.id} incident={inc} onAcknowledge={onAcknowledge} onResolve={onResolve} onAction={onAction} apps={apps} />
              ))}
            </>
          )}
          {acked.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, margin: "16px 0 10px" }}>ACKNOWLEDGED</div>
              {acked.map((inc) => (
                <IncidentCard key={inc.id} incident={inc} onAcknowledge={onAcknowledge} onResolve={onResolve} onAction={onAction} apps={apps} />
              ))}
            </>
          )}
          {resolved.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, margin: "16px 0 10px" }}>RESOLVED (last 10)</div>
              {resolved.map((inc) => (
                <IncidentCard key={inc.id} incident={inc} onAcknowledge={onAcknowledge} onResolve={onResolve} onAction={onAction} apps={apps} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PHASE 4 — THREAT INTEL PANEL + LOOKUP BUTTON
// ════════════════════════════════════════════════════════════════════

// Risk score → color/label
function riskColor(score) {
  if (score >= 70) return { color: "#ef4444", label: "CRITICAL", bg: "rgba(239,68,68,0.12)" };
  if (score >= 40) return { color: "#fb923c", label: "HIGH",     bg: "rgba(251,146,60,0.10)" };
  if (score >= 15) return { color: "#fbbf24", label: "MEDIUM",   bg: "rgba(251,191,36,0.10)" };
  return           { color: "#4ade80",  label: "LOW",      bg: "rgba(34,197,94,0.08)"  };
}

// Small button used in the connections table action column
function LookupBtn({ ip, loading, cached, onClick }) {
  return (
    <button
      onClick={onClick}
      title={cached ? `Threat intel cached for ${ip} — click to view` : `Run VirusTotal + AbuseIPDB lookup for ${ip}`}
      style={{
        padding: "3px 7px", borderRadius: 5, border: "none", cursor: "pointer",
        background: cached ? "rgba(56,189,248,0.15)" : "rgba(167,139,250,0.10)",
        color: cached ? "#38bdf8" : "#a78bfa",
        fontSize: 9, fontWeight: 700, fontFamily: "inherit",
        display: "inline-flex", alignItems: "center", gap: 3,
        opacity: loading ? 0.6 : 1,
        minWidth: 52,
      }}
    >
      {loading
        ? <span style={{ animation: "spin 0.8s linear infinite", display: "inline-block" }}>⟳</span>
        : "🔍"}
      <span>{loading ? "…" : "Lookup"}</span>
      {cached && !loading && (
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#38bdf8", flexShrink: 0 }} />
      )}
    </button>
  );
}

// Full threat intel detail panel — shown as a floating modal
function ThreatIntelPanel({ ip, result, onClose }) {
  if (!ip) return null;
  const vt  = result?.virustotal;
  const ab  = result?.abuseipdb;
  const err = result?.error;
  const score = result?.risk_score ?? 0;
  const rc  = riskColor(score);
  const isCached = result?.cached;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9100,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: "95vw", borderRadius: 14,
          background: "#0c1220",
          border: `1px solid ${rc.color}44`,
          boxShadow: `0 20px 60px rgba(0,0,0,0.8), 0 0 30px ${rc.color}18`,
          padding: "22px 26px",
          fontFamily: "inherit",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 22 }}>🔍</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{ip}</div>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.2, marginTop: 2 }}>THREAT INTELLIGENCE LOOKUP</div>
          </div>
          {!err && (
            <div style={{
              padding: "4px 12px", borderRadius: 6,
              background: rc.bg, border: `1px solid ${rc.color}44`,
              fontSize: 11, fontWeight: 800, color: rc.color, letterSpacing: 0.5,
            }}>
              {rc.label} RISK
            </div>
          )}
          {isCached && (
            <div style={{ fontSize: 8, color: "#475569", padding: "2px 6px", borderRadius: 3, background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.1)" }}>CACHED</div>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, padding: 4 }}>✕</button>
        </div>

        {err ? (
          <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#fca5a5" }}>
            ⚠ {err}
          </div>
        ) : (
          <>
            {/* Risk score bar */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748b", marginBottom: 4 }}>
                <span>COMBINED RISK SCORE</span>
                <span style={{ color: rc.color, fontWeight: 700 }}>{score}/100</span>
              </div>
              <div style={{ height: 6, background: "#0f1422", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${score}%`, background: rc.color, borderRadius: 3, transition: "width 0.4s" }} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

              {/* VirusTotal */}
              <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(56,189,248,0.08)" }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11 }}>🦠</span> VIRUSTOTAL
                </div>
                {vt ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <TiRow label="Detection" value={vt.detection_ratio}
                      valueColor={vt.malicious > 0 ? "#ef4444" : "#4ade80"} bold />
                    {vt.country && <TiRow label="Country" value={vt.country} />}
                    {vt.asn_owner && <TiRow label="ASN" value={`AS${vt.asn} ${vt.asn_owner}`} />}
                    {vt.last_analysis_date && <TiRow label="Last Scan" value={vt.last_analysis_date} />}
                    <TiRow label="Reputation" value={vt.reputation} valueColor={vt.reputation < 0 ? "#ef4444" : "#4ade80"} />
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: "#334155" }}>No key configured or lookup pending</div>
                )}
              </div>

              {/* AbuseIPDB */}
              <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(139,92,246,0.08)" }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11 }}>🛡️</span> ABUSEIPDB
                </div>
                {ab ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <TiRow label="Confidence" value={`${ab.confidence_score}%`}
                      valueColor={ab.confidence_score >= 50 ? "#ef4444" : ab.confidence_score >= 20 ? "#fb923c" : "#4ade80"} bold />
                    <TiRow label="Reports" value={ab.total_reports} />
                    {ab.last_reported && <TiRow label="Last Report" value={ab.last_reported} />}
                    {ab.country_code && <TiRow label="Country" value={ab.country_code} />}
                    {ab.isp && <TiRow label="ISP" value={ab.isp} />}
                    {ab.is_whitelisted && <TiRow label="Whitelisted" value="Yes" valueColor="#4ade80" />}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: "#334155" }}>No key configured or lookup pending</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Footer note */}
        <div style={{ marginTop: 14, fontSize: 9, color: "#334155", textAlign: "right" }}>
          {result?.cached_at
            ? `Cached: ${new Date(result.cached_at * 1000).toLocaleString()}`
            : ""}
        </div>
      </div>
    </div>
  );
}

function TiRow({ label, value, valueColor, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
      <span style={{ color: "#475569" }}>{label}</span>
      <span style={{ color: valueColor || "#94a3b8", fontWeight: bold ? 700 : 400, maxWidth: 160, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value ?? "—"}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// THREAT BADGE — shown on connections flagged by threat intel
// ════════════════════════════════════════════════════════════════════
const THREAT_COLORS = {
  high:   { bg: "rgba(239,68,68,0.15)",   text: "#ef4444", border: "rgba(239,68,68,0.35)"   },
  medium: { bg: "rgba(251,146,60,0.15)",  text: "#fb923c", border: "rgba(251,146,60,0.35)"  },
  low:    { bg: "rgba(251,191,36,0.12)",  text: "#fbbf24", border: "rgba(251,191,36,0.30)"  },
};

function ThreatBadge({ threat, compact = false }) {
  const c = THREAT_COLORS[threat.severity] || THREAT_COLORS.high;
  // Shorten long feed names for the badge label
  const shortLabel = threat.feed
    .replace("Emerging Threats ", "ET ")
    .replace("Botnet ", "")
    .replace(" Malware", "")
    .replace(" Compromised", " Comp.");
  const tooltip = [
    `Feed: ${threat.feed}`,
    `Category: ${threat.category}`,
    `Severity: ${threat.severity.toUpperCase()}`,
    `Description: ${threat.description}`,
    threat.tags?.length ? `Tags: ${threat.tags.join(", ")}` : null,
  ].filter(Boolean).join("\n");

  return (
    <div title={tooltip} style={{
      display: "inline-flex", alignItems: "center", gap: compact ? 3 : 4,
      padding: compact ? "1px 5px" : "3px 7px",
      borderRadius: 4,
      background: c.bg,
      border: `1px solid ${c.border}`,
      fontSize: compact ? 8 : 9,
      color: c.text,
      fontWeight: 700,
      letterSpacing: 0.4,
      whiteSpace: "nowrap",
      cursor: "help",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: compact ? 8 : 9 }}>⚠</span>
      {shortLabel}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CONFIRMATION MODAL
// ════════════════════════════════════════════════════════════════════
const ACTION_META = {
  block_ip:         { icon: "🚫", label: "Block IP",              dangerous: false },
  unblock_ip:       { icon: "✅", label: "Unblock IP",            dangerous: false },
  kill_process:     { icon: "☠️", label: "Kill Process",          dangerous: true  },
  add_blocklist:    { icon: "📋", label: "Add to Blocklist",       dangerous: false },
  remove_blocklist: { icon: "🗑️", label: "Remove from Blocklist", dangerous: false },
  capture_snapshot: { icon: "📸", label: "Capture Snapshot",      dangerous: false },
  undo_action:      { icon: "↩️", label: "Undo",                  dangerous: false },
};

function ConfirmModal({ pending, onConfirm, onCancel }) {
  if (!pending) return null;
  const meta = ACTION_META[pending.action] || { icon: "⚡", label: pending.action, dangerous: false };
  const isDangerous = pending.dangerous ?? meta.dangerous;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, borderRadius: 14,
          background: "#0c1220",
          border: `1px solid ${isDangerous ? "rgba(239,68,68,0.4)" : "rgba(56,189,248,0.25)"}`,
          boxShadow: `0 20px 60px rgba(0,0,0,0.8), 0 0 30px ${isDangerous ? "rgba(239,68,68,0.15)" : "rgba(56,189,248,0.1)"}`,
          padding: "24px 28px",
          fontFamily: "inherit",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 24 }}>{meta.icon}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: isDangerous ? "#ef4444" : "#e2e8f0" }}>
              {pending.title || meta.label}
            </div>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginTop: 2 }}>CONFIRM ACTION</div>
          </div>
        </div>

        {/* Description */}
        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7, marginBottom: 14 }}>
          {pending.description}
        </div>

        {/* Command preview */}
        {pending.command && (
          <div style={{
            padding: "8px 12px", borderRadius: 6, marginBottom: 14,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
            fontSize: 10, color: "#64748b", fontFamily: "monospace",
            wordBreak: "break-all",
          }}>
            {pending.command}
          </div>
        )}

        {/* Reversibility warning */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 20,
          padding: "8px 12px", borderRadius: 6,
          background: isDangerous ? "rgba(239,68,68,0.08)" : "rgba(56,189,248,0.05)",
          border: `1px solid ${isDangerous ? "rgba(239,68,68,0.2)" : "rgba(56,189,248,0.12)"}`,
          fontSize: 10,
          color: isDangerous ? "#fca5a5" : "#64748b",
        }}>
          <span>{isDangerous ? "⚠️" : "ℹ️"}</span>
          <span>{isDangerous ? "This action cannot be undone." : "This action is reversible via the Audit Log."}</span>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            padding: "8px 20px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)",
            background: "transparent", color: "#64748b", fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{
            padding: "8px 24px", borderRadius: 7, border: "none",
            background: isDangerous
              ? "linear-gradient(135deg,#dc2626,#b91c1c)"
              : "linear-gradient(135deg,#0ea5e9,#0284c7)",
            color: "#fff", fontSize: 11, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
            boxShadow: isDangerous
              ? "0 2px 12px rgba(239,68,68,0.4)"
              : "0 2px 12px rgba(14,165,233,0.4)",
          }}>
            {isDangerous ? "Confirm — I understand" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════
function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: "fixed", top: 20, right: 20, zIndex: 9500,
      display: "flex", flexDirection: "column", gap: 8, maxWidth: 380,
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "12px 16px", borderRadius: 10,
          background: t.type === "success"
            ? "rgba(34,197,94,0.12)"
            : t.type === "error"
            ? "rgba(239,68,68,0.12)"
            : "rgba(56,189,248,0.10)",
          border: `1px solid ${
            t.type === "success" ? "rgba(34,197,94,0.35)"
            : t.type === "error" ? "rgba(239,68,68,0.35)"
            : "rgba(56,189,248,0.25)"}`,
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          backdropFilter: "blur(8px)",
          fontSize: 11,
          color: t.type === "success" ? "#4ade80" : t.type === "error" ? "#fca5a5" : "#7dd3fc",
          animation: "toastIn 0.2s ease",
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>
            {t.type === "success" ? "✅" : t.type === "error" ? "❌" : "ℹ️"}
          </span>
          <span style={{ flex: 1, lineHeight: 1.5 }}>{t.message}</span>
          <button onClick={() => onDismiss(t.id)} style={{
            background: "none", border: "none", color: "#475569", cursor: "pointer",
            fontSize: 14, padding: 0, flexShrink: 0, lineHeight: 1,
          }}>×</button>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// AUDIT LOG TAB
// ════════════════════════════════════════════════════════════════════
const ACTION_LABELS = {
  block_ip:         "Block IP",
  unblock_ip:       "Unblock IP",
  kill_process:     "Kill Process",
  add_blocklist:    "Add to Blocklist",
  remove_blocklist: "Remove from Blocklist",
  capture_snapshot: "Capture Snapshot",
  undo_action:      "Undo",
};

function AuditLogTab({ auditLog, undoStack, onAction }) {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all"
    ? auditLog
    : auditLog.filter((e) => e.action === filter);

  const undoIds = new Set(undoStack.map((u) => u.undo_id || u.id));

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "TOTAL ACTIONS",  value: auditLog.length, color: "#38bdf8" },
          { label: "SUCCESSES",      value: auditLog.filter((e) => e.result === "success").length, color: "#4ade80" },
          { label: "FAILURES",       value: auditLog.filter((e) => e.result === "failure").length, color: "#ef4444" },
          { label: "UNDO AVAILABLE", value: undoStack.length, color: "#fbbf24" },
        ].map((s) => (
          <div key={s.label} style={{
            flex: 1, minWidth: 100, padding: "10px 16px", borderRadius: 8,
            background: `${s.color}0d`, border: `1px solid ${s.color}22`,
          }}>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter buttons */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {["all", "block_ip", "unblock_ip", "kill_process", "capture_snapshot", "add_blocklist", "remove_blocklist"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "4px 12px", borderRadius: 5, border: "none", fontFamily: "inherit",
            background: filter === f ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)",
            color: filter === f ? "#38bdf8" : "#64748b", fontSize: 10, fontWeight: 600, cursor: "pointer",
          }}>
            {f === "all" ? "ALL" : (ACTION_LABELS[f] || f).toUpperCase()}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 12, padding: "40px 0", textAlign: "center" }}>
          {auditLog.length === 0 ? "No actions taken yet." : "No actions match the filter."}
        </div>
      ) : (
        <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(56,189,248,0.08)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "rgba(56,189,248,0.04)" }}>
                {["Timestamp", "Action", "Target", "Result", "Details", "Undo"].map((h) => (
                  <th key={h} style={{
                    padding: "10px 12px", textAlign: "left",
                    fontSize: 9, letterSpacing: 1.2, color: "#64748b", fontWeight: 600,
                    borderBottom: "1px solid rgba(56,189,248,0.06)", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => {
                const success = entry.result === "success";
                // Find if this entry has a corresponding undo available
                const undoEntry = entry.undo_id
                  ? undoStack.find((u) => u.id === entry.undo_id)
                  : null;
                return (
                  <tr key={i} style={{
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                  }}>
                    <td style={{ padding: "8px 12px", color: "#475569", whiteSpace: "nowrap", fontSize: 10 }}>
                      {entry.timestamp}
                    </td>
                    <td style={{ padding: "8px 12px", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {ACTION_LABELS[entry.action] || entry.action}
                    </td>
                    <td style={{
                      padding: "8px 12px", color: "#38bdf8",
                      maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={entry.target}>
                      {entry.target}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{
                        padding: "2px 7px", borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                        background: success ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                        color: success ? "#4ade80" : "#ef4444",
                      }}>
                        {success ? "SUCCESS" : "FAILED"}
                      </span>
                    </td>
                    <td style={{
                      padding: "8px 12px", color: "#64748b", fontSize: 10,
                      maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={entry.details}>
                      {entry.details}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {undoEntry ? (
                        <button
                          onClick={() => onAction("undo_action",
                            { undo_id: undoEntry.id },
                            `Undo: ${undoEntry.description}`,
                            `This will execute the reverse operation: ${undoEntry.description}`,
                            "",
                            false,
                          )}
                          style={{
                            padding: "3px 10px", borderRadius: 5, border: "none",
                            background: "rgba(251,191,36,0.15)", color: "#fbbf24",
                            fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          ↩ Undo
                        </button>
                      ) : (
                        <span style={{ color: "#1e293b", fontSize: 9 }}>
                          {entry.reversible ? "—" : "irreversible"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ACTION BUTTON — compact, used in tables and cards
// ════════════════════════════════════════════════════════════════════
function ActionBtn({ icon, label, color = "#38bdf8", onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title || label}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 7px", borderRadius: 4, border: "none",
        background: `${color}18`, color, fontSize: 9, fontWeight: 700,
        cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
        letterSpacing: 0.3,
      }}
    >
      {icon && <span style={{ fontSize: 10 }}>{icon}</span>}
      {label}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════
// PLAYBOOKS TAB
// ════════════════════════════════════════════════════════════════════

const TRIGGER_META = {
  threat_flagged:  { label: "Threat Flagged",    color: "#ef4444", bg: "rgba(239,68,68,0.08)"   },
  bandwidth_spike: { label: "Bandwidth Spike",   color: "#fb923c", bg: "rgba(251,146,60,0.08)"  },
  new_process:     { label: "New Process",        color: "#a78bfa", bg: "rgba(139,92,246,0.08)"  },
  port_scan:       { label: "Port Scan",          color: "#fbbf24", bg: "rgba(251,191,36,0.08)"  },
};
const SEV_META = {
  LOW:      { color: "#4ade80",  bg: "rgba(74,222,128,0.08)"  },
  MEDIUM:   { color: "#fbbf24",  bg: "rgba(251,191,36,0.08)"  },
  HIGH:     { color: "#fb923c",  bg: "rgba(251,146,60,0.08)"  },
  CRITICAL: { color: "#ef4444",  bg: "rgba(239,68,68,0.08)"   },
};

function generatePlaybookYaml(f) {
  const slug = f.name || (f.display_name || "playbook").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const lines = [
    `name: ${slug}`,
    `display_name: ${f.display_name || slug}`,
    `description: >`,
    `  ${(f.description || "").trim() || "No description."}`,
    `enabled: ${f.enabled !== false ? "true" : "false"}`,
    ``,
    `trigger:`,
    `  type: ${f.trigger_type || "threat_flagged"}`,
  ];
  if (f.trigger_type === "threat_flagged" && f.min_severity)
    lines.push(`  min_severity: ${f.min_severity}`);
  if (f.trigger_type === "port_scan")
    lines.push(`  min_port_count: ${f.min_port_count || 5}`);
  lines.push(
    ``, `enrichment:`,
    `  virustotal: ${f.enrich_vt ? "true" : "false"}`,
    `  abuseipdb: ${f.enrich_ab ? "true" : "false"}`,
    ``, `incident:`,
    `  severity: ${(f.severity || "MEDIUM").toUpperCase()}`,
    `  recommended_actions:`,
  );
  (f.recommended_actions || []).filter((a) => a.trim()).forEach((a) => {
    lines.push(`    - ${a.trim()}`);
  });
  if (!(f.recommended_actions || []).filter((a) => a.trim()).length)
    lines.push(`    - Review and investigate the flagged event`);
  return lines.join("\n") + "\n";
}

function PipelineStage({ label, detail, color, active }) {
  return (
    <div style={{
      flex: 1, padding: "10px 12px", borderRadius: 8, textAlign: "center",
      background: active ? `${color}15` : "rgba(255,255,255,0.02)",
      border: `1px solid ${active ? color + "40" : "rgba(255,255,255,0.06)"}`,
      opacity: active ? 1 : 0.45,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: active ? color : "#475569", letterSpacing: 1.2, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 9, color: "#64748b", lineHeight: 1.5 }}>{detail}</div>
    </div>
  );
}

function PlaybookEditor({ playbook, onSave, onCancel, wsReady }) {
  const isNew = !playbook;
  const [form, setForm] = useState(() => isNew ? {
    name: "", display_name: "", description: "", trigger_type: "threat_flagged",
    min_severity: "medium", min_port_count: 5,
    severity: "HIGH", enrich_vt: true, enrich_ab: false,
    enabled: true, recommended_actions: [""],
  } : {
    name:               playbook.name,
    display_name:       playbook.display_name,
    description:        playbook.description || "",
    trigger_type:       playbook.trigger_type || "threat_flagged",
    min_severity:       playbook.min_severity || "medium",
    min_port_count:     playbook.min_port_count || 5,
    severity:           playbook.severity || "HIGH",
    enrich_vt:          playbook.enrich_vt || false,
    enrich_ab:          playbook.enrich_ab || false,
    enabled:            playbook.enabled !== false,
    recommended_actions: playbook.recommended_actions?.length ? [...playbook.recommended_actions] : [""],
  });

  const slug = form.name || (form.display_name || "playbook").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const filename = slug + ".yml";

  const setF = (key, val) => setForm((p) => ({ ...p, [key]: val }));
  const setAction = (i, val) => setF("recommended_actions", form.recommended_actions.map((a, j) => j === i ? val : a));
  const addAction = () => setF("recommended_actions", [...form.recommended_actions, ""]);
  const removeAction = (i) => setF("recommended_actions", form.recommended_actions.filter((_, j) => j !== i));

  const FIELD = { ...INPUT_STYLE, marginBottom: 0 };
  const SELECT = { ...FIELD, cursor: "pointer" };

  return (
    <div style={{
      marginBottom: 20, padding: "20px 24px", borderRadius: 12,
      background: "rgba(56,189,248,0.03)", border: "1px solid rgba(56,189,248,0.15)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#38bdf8", letterSpacing: 1.5 }}>
          {isNew ? "CREATE NEW PLAYBOOK" : `EDIT: ${playbook.display_name}`}
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "#64748b", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>✕</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, letterSpacing: 1 }}>DISPLAY NAME</div>
          <input value={form.display_name} onChange={(e) => setF("display_name", e.target.value)} placeholder="e.g. Suspicious Outbound Traffic" style={FIELD} />
          <div style={{ fontSize: 8, color: "#334155", marginTop: 4 }}>Filename: {filename}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, letterSpacing: 1 }}>TRIGGER TYPE</div>
          <select value={form.trigger_type} onChange={(e) => setF("trigger_type", e.target.value)} style={SELECT}>
            <option value="threat_flagged">Threat Flagged</option>
            <option value="bandwidth_spike">Bandwidth Spike</option>
            <option value="new_process">New Process</option>
            <option value="port_scan">Port Scan</option>
          </select>
        </div>
      </div>

      {form.trigger_type === "threat_flagged" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, letterSpacing: 1 }}>MIN THREAT SEVERITY</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["low", "medium", "high"].map((s) => (
              <button key={s} onClick={() => setF("min_severity", s)} style={{
                padding: "5px 14px", borderRadius: 5, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 10, fontWeight: 600,
                background: form.min_severity === s ? "rgba(56,189,248,0.2)" : "rgba(255,255,255,0.04)",
                color: form.min_severity === s ? "#38bdf8" : "#64748b",
              }}>{s.toUpperCase()}</button>
            ))}
          </div>
        </div>
      )}

      {form.trigger_type === "port_scan" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, letterSpacing: 1 }}>MIN PORTS TO TRIGGER</div>
          <input type="number" min={2} max={100} value={form.min_port_count}
            onChange={(e) => setF("min_port_count", Number(e.target.value))} style={{ ...FIELD, width: 120 }} />
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, letterSpacing: 1 }}>DESCRIPTION</div>
        <textarea value={form.description} onChange={(e) => setF("description", e.target.value)}
          placeholder="What does this playbook detect and why…"
          rows={2} style={{ ...FIELD, resize: "vertical", lineHeight: 1.6 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, letterSpacing: 1 }}>INCIDENT SEVERITY</div>
          <select value={form.severity} onChange={(e) => setF("severity", e.target.value)} style={SELECT}>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 8, letterSpacing: 1 }}>ENRICHMENT</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              { key: "enrich_vt", label: "VirusTotal" },
              { key: "enrich_ab", label: "AbuseIPDB" },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 10, color: form[key] ? "#e2e8f0" : "#64748b" }}>
                <input type="checkbox" checked={form[key]} onChange={(e) => setF(key, e.target.checked)}
                  style={{ accentColor: "#38bdf8" }} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 8, letterSpacing: 1 }}>STATUS</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 10, color: form.enabled ? "#4ade80" : "#64748b" }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => setF("enabled", e.target.checked)}
              style={{ accentColor: "#4ade80" }} />
            Enabled
          </label>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 9, color: "#64748b", marginBottom: 8, letterSpacing: 1 }}>RECOMMENDED ACTIONS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {form.recommended_actions.map((action, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ color: "#334155", fontSize: 12, marginTop: 7, flexShrink: 0 }}>—</span>
              <textarea value={action} onChange={(e) => setAction(i, e.target.value)}
                placeholder={`Action ${i + 1}…`} rows={1}
                style={{ ...FIELD, flex: 1, resize: "vertical", lineHeight: 1.5 }} />
              <button onClick={() => removeAction(i)} disabled={form.recommended_actions.length <= 1}
                style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14, padding: "6px 4px", flexShrink: 0 }}>✕</button>
            </div>
          ))}
          <button onClick={addAction} style={{
            alignSelf: "flex-start", padding: "4px 12px", borderRadius: 5,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: "#64748b", fontSize: 10, cursor: "pointer", fontFamily: "inherit",
          }}>+ Add Action</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          disabled={!wsReady || !form.display_name.trim()}
          onClick={() => onSave(generatePlaybookYaml({ ...form, name: slug }), filename)}
          style={{
            padding: "8px 20px", borderRadius: 7, border: "none",
            background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff",
            fontSize: 11, fontWeight: 700, fontFamily: "inherit",
            cursor: wsReady && form.display_name.trim() ? "pointer" : "not-allowed",
            opacity: wsReady && form.display_name.trim() ? 1 : 0.5,
          }}
        >
          💾 {isNew ? "Create Playbook" : "Save Changes"}
        </button>
        <button onClick={onCancel} style={{
          padding: "8px 16px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)",
          background: "transparent", color: "#64748b", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
        }}>Cancel</button>
        <span style={{ fontSize: 9, color: "#334155", marginLeft: 4 }}>
          Will write to <code style={{ color: "#38bdf8" }}>playbooks/{filename}</code>
        </span>
      </div>
    </div>
  );
}

function PlaybooksTab({
  playbooks, incidents, playbookActivity, dryRunResults, dryRunLoading,
  onToggle, onDryRun, onSave, onDelete, onReload, wsReady,
}) {
  const [expandedCard, setExpandedCard]   = useState(null);
  const [editorOpen, setEditorOpen]       = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [activityFilter, setActivityFilter] = useState({ name: "", severity: "" });
  const [activityExpanded, setActivityExpanded] = useState(new Set());

  const handleEdit = (pb) => { setEditingPlaybook(pb); setEditorOpen(true); setExpandedCard(null); };
  const handleNew  = ()   => { setEditingPlaybook(null); setEditorOpen(true); };
  const handleSave = (yaml, filename) => {
    onSave(yaml, filename);
    setEditorOpen(false);
    setEditingPlaybook(null);
  };

  const playbookIncidentCount = (name) =>
    incidents.filter((i) => i.source === "playbook" && i.playbook_name === name).length;

  const triggerPlainEnglish = (pb) => {
    if (pb.trigger_type === "threat_flagged")
      return `Fires when a connection is flagged by a local threat feed${pb.min_severity ? ` with severity ≥ ${pb.min_severity.toUpperCase()}` : ""}.`;
    if (pb.trigger_type === "bandwidth_spike")
      return "Fires when a process exceeds 2× its rolling 1-hour bandwidth average.";
    if (pb.trigger_type === "new_process")
      return "Fires when a process makes its first observed outbound connection.";
    if (pb.trigger_type === "port_scan")
      return `Fires when a single remote IP is seen connecting to ${pb.min_port_count || 5}+ distinct local ports.`;
    return pb.trigger_type;
  };

  const filteredActivity = playbookActivity.filter((e) => {
    if (activityFilter.name && e.playbook_name !== activityFilter.name) return false;
    if (activityFilter.severity && e.severity !== activityFilter.severity) return false;
    return true;
  });

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", letterSpacing: 0.5 }}>Playbook Library</div>
          <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
            {playbooks.length} playbook{playbooks.length !== 1 ? "s" : ""} loaded ·{" "}
            {playbooks.filter((p) => p.enabled).length} enabled ·{" "}
            {incidents.filter((i) => i.source === "playbook").length} incidents generated
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onReload} disabled={!wsReady} title="Reload playbooks from disk" style={{
            padding: "7px 14px", borderRadius: 7,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: "#64748b", fontSize: 10, cursor: wsReady ? "pointer" : "not-allowed",
            fontFamily: "inherit", fontWeight: 600,
          }}>🔄 Reload</button>
          <button onClick={handleNew} disabled={!wsReady} style={{
            padding: "7px 16px", borderRadius: 7,
            background: "linear-gradient(135deg,rgba(56,189,248,0.15),rgba(14,165,233,0.08))",
            border: "1px solid rgba(56,189,248,0.25)", color: "#38bdf8",
            fontSize: 10, fontWeight: 700, cursor: wsReady ? "pointer" : "not-allowed", fontFamily: "inherit",
          }}>+ Create New Playbook</button>
        </div>
      </div>

      {/* ── Editor panel ────────────────────────────────────────────── */}
      {editorOpen && (
        <PlaybookEditor
          playbook={editingPlaybook}
          onSave={handleSave}
          onCancel={() => { setEditorOpen(false); setEditingPlaybook(null); }}
          wsReady={wsReady}
        />
      )}

      {/* ── Confirm delete ───────────────────────────────────────────── */}
      {confirmDelete && (
        <div style={{
          marginBottom: 16, padding: "14px 18px", borderRadius: 10,
          background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 11 }}>⚠ Delete "{confirmDelete}"?</span>
            <span style={{ color: "#64748b", fontSize: 10, marginLeft: 10 }}>This removes the YAML file permanently.</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); setExpandedCard(null); }}
              disabled={!wsReady}
              style={{ padding: "5px 14px", borderRadius: 5, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Delete
            </button>
            <button onClick={() => setConfirmDelete(null)}
              style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#64748b", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Library ─────────────────────────────────────────────────── */}
      {playbooks.length === 0 ? (
        <div style={{
          padding: "40px 20px", textAlign: "center", borderRadius: 12,
          border: "1px dashed rgba(56,189,248,0.12)", color: "#334155", fontSize: 12,
        }}>
          No playbooks loaded. Add YAML files to{" "}
          <code style={{ color: "#38bdf8" }}>playbooks/</code> or use "+ Create New Playbook".
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {playbooks.map((pb) => {
            const tm = TRIGGER_META[pb.trigger_type] || { label: pb.trigger_type, color: "#64748b", bg: "rgba(100,116,139,0.08)" };
            const sm = SEV_META[pb.severity]         || { color: "#64748b", bg: "rgba(100,116,139,0.08)" };
            const isExpanded = expandedCard === pb.name;
            const pbIncidents = incidents.filter((i) => i.source === "playbook" && i.playbook_name === pb.name);
            const drResult    = dryRunResults[pb.name];
            const drLoading   = dryRunLoading === pb.name;

            return (
              <div key={pb.name} style={{
                borderRadius: 10, overflow: "hidden",
                border: `1px solid ${isExpanded ? "rgba(56,189,248,0.2)" : "rgba(255,255,255,0.05)"}`,
                background: isExpanded ? "rgba(56,189,248,0.03)" : "rgba(255,255,255,0.01)",
              }}>
                {/* Card header */}
                <div
                  onClick={() => setExpandedCard(isExpanded ? null : pb.name)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                    cursor: "pointer", opacity: pb.enabled ? 1 : 0.6,
                  }}
                >
                  <span style={{ fontSize: 20 }}>📋</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: pb.enabled ? "#e2e8f0" : "#64748b" }}>
                        {pb.display_name}
                      </span>
                      <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: tm.bg, color: tm.color, border: `1px solid ${tm.color}30` }}>
                        {tm.label.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: sm.bg, color: sm.color, border: `1px solid ${sm.color}30` }}>
                        {pb.severity}
                      </span>
                      {pb.enrich_vt && <span style={{ fontSize: 8, color: "#475569" }} title="Uses VirusTotal">🦠 VT</span>}
                      {pb.enrich_ab && <span style={{ fontSize: 8, color: "#475569" }} title="Uses AbuseIPDB">🛡️ AB</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {pb.description}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: "flex", gap: 16, flexShrink: 0, fontSize: 9, color: "#475569", textAlign: "center" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: pb.times_triggered > 0 ? "#38bdf8" : "#334155" }}>{pb.times_triggered || 0}</div>
                      <div style={{ letterSpacing: 1 }}>TRIGGERED</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: playbookIncidentCount(pb.name) > 0 ? "#fbbf24" : "#334155" }}>{playbookIncidentCount(pb.name)}</div>
                      <div style={{ letterSpacing: 1 }}>INCIDENTS</div>
                    </div>
                    {pb.last_triggered_at && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b" }}>
                          {new Date(pb.last_triggered_at * 1000).toLocaleTimeString()}
                        </div>
                        <div style={{ letterSpacing: 1 }}>LAST HIT</div>
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => onToggle(pb.name, !pb.enabled)} disabled={!wsReady} style={{
                      padding: "4px 10px", borderRadius: 5, border: "none",
                      background: pb.enabled ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
                      color: pb.enabled ? "#4ade80" : "#64748b",
                      fontSize: 9, fontWeight: 700, cursor: wsReady ? "pointer" : "not-allowed", fontFamily: "inherit",
                    }}>{pb.enabled ? "ON" : "OFF"}</button>
                    <button onClick={() => handleEdit(pb)} title="Edit playbook" style={{
                      padding: "4px 8px", borderRadius: 5,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                      color: "#64748b", fontSize: 11, cursor: "pointer",
                    }}>✏️</button>
                    <button onClick={() => setConfirmDelete(pb.name)} title="Delete playbook" style={{
                      padding: "4px 8px", borderRadius: 5,
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
                      color: "#ef4444", fontSize: 11, cursor: "pointer",
                    }}>🗑️</button>
                    <span style={{ fontSize: 14, color: "#334155", padding: "4px 2px" }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* ── Detail View ─────────────────────────────────────── */}
                {isExpanded && (
                  <div style={{ borderTop: "1px solid rgba(56,189,248,0.08)", padding: "16px 20px" }}>

                    {/* Trigger plain English */}
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16, lineHeight: 1.7,
                      padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 8,
                      borderLeft: `3px solid ${tm.color}`,
                    }}>
                      <span style={{ fontWeight: 600, color: tm.color }}>Trigger: </span>
                      {triggerPlainEnglish(pb)}
                    </div>

                    {/* Pipeline */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 8 }}>EXECUTION PIPELINE</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <PipelineStage
                          label="TRIGGER"
                          detail={tm.label}
                          color={tm.color}
                          active={true}
                        />
                        <span style={{ color: "#334155", fontSize: 14 }}>→</span>
                        <PipelineStage
                          label="ENRICH"
                          detail={(pb.enrich_vt ? "VT " : "") + (pb.enrich_ab ? "AB" : "") || "None"}
                          color="#38bdf8"
                          active={pb.enrich_vt || pb.enrich_ab}
                        />
                        <span style={{ color: "#334155", fontSize: 14 }}>→</span>
                        <PipelineStage
                          label="CORRELATE"
                          detail="Link to incidents"
                          color="#a78bfa"
                          active={true}
                        />
                        <span style={{ color: "#334155", fontSize: 14 }}>→</span>
                        <PipelineStage
                          label="RECOMMEND"
                          detail={`${(pb.recommended_actions || []).length} action${(pb.recommended_actions || []).length !== 1 ? "s" : ""}`}
                          color="#4ade80"
                          active={(pb.recommended_actions || []).length > 0}
                        />
                      </div>
                    </div>

                    {/* Description */}
                    {pb.description && (
                      <div style={{ marginBottom: 14, fontSize: 11, color: "#64748b", lineHeight: 1.7 }}>
                        {pb.description}
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                      {/* Recommended actions */}
                      <div>
                        <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 8 }}>
                          RECOMMENDED ACTIONS — <span style={{ color: sm.color }}>{pb.severity}</span> THRESHOLD
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {(pb.recommended_actions || []).map((action, i) => (
                            <div key={i} style={{ display: "flex", gap: 8, fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
                              <span style={{ color: "#334155", flexShrink: 0 }}>{i + 1}.</span>
                              <span>{action}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Related incidents */}
                      <div>
                        <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 8 }}>
                          INCIDENTS GENERATED ({pbIncidents.length})
                        </div>
                        {pbIncidents.length === 0 ? (
                          <div style={{ fontSize: 10, color: "#334155" }}>No incidents yet.</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {pbIncidents.slice(0, 5).map((inc) => {
                              const sm2 = SEV_META[inc.severity] || {};
                              return (
                                <div key={inc.id} style={{
                                  padding: "6px 10px", borderRadius: 6, fontSize: 10,
                                  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                                  display: "flex", alignItems: "center", gap: 8,
                                }}>
                                  <span style={{ fontSize: 8, color: sm2.color || "#64748b", fontWeight: 700,
                                    padding: "1px 5px", borderRadius: 3, background: sm2.bg || "transparent",
                                  }}>{inc.severity}</span>
                                  <span style={{ color: "#94a3b8", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{inc.title}</span>
                                  <span style={{ color: "#334155", fontSize: 9, flexShrink: 0 }}>{inc.status}</span>
                                </div>
                              );
                            })}
                            {pbIncidents.length > 5 && (
                              <div style={{ fontSize: 9, color: "#475569" }}>+{pbIncidents.length - 5} more in Incidents tab</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Dry run */}
                    <div style={{ paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: drResult ? 10 : 0 }}>
                        <button onClick={() => onDryRun(pb.name)} disabled={!wsReady || drLoading} style={{
                          padding: "7px 16px", borderRadius: 7, border: "1px solid rgba(56,189,248,0.25)",
                          background: "rgba(56,189,248,0.08)", color: "#38bdf8",
                          fontSize: 10, fontWeight: 700, cursor: wsReady && !drLoading ? "pointer" : "not-allowed",
                          fontFamily: "inherit", opacity: wsReady ? 1 : 0.5,
                        }}>
                          {drLoading ? "⏳ Testing…" : "🧪 Test Playbook"}
                        </button>
                        <span style={{ fontSize: 9, color: "#334155" }}>
                          Dry run — checks against current connections. No incidents created.
                        </span>
                        {drResult && (
                          <span style={{ fontSize: 9, color: "#475569", marginLeft: "auto" }}>
                            Tested at {new Date(drResult.ts).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      {drResult && (() => {
                        const r = drResult.results?.find((r) => r.playbook_name === pb.name);
                        if (!r) return null;
                        return (
                          <div style={{ padding: "10px 14px", borderRadius: 8, background: r.would_fire ? "rgba(251,191,36,0.06)" : "rgba(34,197,94,0.06)", border: `1px solid ${r.would_fire ? "rgba(251,191,36,0.2)" : "rgba(34,197,94,0.2)"}` }}>
                            {r.would_fire ? (
                              <>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>
                                  ⚡ Would fire — {r.matches.length} match{r.matches.length !== 1 ? "es" : ""}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  {r.matches.slice(0, 5).map((m, i) => (
                                    <div key={i} style={{ fontSize: 10, color: "#94a3b8", display: "flex", gap: 8 }}>
                                      <span style={{ color: "#64748b" }}>{m.app || m.ip || "—"}</span>
                                      <span style={{ color: "#334155" }}>→</span>
                                      <span style={{ color: "#475569" }}>{m.host || m.ip || "—"}</span>
                                      <span style={{ color: "#334155", fontStyle: "italic" }}>{m.reason}</span>
                                    </div>
                                  ))}
                                  {r.matches.length > 5 && <div style={{ fontSize: 9, color: "#475569" }}>+{r.matches.length - 5} more</div>}
                                </div>
                              </>
                            ) : (
                              <div style={{ fontSize: 10, color: "#4ade80" }}>
                                ✓ Would not fire — no matches in current connections
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Activity Feed ───────────────────────────────────────────── */}
      <div style={{
        padding: "16px 20px", borderRadius: 12,
        background: "rgba(255,255,255,0.01)", border: "1px solid rgba(56,189,248,0.07)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 2, fontWeight: 700 }}>PLAYBOOK ACTIVITY FEED</div>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={activityFilter.name}
              onChange={(e) => setActivityFilter((p) => ({ ...p, name: e.target.value }))}
              style={{ ...INPUT_STYLE, width: "auto", fontSize: 9, padding: "3px 8px" }}
            >
              <option value="">All playbooks</option>
              {playbooks.map((pb) => <option key={pb.name} value={pb.name}>{pb.display_name}</option>)}
            </select>
            <select
              value={activityFilter.severity}
              onChange={(e) => setActivityFilter((p) => ({ ...p, severity: e.target.value }))}
              style={{ ...INPUT_STYLE, width: "auto", fontSize: 9, padding: "3px 8px" }}
            >
              <option value="">All severities</option>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {filteredActivity.length === 0 ? (
          <div style={{ color: "#334155", fontSize: 11, textAlign: "center", padding: "20px 0" }}>
            {playbookActivity.length === 0 ? "No playbook activity yet." : "No entries match the filter."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {filteredActivity.map((entry, i) => {
              const sm2 = SEV_META[entry.severity] || {};
              const isNew = entry.result === "new_incident";
              const isEx  = activityExpanded.has(i);
              return (
                <div key={i} style={{
                  borderRadius: 6, overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.03)",
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                }}>
                  <div
                    onClick={() => setActivityExpanded((prev) => {
                      const n = new Set(prev);
                      if (n.has(i)) n.delete(i); else n.add(i);
                      return n;
                    })}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", cursor: "pointer" }}
                  >
                    <span style={{ fontSize: 9, color: "#475569", flexShrink: 0, width: 60 }}>{entry.time_str}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "#64748b", flexShrink: 0, width: 140, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {entry.playbook_display}
                    </span>
                    <span style={{ flex: 1, fontSize: 10, color: "#94a3b8", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {entry.trigger_event}
                    </span>
                    <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: sm2.bg || "transparent", color: sm2.color || "#64748b", flexShrink: 0 }}>
                      {entry.severity}
                    </span>
                    <span style={{
                      fontSize: 8, padding: "1px 6px", borderRadius: 3, flexShrink: 0,
                      background: isNew ? "rgba(74,222,128,0.1)" : "rgba(100,116,139,0.08)",
                      color: isNew ? "#4ade80" : "#475569",
                    }}>
                      {isNew ? "NEW INCIDENT" : "DEDUP"}
                    </span>
                    <span style={{ color: "#334155", fontSize: 10 }}>{isEx ? "▲" : "▼"}</span>
                  </div>
                  {isEx && (
                    <div style={{ padding: "6px 12px 10px 42px", fontSize: 10, color: "#475569", lineHeight: 1.6, borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                      <span style={{ color: "#64748b" }}>Incident ID:</span>{" "}
                      <code style={{ color: "#38bdf8" }}>{entry.incident_id}</code>
                      {" · "}
                      <span style={{ color: "#64748b" }}>Result:</span>{" "}
                      {isNew ? "New incident created" : "Merged into existing open incident"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 9, color: "#1e293b", marginTop: 8 }}>
          Showing last {filteredActivity.length} entries · Resets on backend restart
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SETTINGS TAB — begins below (SIEM tab removed)
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ════════════════════════════════════════════════════════════════════
const FLOWSTATE_VERSION = "1.0.0";

function SettingsSection({ title, children }) {
  return (
    <div style={{
      marginBottom: 24, padding: "20px 24px", borderRadius: 12,
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(56,189,248,0.08)",
    }}>
      <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 2, marginBottom: 16, fontWeight: 700 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SettingsField({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{label}</label>
        {hint && <span style={{ fontSize: 9, color: "#475569" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const INPUT_STYLE = {
  width: "100%", padding: "8px 12px", borderRadius: 7,
  background: "#0a0e17", border: "1px solid rgba(56,189,248,0.12)",
  color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", outline: "none",
  boxSizing: "border-box",
};

function KeyStatusDot({ masked }) {
  const isSet = masked && masked.length > 0;
  return (
    <span title={isSet ? "Key is set" : "No key configured"} style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: isSet ? "#4ade80" : "#334155",
      boxShadow: isSet ? "0 0 6px #4ade80" : "none",
      marginLeft: 6, verticalAlign: "middle", flexShrink: 0,
    }} />
  );
}

function SettingsTab({ settings, soarStats, onSave, onRefreshFeeds, wsReady }) {
  // Draft mirrors settings; user edits draft, saves to backend
  const [draft, setDraft]     = useState(() => settings);
  const [vtKey, setVtKey]     = useState("");  // new key input (blank = unchanged)
  const [abKey, setAbKey]     = useState("");  // new key input (blank = unchanged)
  const [saving, setSaving]   = useState(false);

  // Sync draft when settings change from backend
  useEffect(() => { setDraft(settings); }, [settings]);

  const set = (section, key, value) =>
    setDraft((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));

  const handleSave = (section) => {
    const payload = { ...draft };
    // Inject new key values only if the user actually typed something
    if (section === "threat_intel" || section === "all") {
      if (vtKey.trim()) payload.threat_intel = { ...payload.threat_intel, virustotal_api_key: vtKey.trim() };
      if (abKey.trim()) payload.threat_intel = { ...payload.threat_intel, abuseipdb_api_key:  abKey.trim() };
    }
    onSave(section === "all" ? payload : { [section]: payload[section] });
    setSaving(true);
    setTimeout(() => setSaving(false), 1500);
    if (section === "threat_intel" || section === "all") {
      setVtKey(""); setAbKey("");
    }
  };

  const ti        = draft.threat_intel  || {};
  const alerts    = draft.alerts        || {};
  const display   = draft.display       || {};
  const retention = draft.retention     || {};
  const feeds     = soarStats?.feeds    || [];

  return (
    <div style={{ maxWidth: 760 }}>

      {/* ── API Keys ─────────────────────────────────────────────── */}
      <SettingsSection title="API KEYS — THREAT INTELLIGENCE">
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 16, lineHeight: 1.7 }}>
          Add your own API keys to enable live threat lookups. Free tiers are
          sufficient for personal use. Keys are stored locally in{" "}
          <code style={{ color: "#38bdf8", fontSize: 10 }}>data/settings.json</code>{" "}
          and never transmitted off your machine.
        </div>

        <SettingsField
          label={<>VirusTotal API Key <KeyStatusDot masked={ti.virustotal_api_key} /></>}
          hint={ti.virustotal_api_key ? `Currently set: ${ti.virustotal_api_key}` : "Not configured"}
        >
          <input
            type="password" placeholder={ti.virustotal_api_key ? "Enter new key to replace…" : "Paste your API key…"}
            value={vtKey} onChange={(e) => setVtKey(e.target.value)}
            style={INPUT_STYLE}
            autoComplete="new-password"
          />
          <div style={{ marginTop: 5, fontSize: 9, color: "#475569" }}>
            Free tier: 4 req/min · 500 req/day ·{" "}
            <span style={{ color: "#38bdf8", cursor: "pointer" }}
              onClick={() => window.open("https://www.virustotal.com/gui/join-us", "_blank")}>
              Get a free key at virustotal.com ↗
            </span>
          </div>
        </SettingsField>

        <SettingsField
          label={<>AbuseIPDB API Key <KeyStatusDot masked={ti.abuseipdb_api_key} /></>}
          hint={ti.abuseipdb_api_key ? `Currently set: ${ti.abuseipdb_api_key}` : "Not configured"}
        >
          <input
            type="password" placeholder={ti.abuseipdb_api_key ? "Enter new key to replace…" : "Paste your API key…"}
            value={abKey} onChange={(e) => setAbKey(e.target.value)}
            style={INPUT_STYLE}
            autoComplete="new-password"
          />
          <div style={{ marginTop: 5, fontSize: 9, color: "#475569" }}>
            Free tier: 1 000 checks/day ·{" "}
            <span style={{ color: "#38bdf8", cursor: "pointer" }}
              onClick={() => window.open("https://www.abuseipdb.com/register", "_blank")}>
              Get a free key at abuseipdb.com ↗
            </span>
          </div>
        </SettingsField>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <button
            disabled={!wsReady || saving}
            onClick={() => handleSave("threat_intel")}
            style={{
              padding: "8px 20px", borderRadius: 7, border: "none", cursor: wsReady ? "pointer" : "not-allowed",
              background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff",
              fontSize: 11, fontWeight: 700, fontFamily: "inherit",
              opacity: wsReady ? 1 : 0.5,
            }}
          >
            {saving ? "Saving…" : "Save API Keys"}
          </button>
          <span style={{ fontSize: 10, color: "#475569" }}>
            {wsReady ? "Keys are stored locally only." : "Backend offline"}
          </span>
        </div>
      </SettingsSection>

      {/* ── Alert Thresholds ─────────────────────────────────────── */}
      <SettingsSection title="ALERT THRESHOLDS">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SettingsField label="Bandwidth alert threshold (MB/hr)" hint="per app">
            <input
              type="number" min={1} max={10000}
              value={alerts.bandwidth_threshold_mb ?? 100}
              onChange={(e) => set("alerts", "bandwidth_threshold_mb", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
          <SettingsField label="Poll interval (seconds)" hint="1–10">
            <input
              type="number" min={1} max={10} step={0.5}
              value={alerts.poll_interval_seconds ?? 1}
              onChange={(e) => set("alerts", "poll_interval_seconds", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
        </div>
        <SaveRow onSave={() => handleSave("alerts")} wsReady={wsReady} saving={saving} />
      </SettingsSection>

      {/* ── Display Settings ─────────────────────────────────────── */}
      <SettingsSection title="DISPLAY SETTINGS">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SettingsField label="Max connections shown" hint="per poll">
            <input
              type="number" min={10} max={1000}
              value={display.max_connections_shown ?? 100}
              onChange={(e) => set("display", "max_connections_shown", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
          <SettingsField label="Max apps shown" hint="per poll">
            <input
              type="number" min={5} max={200}
              value={display.max_apps_shown ?? 30}
              onChange={(e) => set("display", "max_apps_shown", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
        </div>
        <SaveRow onSave={() => handleSave("display")} wsReady={wsReady} saving={saving} />
      </SettingsSection>

      {/* ── Data Retention ───────────────────────────────────────── */}
      <SettingsSection title="DATA RETENTION">
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14, lineHeight: 1.7 }}>
          Configure how long historical data is kept in{" "}
          <code style={{ color: "#38bdf8", fontSize: 10 }}>data/history.db</code>.
          Cleanup runs on startup and then every 24 hours.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SettingsField label="Connection history (days)" hint="default 30">
            <input
              type="number" min={1} max={365}
              value={retention.connection_history_days ?? 30}
              onChange={(e) => set("retention", "connection_history_days", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
          <SettingsField label="Security event log (days)" hint="default 90">
            <input
              type="number" min={1} max={365}
              value={retention.event_log_days ?? 90}
              onChange={(e) => set("retention", "event_log_days", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
          <SettingsField label="Traffic log (days)" hint="default 30">
            <input
              type="number" min={1} max={365}
              value={retention.traffic_log_days ?? 30}
              onChange={(e) => set("retention", "traffic_log_days", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
          <SettingsField label="Alerts log (days)" hint="default 90">
            <input
              type="number" min={1} max={365}
              value={retention.alerts_days ?? 90}
              onChange={(e) => set("retention", "alerts_days", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
        </div>
        <SaveRow onSave={() => handleSave("retention")} wsReady={wsReady} saving={saving} />
      </SettingsSection>

      {/* ── Feed Management ──────────────────────────────────────── */}
      <SettingsSection title="THREAT FEED MANAGEMENT">
        {soarStats ? (
          <>
            <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
              {[
                { label: "TOTAL INDICATORS", value: soarStats.total_indicators?.toLocaleString() ?? "—", color: "#38bdf8" },
                { label: "EXACT IPs",         value: soarStats.exact_ips?.toLocaleString()         ?? "—", color: "#a78bfa" },
                { label: "CIDR RANGES",       value: soarStats.cidr_ranges?.toLocaleString()       ?? "—", color: "#fb923c" },
                { label: "FEEDS LOADED",      value: feeds.length,                                          color: "#4ade80" },
              ].map((s) => (
                <div key={s.label} style={{
                  flex: 1, minWidth: 110, padding: "10px 14px", borderRadius: 8,
                  background: `${s.color}0d`, border: `1px solid ${s.color}22`,
                }}>
                  <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.2, marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {feeds.length > 0 && (
              <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(56,189,248,0.08)", marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ background: "rgba(56,189,248,0.04)" }}>
                      {["Feed", "Indicators", "Type", "Last Updated"].map((h) => (
                        <th key={h} style={{
                          padding: "8px 12px", textAlign: "left", fontSize: 9,
                          letterSpacing: 1.2, color: "#64748b", fontWeight: 600,
                          borderBottom: "1px solid rgba(56,189,248,0.06)",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {feeds.map((f, i) => (
                      <tr key={i} style={{
                        background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                        borderBottom: "1px solid rgba(255,255,255,0.03)",
                      }}>
                        <td style={{ padding: "8px 12px", fontWeight: 600, color: "#e2e8f0" }}>
                          <span style={{ fontSize: 12, marginRight: 6 }}>
                            {f.count > 0 ? "✅" : "⚠️"}
                          </span>
                          {f.name}
                        </td>
                        <td style={{ padding: "8px 12px", color: "#38bdf8" }}>
                          {(f.count ?? 0).toLocaleString()}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{
                            padding: "2px 7px", borderRadius: 4, fontSize: 9,
                            background: "rgba(139,92,246,0.12)", color: "#a78bfa",
                          }}>
                            {f.type || "blocklist"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px", color: "#64748b", fontSize: 9 }}>
                          {f.updated_at || soarStats.loaded_at || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#475569", fontSize: 11, padding: "10px 0" }}>
            Threat intel engine not loaded — soar/ module may be missing.
          </div>
        )}

        <button
          disabled={!wsReady}
          onClick={onRefreshFeeds}
          style={{
            padding: "8px 20px", borderRadius: 7, border: "none",
            cursor: wsReady ? "pointer" : "not-allowed",
            background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)",
            color: "#38bdf8", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
            opacity: wsReady ? 1 : 0.5,
          }}
        >
          🔄 Update Feeds Now
        </button>
      </SettingsSection>

      {/* ── About ────────────────────────────────────────────────── */}
      <SettingsSection title="ABOUT FLOWSTATE">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "linear-gradient(135deg,#0ea5e9,#06b6d4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: "#0a0e17", fontWeight: 900,
            }}>⚡</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#38bdf8", letterSpacing: 1 }}>FLOWSTATE</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5 }}>
                v{FLOWSTATE_VERSION} · LOCAL NETWORK MONITOR
              </div>
            </div>
          </div>

          <div style={{
            padding: "12px 16px", borderRadius: 8,
            background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.12)",
            fontSize: 11, color: "#94a3b8", lineHeight: 1.8,
          }}>
            Made for the community — add your own API keys to enable live threat lookups.
            All monitoring is local. No data leaves your machine. Alert-only SOAR:
            nothing is blocked without your explicit confirmation.
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "⭐ GitHub", color: "#fbbf24" },
              { label: "📄 MIT License", color: "#4ade80" },
              { label: "🛡️ Alert-Only Mode", color: "#38bdf8" },
            ].map((b) => (
              <span key={b.label} style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                background: `${b.color}12`, border: `1px solid ${b.color}30`, color: b.color,
              }}>
                {b.label}
              </span>
            ))}
          </div>

          <div style={{ fontSize: 9, color: "#334155", marginTop: 4 }}>
            Stack: Python 3.10+ · psutil · websockets · React 18 · Vite · d3
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

// Small inline save row used inside threshold/display sections
function SaveRow({ onSave, wsReady, saving }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
      <button
        disabled={!wsReady || saving}
        onClick={onSave}
        style={{
          padding: "7px 18px", borderRadius: 7, border: "none",
          cursor: wsReady ? "pointer" : "not-allowed",
          background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff",
          fontSize: 11, fontWeight: 700, fontFamily: "inherit",
          opacity: wsReady ? 1 : 0.5,
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// STATUS BANNER
// ════════════════════════════════════════════════════════════════════
function StatusBanner({ status }) {
  if (status === "connected") return null;
  const isConnecting = status === "connecting";
  return (
    <div style={{
      padding: "8px 24px", fontSize: 11,
      background: isConnecting ? "rgba(251,191,36,0.08)" : "rgba(239,68,68,0.08)",
      borderBottom: `1px solid ${isConnecting ? "rgba(251,191,36,0.2)" : "rgba(239,68,68,0.2)"}`,
      color: isConnecting ? "#fbbf24" : "#ef4444",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <span>{isConnecting ? "⏳" : "⚠️"}</span>
      {isConnecting ? "Connecting to backend at ws://localhost:8765…" : "Disconnected — reconnecting every 3 s…"}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════
export default function NetMonitor() {
  const [tab, setTab] = useState("graph");
  const [history, setHistory] = useState([]);               // { sent, recv, time }
  const [apps, setApps] = useState([]);
  const [appHistory, setAppHistory] = useState({});         // 300 s per-app recv history
  const [totalSent, setTotalSent] = useState(0);
  const [totalRecv, setTotalRecv] = useState(0);
  const [blockedApps, setBlockedApps] = useState(new Set());
  const [alerts, setAlerts] = useState([]);
  const [connections, setConnections] = useState([]);
  const [threats, setThreats] = useState([]);               // [{ip,feed,category,severity,...}]
  const [soarStats, setSoarStats] = useState(null);         // engine metadata
  const [incidents, setIncidents] = useState([]);           // correlated incident list
  // Phase 3 — Response Engine
  const [pendingAction, setPendingAction] = useState(null); // confirmation modal
  const [auditLog, setAuditLog]           = useState([]);
  const [blocklist, setBlocklist]         = useState([]);
  const [blockedIps, setBlockedIps]       = useState([]);
  const [undoStack, setUndoStack]         = useState([]);
  const [toasts, setToasts]               = useState([]);
  // Phase 4 — Threat Intel API + Playbooks
  const [threatIntelCache, setThreatIntelCache] = useState({}); // ip → result dict
  const [lookupLoading, setLookupLoading]       = useState(new Set()); // IPs in-flight
  const [tiPanelIp, setTiPanelIp]               = useState(null);      // open TI panel
  const [playbooks, setPlaybooks]               = useState([]);         // loaded playbooks
  const [playbookActivity, setPlaybookActivity] = useState([]);         // execution log
  const [dryRunResults, setDryRunResults]       = useState({});         // name → {results, ts}
  const [dryRunLoading, setDryRunLoading]       = useState(null);       // pb name being tested
  const [settings, setSettings]           = useState({
    threat_intel: { virustotal_api_key: "", abuseipdb_api_key: "", auto_lookup_flagged: true, cache_ttl_hours: 24 },
    alerts:       { bandwidth_threshold_mb: 100, poll_interval_seconds: 1 },
    display:      { max_connections_shown: 100, max_apps_shown: 30 },
    retention:    { connection_history_days: 30, event_log_days: 90, traffic_log_days: 30, alerts_days: 90 },
  });
  const [newBlocklistIp, setNewBlocklistIp] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedApp, setSelectedApp] = useState(null);
  const [askToConnect, setAskToConnect] = useState(false);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [gateway, setGateway] = useState("");
  const [localIp, setLocalIp] = useState("");
  const [lanDevices, setLanDevices] = useState([]);
  const wsRef = useRef(null);
  const graphContainerRef = useRef(null);
  const graphWidth = useContainerWidth(graphContainerRef, 760);

  // ── WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    let ws, reconnectTimer, dead = false;

    function connect() {
      if (dead) return;
      setWsStatus("connecting");
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setWsStatus("connected");
        ws.send(JSON.stringify({ action: "get_settings" }));
      };

      ws.onmessage = ({ data: raw }) => {
        const data = JSON.parse(raw);

        // ── Settings responses ────────────────────────────────────────
        if (data.type === "settings_response") {
          setSettings(data.settings || {});
          return;
        }

        // ── Action results (targeted responses, not poll broadcasts) ──
        if (data.type === "action_result") {
          if (data.success) {
            addToast("success", data.details || `${data.action} completed`);
          } else {
            addToast("error", data.error || `${data.action} failed`);
          }
          return;
        }

        // ── Phase 4: Playbook dry run result ─────────────────────────
        if (data.type === "dry_run_result") {
          setDryRunLoading(null);
          const byName = {};
          (data.results || []).forEach((r) => { byName[r.playbook_name] = r; });
          setDryRunResults((prev) => ({
            ...prev,
            ...Object.fromEntries(
              Object.entries(byName).map(([k, v]) => [k, { results: [v], ts: Date.now() }])
            ),
          }));
          if (data.error) addToast("error", data.error);
          return;
        }

        // ── Phase 4: Threat Intel lookup result ───────────────────────
        if (data.type === "threat_intel_result") {
          const ip = data.ip;
          setThreatIntelCache((prev) => ({ ...prev, [ip]: data.result }));
          setLookupLoading((prev) => { const n = new Set(prev); n.delete(ip); return n; });
          if (data.result?.error) {
            addToast("error", `Lookup failed for ${ip}: ${data.result.error}`);
          } else {
            addToast("success", `Threat intel ready for ${ip}`);
          }
          return;
        }

        const liveApps = data.apps.map((app) => ({ ...app, icon: getAppIcon(app.name) }));
        setApps(liveApps);
        setBlockedApps(new Set(liveApps.filter((a) => a.blocked).map((a) => a.name)));
        setTotalSent((p) => p + (data.total_sent || 0));
        setTotalRecv((p) => p + (data.total_recv || 0));

        // Rolling 2-min history for the graph
        setHistory(prev => [...prev.slice(-119), {recv: data.total_recv, sent: data.total_sent, time: Date.now()}]);

        // Per-app history: keep 300 samples (5 min at 1 Hz)
        setAppHistory((prev) => {
          const next = { ...prev };
          liveApps.forEach((app) => {
            const arr = next[app.name] ? [...next[app.name]] : [];
            arr.push(app.recv || 0);
            next[app.name] = arr.length > 300 ? arr.slice(-300) : arr;
          });
          return next;
        });

        setConnections(data.connections || []);
        setAlerts(data.alerts || []);
        setThreats(data.threats || []);
        if (data.soar_stats) setSoarStats(data.soar_stats);
        if (data.incidents !== undefined) setIncidents(data.incidents || []);
        if (data.audit_log  !== undefined) setAuditLog(data.audit_log   || []);
        if (data.blocklist  !== undefined) setBlocklist(data.blocklist   || []);
        if (data.blocked_ips !== undefined) setBlockedIps(data.blocked_ips || []);
        if (data.undo_stack !== undefined) setUndoStack(data.undo_stack  || []);
        if (data.gateway !== undefined) setGateway(data.gateway || "");
        if (data.local_ip !== undefined) setLocalIp(data.local_ip || "");
        if (data.lan_devices !== undefined) setLanDevices(data.lan_devices || []);
        if (data.playbooks          !== undefined) setPlaybooks(data.playbooks || []);
        if (data.playbook_activity  !== undefined) setPlaybookActivity(data.playbook_activity || []);
        // Merge any inline threat_intel results from connections into cache
        if (data.connections) {
          const incoming = {};
          data.connections.forEach((c) => {
            if (c.remote && c.threat_intel) incoming[c.remote] = c.threat_intel;
          });
          if (Object.keys(incoming).length > 0) {
            setThreatIntelCache((prev) => ({ ...prev, ...incoming }));
          }
        }
      };

      ws.onclose = () => { if (!dead) { setWsStatus("disconnected"); reconnectTimer = setTimeout(connect, 3000); } };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { dead = true; clearTimeout(reconnectTimer); if (ws) ws.close(); };
  }, []);

  const toggleBlock = (name) => {
    const isBlocked = blockedApps.has(name);
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ action: isBlocked ? "unblock" : "block", app: name }));
    setBlockedApps((prev) => { const n = new Set(prev); isBlocked ? n.delete(name) : n.add(name); return n; });
  };

  const acknowledgeIncident = (id) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ action: "acknowledge_incident", id }));
    setIncidents((prev) =>
      prev.map((i) => i.id === id && i.status === "OPEN" ? { ...i, status: "ACKNOWLEDGED" } : i)
    );
  };

  const resolveIncident = (id) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ action: "resolve_incident", id }));
    setIncidents((prev) =>
      prev.map((i) => i.id === id && i.status !== "RESOLVED" ? { ...i, status: "RESOLVED" } : i)
    );
  };

  // ── Response Engine action helpers ──────────────────────────────────
  // triggerAction opens the confirmation modal.
  // The 6th arg `dangerous` marks non-reversible actions (kill, etc.)
  const triggerAction = (action, params, title, description, command = "", dangerous = false) => {
    setPendingAction({ action, params, title, description, command, dangerous });
  };

  const confirmAction = () => {
    if (!pendingAction) return;
    const { action, params } = pendingAction;
    const cmd = { action, ...params, confirm: true };
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(cmd));
    setPendingAction(null);
  };

  const cancelAction = () => setPendingAction(null);

  const addToast = (type, message) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  };

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const saveSettings = (partialSettings) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "save_settings", settings: partialSettings, confirm: true }));
  };

  const refreshFeeds = () => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "refresh_feeds" }));
  };

  // Phase 4 — send a manual IP lookup request to the backend
  const sendLookup = (ip) => {
    if (!ip || wsRef.current?.readyState !== WebSocket.OPEN) return;
    setLookupLoading((prev) => new Set([...prev, ip]));
    wsRef.current.send(JSON.stringify({ action: "lookup_ip", ip }));
  };

  const toggleTiPanel = (ip) => {
    setTiPanelIp((prev) => (prev === ip ? null : ip));
  };

  const togglePlaybook = (name, enabled) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "toggle_playbook", name, enabled }));
    setPlaybooks((prev) => prev.map((pb) => pb.name === name ? { ...pb, enabled } : pb));
  };

  const dryRunPlaybook = (name) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    setDryRunLoading(name || "all");
    wsRef.current.send(JSON.stringify({ action: "dry_run_playbook", name: name || null }));
  };

  const savePlaybook = (yaml, filename) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "save_playbook", yaml, filename, confirm: true }));
  };

  const deletePlaybook = (name) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "delete_playbook", name, confirm: true }));
  };

  const reloadPlaybooks = () => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "reload_playbooks" }));
  };

  // Smoothed rates: average last 5 polls to avoid 0-spike display
  const smoothRate = (field) => {
    if (history.length === 0) return 0;
    const s = history.slice(-5);
    return s.reduce((acc, h) => acc + (h[field] || 0), 0) / s.length;
  };

  const filteredApps = apps.filter((a) => a.name.toLowerCase().includes(searchFilter.toLowerCase()));
  const filteredConns = selectedApp ? connections.filter((c) => c.app === selectedApp) : connections;
  const severityColor = { info: "#38bdf8", warning: "#fbbf24", danger: "#ef4444" };
  const severityBg = { info: "rgba(56,189,248,0.1)", warning: "rgba(251,191,36,0.1)", danger: "rgba(239,68,68,0.1)" };
  const wsStatusColor = { connecting: "#fbbf24", connected: "#22c55e", disconnected: "#ef4444" }[wsStatus];

  const threatCount = threats.length;
  const openIncidentCount = incidents.filter((i) => i.status === "OPEN").length;
  const criticalIncidentCount = incidents.filter((i) => i.status === "OPEN" && i.severity === "CRITICAL").length;

  const _dlRate = formatRateDetailed(smoothRate("recv"));
  const _ulRate = formatRateDetailed(smoothRate("sent"));
  const statCards = [
    { label: "DOWNLOAD RATE", value: _dlRate.main, rateSub: _dlRate.sub, color: "#38bdf8", bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.12)", trend: <TrendBadge history={history} field="recv" /> },
    { label: "UPLOAD RATE", value: _ulRate.main, rateSub: _ulRate.sub, color: "#fb923c", bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.12)", trend: <TrendBadge history={history} field="sent" /> },
    { label: "ACTIVE APPS", value: apps.filter((a) => !blockedApps.has(a.name)).length, color: "#a78bfa", bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.12)", trend: null },
    { label: "CONNECTIONS", value: connections.length, color: "#4ade80", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.12)", trend: null },
    {
      label: "THREATS",
      value: threatCount,
      color: threatCount > 0 ? "#ef4444" : "#334155",
      bg: threatCount > 0 ? "rgba(239,68,68,0.10)" : "rgba(51,65,85,0.06)",
      border: threatCount > 0 ? "rgba(239,68,68,0.25)" : "rgba(51,65,85,0.12)",
      trend: soarStats
        ? <div style={{ fontSize: 9, color: "#475569", marginTop: 4 }}>{(soarStats.total_indicators || 0).toLocaleString()} indicators loaded</div>
        : <div style={{ fontSize: 9, color: "#334155", marginTop: 4 }}>no feeds loaded</div>,
    },
    {
      label: "INCIDENTS",
      value: openIncidentCount,
      color: criticalIncidentCount > 0 ? "#ef4444" : openIncidentCount > 0 ? "#fbbf24" : "#334155",
      bg:    criticalIncidentCount > 0 ? "rgba(239,68,68,0.10)" : openIncidentCount > 0 ? "rgba(251,191,36,0.08)" : "rgba(51,65,85,0.06)",
      border: criticalIncidentCount > 0 ? "rgba(239,68,68,0.25)" : openIncidentCount > 0 ? "rgba(251,191,36,0.2)" : "rgba(51,65,85,0.12)",
      trend: <div style={{ fontSize: 9, color: "#475569", marginTop: 4 }}>
        {criticalIncidentCount > 0 ? `${criticalIncidentCount} CRITICAL` : openIncidentCount > 0 ? "open incidents" : "all clear"}
      </div>,
    },
  ];

  const tabs = [
    { id: "graph",       label: "📈 TRAFFIC" },
    { id: "analytics",   label: "📊 ANALYTICS" },
    { id: "map",         label: "🗺️ MAP" },
    { id: "firewall",    label: "🛡️ FIREWALL" },
    { id: "connections", label: "🔗 CONNECTIONS" },
    { id: "alerts",      label: `🔔 ALERTS${alerts.filter((a) => a.severity !== "info").length ? ` (${alerts.filter((a) => a.severity !== "info").length})` : ""}` },
    { id: "incidents",   label: `🚨 INCIDENTS${openIncidentCount ? ` (${openIncidentCount})` : ""}` },
    { id: "playbooks",   label: `📋 PLAYBOOKS${playbooks.length ? ` (${playbooks.length})` : ""}` },
    { id: "audit",       label: `🗒️ AUDIT${auditLog.length ? ` (${auditLog.length})` : ""}` },
    { id: "settings",    label: "⚙️ SETTINGS" },
  ];

  return (
    <div style={{ fontFamily: "'JetBrains Mono','Fira Code','SF Mono',monospace", background: "#060a12", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── HEADER ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid rgba(56,189,248,0.1)", background: "linear-gradient(180deg,rgba(56,189,248,0.04) 0%,transparent 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#0ea5e9,#06b6d4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#0a0e17", boxShadow: "0 0 20px rgba(14,165,233,0.3)" }}>⚡</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.5, color: "#38bdf8" }}>FLOWSTATE</div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 2 }}>LOCAL NETWORK MONITOR</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>TOTAL SESSION</div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: "#38bdf8" }}>↓ {formatBytes(totalRecv)}</span>
              <span style={{ margin: "0 8px", color: "#334155" }}>|</span>
              <span style={{ color: "#fb923c" }}>↑ {formatBytes(totalSent)}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: wsStatusColor, boxShadow: `0 0 8px ${wsStatusColor}`, animation: wsStatus === "connected" ? "pulse 2s infinite" : "none" }} />
            <div style={{ fontSize: 8, color: "#475569", letterSpacing: 0.5 }}>{wsStatus.toUpperCase()}</div>
          </div>
        </div>
      </div>

      <StatusBanner status={wsStatus} />

      {/* ── TAB BAR ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(56,189,248,0.08)", background: "#080c16" }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "10px 18px", background: tab === t.id ? "rgba(56,189,248,0.08)" : "transparent",
            border: "none", borderBottom: tab === t.id ? "2px solid #38bdf8" : "2px solid transparent",
            color: tab === t.id ? "#38bdf8" : "#64748b", fontSize: 11, fontWeight: 600, letterSpacing: 1.2,
            cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, padding: 20, overflow: "auto" }}>

        {/* ══ TRAFFIC TAB ══════════════════════════════════════════ */}
        {tab === "graph" && (
          <div>
            {/* Stat cards */}
            <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              {statCards.map((card) => (
                <div key={card.label} style={{ flex: 1, padding: "14px 18px", borderRadius: 10, background: `linear-gradient(135deg,${card.bg},${card.bg.replace("0.08","0.02")})`, border: `1px solid ${card.border}` }}>
                  <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 4 }}>{card.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
                  {card.rateSub && <div style={{ fontSize: 9, color: `${card.color}88`, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{card.rateSub}</div>}
                  {card.trend}
                </div>
              ))}
            </div>

            {/* Real-time traffic graph */}
            <div ref={graphContainerRef} style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#0a0e17", padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>REAL-TIME TRAFFIC <span style={{ color: "#475569", fontWeight: 400 }}>(last 2 min)</span></div>
                <div style={{ display: "flex", gap: 16, fontSize: 10 }}>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#38bdf8", marginRight: 4 }} />Download</span>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#fb923c", marginRight: 4 }} />Upload</span>
                </div>
              </div>
              <TrafficGraph history={history} width={graphWidth} height={260} />
            </div>

            {/* Per-app bandwidth bars with drill-in */}
            <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#0a0e17", padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1, marginBottom: 12 }}>
                TOP APPS BY BANDWIDTH <span style={{ color: "#475569", fontWeight: 400 }}>(solid = download, faded = upload)</span>
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
            <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#0a0e17", padding: 16, marginBottom: 0 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1, marginBottom: 12 }}>
                GLOBAL CONNECTION MAP <span style={{ color: "#475569", fontWeight: 400 }}>(dot size = bandwidth · hover for details · click to inspect)</span>
              </div>
              <GlobalConnectionMap connections={connections} apps={apps} />
            </div>
          </div>
        )}

        {/* ══ ANALYTICS TAB ════════════════════════════════════════ */}
        {tab === "analytics" && (
          <div>
            {/* ── 1. Summary stat cards ─────────────────────────── */}
            <AnalyticsSummary apps={apps} connections={connections} />

            {/* ── 2. Bandwidth distribution + top hosts ─────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              {/* Donut chart */}
              <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: "18px 20px" }}>
                <SectionHeader
                  title="BANDWIDTH DISTRIBUTION"
                  desc="Share of total bandwidth consumed by each app (hover slices or legend to highlight)" />
                <DonutChart apps={apps} />
              </div>

              {/* Top destinations compact list */}
              <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: "18px 20px" }}>
                <SectionHeader
                  title="TOP DESTINATIONS"
                  desc="Most-connected remote hosts across all apps right now" />
                {connections.length === 0 ? (
                  <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>Waiting for connection data…</div>
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
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
                            <span style={{ color: "#38bdf8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }} title={host}>{host}</span>
                            <span style={{ color: "#64748b" }}>{info.count} conn{info.count !== 1 ? "s" : ""}</span>
                          </div>
                          <div style={{ height: 5, background: "#0f1422", borderRadius: 3, overflow: "hidden" }}>
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
              <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: 16, overflow: "visible" }}>
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
              <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: 16 }}>
                <TreemapChart apps={apps} />
              </div>
            </div>
          </div>
        )}

        {/* ══ NETWORK MAP TAB ══════════════════════════════════════ */}
        {tab === "map" && (
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>
                NETWORK TOPOLOGY <span style={{ color: "#475569", fontWeight: 400 }}>— LAN · Router/Gateway · Internet</span>
              </div>
              {gateway && (
                <div style={{ fontSize: 10, color: "#475569" }}>
                  GW: <span style={{ color: "#f59e0b" }}>{gateway}</span>
                  {localIp && <> · PC: <span style={{ color: "#38bdf8" }}>{localIp}</span></>}
                  {lanDevices.length > 0 && <> · {lanDevices.length} ARP device{lanDevices.length !== 1 ? "s" : ""}</>}
                </div>
              )}
            </div>
            <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: 16 }}>
              <NetworkMap gateway={gateway} localIp={localIp} lanDevices={lanDevices} connections={connections} apps={apps} />
            </div>
          </div>
        )}

        {/* ══ FIREWALL TAB ═════════════════════════════════════════ */}
        {tab === "firewall" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: "linear-gradient(135deg,rgba(251,146,60,0.06),transparent)", border: "1px solid rgba(251,146,60,0.1)" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Ask to Connect Mode</div>
                <div style={{ fontSize: 10, color: "#64748b" }}>Prompt before new apps access the network</div>
              </div>
              <button onClick={() => setAskToConnect(!askToConnect)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: askToConnect ? "#22c55e" : "#334155", color: askToConnect ? "#0a0e17" : "#94a3b8", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: askToConnect ? "0 0 12px rgba(34,197,94,0.3)" : "none" }}>
                {askToConnect ? "ENABLED" : "DISABLED"}
              </button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <input type="text" placeholder="Search apps..." value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)}
                style={{ width: "100%", padding: "8px 14px", borderRadius: 8, background: "#0f1422", border: "1px solid rgba(56,189,248,0.1)", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            </div>
            {filteredApps.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>{apps.length === 0 ? "Waiting for data…" : "No apps match."}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filteredApps.map((app) => (
                  <div key={app.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ fontSize: 22 }}>{app.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{app.name}</div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>PID: {app.pid} · {app.connections} conns · ↓ {formatRate(app.recv)} · ↑ {formatRate(app.sent)}</div>
                    </div>
                    <Sparkline data={(appHistory[app.name] || []).slice(-60)} color={blockedApps.has(app.name) ? "#ef4444" : "#38bdf8"} w={60} h={40} />
                    {app.pid > 0 && (
                      <ActionBtn icon="☠️" label="Kill" color="#fb923c"
                        onClick={() => triggerAction(
                          "kill_process", { pid: app.pid, name: app.name },
                          `Kill Process: ${app.name}`,
                          `Terminate ${app.name} (PID ${app.pid}) immediately using taskkill /F.`,
                          `taskkill /PID ${app.pid} /F`,
                          true,
                        )}
                      />
                    )}
                    <button onClick={() => toggleBlock(app.name)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: blockedApps.has(app.name) ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", color: blockedApps.has(app.name) ? "#ef4444" : "#4ade80", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minWidth: 80 }}>
                      {blockedApps.has(app.name) ? "🚫 BLOCKED" : "✓ ALLOW"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Blocklist Manager ─────────────────────────────── */}
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: 1.5, marginBottom: 12 }}>BLOCKLIST MANAGER</div>

              {/* Session netsh blocks */}
              {blockedIps.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1, marginBottom: 8 }}>
                    ACTIVE IP BLOCKS (this session — Windows Firewall rules)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {blockedIps.map((ip) => (
                      <div key={ip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderRadius: 8, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                        <span style={{ color: "#ef4444", fontSize: 12 }}>🚫</span>
                        <span style={{ flex: 1, fontSize: 11, fontVariantNumeric: "tabular-nums", color: "#fca5a5" }}>{ip}</span>
                        <ActionBtn icon="✅" label="Unblock" color="#4ade80"
                          onClick={() => triggerAction(
                            "unblock_ip", { ip },
                            `Unblock IP ${ip}`,
                            `Remove Windows Firewall rules for ${ip}. Traffic to/from this IP will be permitted again.`,
                            `netsh advfirewall firewall delete rule name="FlowState Block OUT ${ip}"`,
                            false,
                          )}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Persistent blocklist */}
              <div>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1, marginBottom: 8 }}>
                  PERSISTENT BLOCKLIST (data/blocklist.txt — {blocklist.length} entries)
                </div>
                {blocklist.length === 0 ? (
                  <div style={{ color: "#334155", fontSize: 11, padding: "10px 0" }}>No IPs in blocklist.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
                    {blocklist.map((ip) => (
                      <div key={ip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 7, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <span style={{ flex: 1, fontSize: 11, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{ip}</span>
                        <ActionBtn icon="🚫" label="Block Now" color="#ef4444"
                          onClick={() => triggerAction(
                            "block_ip", { ip },
                            `Block IP ${ip}`,
                            `Add Windows Firewall rules to block all traffic to/from ${ip}.`,
                            `netsh advfirewall firewall add rule name="FlowState Block OUT ${ip}" dir=out action=block remoteip=${ip}`,
                            false,
                          )}
                        />
                        <ActionBtn icon="🗑️" label="Remove" color="#64748b"
                          onClick={() => triggerAction(
                            "remove_blocklist", { ip },
                            `Remove ${ip} from Blocklist`,
                            `Remove ${ip} from data/blocklist.txt. This does not remove any existing firewall rules.`,
                            `remove ${ip} from data/blocklist.txt`,
                            false,
                          )}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Add to blocklist form */}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text" placeholder="IP address (e.g. 1.2.3.4)"
                    value={newBlocklistIp} onChange={(e) => setNewBlocklistIp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newBlocklistIp.trim()) {
                        triggerAction("add_blocklist", { ip: newBlocklistIp.trim() },
                          `Add ${newBlocklistIp.trim()} to Blocklist`,
                          `Append ${newBlocklistIp.trim()} to data/blocklist.txt for persistent tracking.`,
                          `echo ${newBlocklistIp.trim()} >> data/blocklist.txt`, false);
                        setNewBlocklistIp("");
                      }
                    }}
                    style={{ flex: 1, padding: "7px 12px", borderRadius: 7, background: "#0f1422", border: "1px solid rgba(56,189,248,0.12)", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", outline: "none" }}
                  />
                  <ActionBtn icon="+" label="Add to Blocklist" color="#a78bfa"
                    onClick={() => {
                      if (!newBlocklistIp.trim()) return;
                      triggerAction("add_blocklist", { ip: newBlocklistIp.trim() },
                        `Add ${newBlocklistIp.trim()} to Blocklist`,
                        `Append ${newBlocklistIp.trim()} to data/blocklist.txt.`,
                        `echo ${newBlocklistIp.trim()} >> data/blocklist.txt`, false);
                      setNewBlocklistIp("");
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ CONNECTIONS TAB ══════════════════════════════════════ */}
        {tab === "connections" && (
          <div>
            {/* App filter buttons + threat summary banner */}
            <div style={{ display: "flex", gap: 8, marginBottom: threatCount > 0 ? 10 : 16, flexWrap: "wrap" }}>
              <button onClick={() => setSelectedApp(null)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: !selectedApp ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)", color: !selectedApp ? "#38bdf8" : "#94a3b8", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>ALL</button>
              {[...new Set(connections.map((c) => c.app))].map((app) => (
                <button key={app} onClick={() => setSelectedApp(app === selectedApp ? null : app)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: selectedApp === app ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)", color: selectedApp === app ? "#38bdf8" : "#94a3b8", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{app}</button>
              ))}
            </div>

            {/* Threat summary banner — only shown when threats are present */}
            {threatCount > 0 && (
              <div style={{
                marginBottom: 14, padding: "10px 14px", borderRadius: 8,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              }}>
                <span style={{ fontSize: 13 }}>⚠</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>
                  {threatCount} flagged connection{threatCount !== 1 ? "s" : ""}
                </span>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>
                  — matched against threat intelligence feeds. Alert-only mode: no traffic has been blocked.
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
                  {[...new Set(threats.map((t) => t.feed))].map((f) => (
                    <span key={f} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>{f}</span>
                  ))}
                </div>
              </div>
            )}

            {connections.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>Waiting for connection data…</div>
            ) : (
              <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(56,189,248,0.08)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "rgba(56,189,248,0.04)" }}>
                      {["App","Remote Host","IP Address","Port","Protocol","Status","Threat","Actions"].map((h) => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: h === "Threat" ? "#ef4444" : h === "Actions" ? "#a78bfa" : "#64748b", fontWeight: 600, borderBottom: "1px solid rgba(56,189,248,0.06)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredConns.map((c, i) => {
                      const isThreat = Boolean(c.threat);
                      const tiResult  = threatIntelCache[c.remote];
                      const tiScore   = tiResult?.risk_score ?? -1;
                      const tiActive  = tiPanelIp === c.remote;
                      // Row tint from TI score (overrides threat tint when higher confidence)
                      let rowBg = isThreat ? "rgba(239,68,68,0.06)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)";
                      let rowBorder = isThreat ? "1px solid rgba(239,68,68,0.15)" : "1px solid rgba(255,255,255,0.03)";
                      if (tiScore >= 70) { rowBg = "rgba(239,68,68,0.10)"; rowBorder = "1px solid rgba(239,68,68,0.25)"; }
                      else if (tiScore >= 40) { rowBg = "rgba(251,146,60,0.08)"; rowBorder = "1px solid rgba(251,146,60,0.2)"; }
                      else if (tiScore >= 15) { rowBg = "rgba(251,191,36,0.06)"; rowBorder = "1px solid rgba(251,191,36,0.15)"; }
                      return (
                        <tr key={i} style={{ background: rowBg, borderBottom: rowBorder }}>
                          <td style={{ padding: "8px 12px", fontWeight: 600, color: isThreat ? "#fca5a5" : undefined }}>{c.app}</td>
                          <td style={{ padding: "8px 12px", color: isThreat ? "#fca5a5" : "#38bdf8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.host}>{c.host}</td>
                          <td style={{ padding: "8px 12px", color: isThreat ? "#ef4444" : "#94a3b8", fontWeight: isThreat ? 700 : 400 }}>{c.remote}</td>
                          <td style={{ padding: "8px 12px" }}>{c.port}</td>
                          <td style={{ padding: "8px 12px" }}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>{c.protocol}</span></td>
                          <td style={{ padding: "8px 12px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.status === "ESTABLISHED" ? "#22c55e" : "#fbbf24" }} />
                              <span style={{ fontSize: 10, color: c.status === "ESTABLISHED" ? "#4ade80" : "#fbbf24" }}>{c.status}</span>
                            </span>
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            {isThreat
                              ? <ThreatBadge threat={c.threat} compact />
                              : tiScore >= 0
                                ? <span style={{ fontSize: 9, color: riskColor(tiScore).color, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: riskColor(tiScore).bg }}>{riskColor(tiScore).label}</span>
                                : <span style={{ color: "#1e293b", fontSize: 9 }}>—</span>
                            }
                          </td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", gap: 4 }}>
                              {c.remote && c.remote !== "N/A" && (
                                <ActionBtn icon="🚫" label="Block" color="#ef4444"
                                  title={`Block IP ${c.remote}`}
                                  onClick={() => triggerAction(
                                    "block_ip", { ip: c.remote },
                                    `Block IP ${c.remote}`,
                                    `Add Windows Firewall rules to block all inbound and outbound traffic to/from ${c.remote} (${c.app}).`,
                                    `netsh advfirewall firewall add rule name="FlowState Block ${c.remote}" dir=out action=block remoteip=${c.remote}`,
                                    true
                                  )}
                                />
                              )}
                              {c.pid && (
                                <ActionBtn icon="☠️" label="Kill" color="#fb923c"
                                  title={`Kill process ${c.app} (PID ${c.pid})`}
                                  onClick={() => triggerAction(
                                    "kill_process", { pid: c.pid, name: c.app },
                                    `Kill Process ${c.app}`,
                                    `Terminate process "${c.app}" (PID ${c.pid}) immediately with taskkill /F. All open connections from this process will be closed. This cannot be undone.`,
                                    `taskkill /PID ${c.pid} /F`,
                                    true
                                  )}
                                />
                              )}
                              <ActionBtn icon="📸" label="Snap" color="#38bdf8"
                                title="Capture network snapshot"
                                onClick={() => triggerAction(
                                  "capture_snapshot", {},
                                  "Capture Network Snapshot",
                                  "Save current connection state and process list to data/snapshots/{timestamp}.json for forensic review.",
                                  "Save snapshot to data/snapshots/",
                                  false
                                )}
                              />
                              {c.remote && c.remote !== "N/A" && (
                                <LookupBtn
                                  ip={c.remote}
                                  loading={lookupLoading.has(c.remote)}
                                  cached={Boolean(tiResult)}
                                  onClick={() => {
                                    if (!tiResult) sendLookup(c.remote);
                                    toggleTiPanel(c.remote);
                                  }}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ══ ALERTS TAB ═══════════════════════════════════════════ */}
        {tab === "alerts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>No alerts yet.</div>
            ) : (
              [...alerts].reverse().map((a, i) => (
                <div key={i} style={{ padding: "12px 16px", borderRadius: 10, background: severityBg[a.severity] || severityBg.info, border: `1px solid ${(severityColor[a.severity] || severityColor.info)}22`, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: severityColor[a.severity] || severityColor.info, boxShadow: `0 0 8px ${severityColor[a.severity] || severityColor.info}` }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{a.message}</div>
                    <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{a.type.toUpperCase()} · {a.time}</div>
                  </div>
                  <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: `${(severityColor[a.severity] || severityColor.info)}22`, color: severityColor[a.severity] || severityColor.info, letterSpacing: 0.5 }}>
                    {(a.severity || "info").toUpperCase()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* ══ INCIDENTS TAB ════════════════════════════════════════ */}
        {tab === "incidents" && (
          <IncidentsTab
            incidents={incidents}
            onAcknowledge={acknowledgeIncident}
            onResolve={resolveIncident}
            onAction={triggerAction}
            apps={apps}
          />
        )}

        {/* ══ PLAYBOOKS TAB ════════════════════════════════════════ */}
        {tab === "playbooks" && (
          <PlaybooksTab
            playbooks={playbooks}
            incidents={incidents}
            playbookActivity={playbookActivity}
            dryRunResults={dryRunResults}
            dryRunLoading={dryRunLoading}
            onToggle={togglePlaybook}
            onDryRun={dryRunPlaybook}
            onSave={savePlaybook}
            onDelete={deletePlaybook}
            onReload={reloadPlaybooks}
            wsReady={wsStatus === "connected"}
          />
        )}

        {/* ══ AUDIT TAB ════════════════════════════════════════════ */}
        {tab === "audit" && (
          <AuditLogTab auditLog={auditLog} undoStack={undoStack} onAction={triggerAction} />
        )}

        {/* ══ SETTINGS TAB ═════════════════════════════════════════ */}
        {tab === "settings" && (
          <SettingsTab
            settings={settings}
            soarStats={soarStats}
            onSave={saveSettings}
            onRefreshFeeds={refreshFeeds}
            wsReady={wsStatus === "connected"}
          />
        )}
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <div style={{ padding: "8px 24px", borderTop: "1px solid rgba(56,189,248,0.06)", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", background: "#080c16" }}>
        <span>FLOWSTATE v1.0 · Local Network Monitor</span>
        <span>Backend: ws://localhost:8765 · Status: {wsStatus.toUpperCase()}</span>
      </div>

      {/* ── CONFIRMATION MODAL + TOASTS ───────────────────────────── */}
      <ConfirmModal pending={pendingAction} onConfirm={confirmAction} onCancel={cancelAction} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Phase 4 — Threat Intel Panel */}
      {tiPanelIp && (
        <ThreatIntelPanel
          ip={tiPanelIp}
          result={threatIntelCache[tiPanelIp]}
          onClose={() => setTiPanelIp(null)}
        />
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
        @keyframes toastIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.2); border-radius: 3px; }
      `}</style>
    </div>
  );
}
