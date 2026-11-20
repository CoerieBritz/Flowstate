import { useState, useEffect, useRef, useMemo } from "react";
import {
  forceSimulation, forceLink, forceManyBody,
  forceCollide, forceX, forceY,
} from "d3-force";
import { useContainerWidth } from "../../hooks/useContainerWidth";
import { formatRate } from "../../lib/format";

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

export function NetworkMap({ gateway, localIp, lanDevices, connections, apps }) {
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
          {!gateway ? "Waiting for topology data from backend… (requires flowstate_backend.py)" : "Building network map…"}
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
