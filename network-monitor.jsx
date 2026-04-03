import { useState, useEffect, useRef, useCallback } from "react";

// --- Simulated data for the UI preview ---
// In production, this connects to the Python backend via WebSocket

const MOCK_APPS = [
  { name: "chrome.exe", pid: 4521, icon: "🌐", sent: 0, recv: 0, connections: 12 },
  { name: "spotify.exe", pid: 2233, icon: "🎵", sent: 0, recv: 0, connections: 4 },
  { name: "discord.exe", pid: 7788, icon: "💬", sent: 0, recv: 0, connections: 8 },
  { name: "code.exe", pid: 1199, icon: "📝", sent: 0, recv: 0, connections: 3 },
  { name: "steam.exe", pid: 3344, icon: "🎮", sent: 0, recv: 0, connections: 6 },
  { name: "slack.exe", pid: 5566, icon: "📨", sent: 0, recv: 0, connections: 5 },
  { name: "outlook.exe", pid: 8899, icon: "📧", sent: 0, recv: 0, connections: 2 },
  { name: "node.exe", pid: 6677, icon: "⚙️", sent: 0, recv: 0, connections: 7 },
];

const MOCK_CONNECTIONS = [
  { app: "chrome.exe", remote: "142.250.80.46", host: "google.com", port: 443, protocol: "HTTPS", country: "US", flag: "🇺🇸", status: "ESTABLISHED" },
  { app: "chrome.exe", remote: "151.101.1.140", host: "reddit.com", port: 443, protocol: "HTTPS", country: "US", flag: "🇺🇸", status: "ESTABLISHED" },
  { app: "spotify.exe", remote: "35.186.224.25", host: "spclient.wg.spotify.com", port: 443, protocol: "HTTPS", country: "US", flag: "🇺🇸", status: "ESTABLISHED" },
  { app: "discord.exe", remote: "162.159.135.234", host: "gateway.discord.gg", port: 443, protocol: "WSS", country: "US", flag: "🇺🇸", status: "ESTABLISHED" },
  { app: "discord.exe", remote: "162.159.128.233", host: "cdn.discordapp.com", port: 443, protocol: "HTTPS", country: "US", flag: "🇺🇸", status: "ESTABLISHED" },
  { app: "code.exe", remote: "20.205.243.166", host: "github.com", port: 443, protocol: "HTTPS", country: "US", flag: "🇺🇸", status: "ESTABLISHED" },
  { app: "steam.exe", remote: "155.133.248.50", host: "store.steampowered.com", port: 443, protocol: "HTTPS", country: "NL", flag: "🇳🇱", status: "ESTABLISHED" },
  { app: "slack.exe", remote: "34.232.119.183", host: "slack.com", port: 443, protocol: "HTTPS", country: "US", flag: "🇺🇸", status: "ESTABLISHED" },
  { app: "node.exe", remote: "104.16.23.35", host: "registry.npmjs.org", port: 443, protocol: "HTTPS", country: "US", flag: "🇺🇸", status: "TIME_WAIT" },
  { app: "outlook.exe", remote: "52.96.165.130", host: "outlook.office365.com", port: 443, protocol: "HTTPS", country: "US", flag: "🇺🇸", status: "ESTABLISHED" },
];

const ALERTS = [
  { time: "14:32:05", type: "new_app", message: "node.exe connected to the network for the first time", severity: "info" },
  { time: "14:28:11", type: "suspicious", message: "Unknown process svchost_x.exe attempted outbound connection", severity: "warning" },
  { time: "14:15:44", type: "blocked", message: "Blocked telemetry.exe → 203.0.113.50:8080", severity: "danger" },
  { time: "13:58:22", type: "device", message: "New device joined network: 192.168.1.47 (Unknown)", severity: "warning" },
  { time: "13:45:00", type: "bandwidth", message: "steam.exe exceeded 500MB download in the last hour", severity: "info" },
];

function formatBytes(bytes) {
  if (bytes < 1024) return bytes.toFixed(0) + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

function formatRate(bytesPerSec) {
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + " B/s";
  if (bytesPerSec < 1048576) return (bytesPerSec / 1024).toFixed(1) + " KB/s";
  return (bytesPerSec / 1048576).toFixed(1) + " MB/s";
}

// === TRAFFIC GRAPH COMPONENT ===
function TrafficGraph({ history, width, height }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = "rgba(56, 189, 248, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const y = (height / 6) * i + 20;
      ctx.beginPath();
      ctx.moveTo(50, y);
      ctx.lineTo(width - 10, y);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const x = 50 + ((width - 60) / 12) * i;
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, height - 30);
      ctx.stroke();
    }

    if (history.length < 2) return;

    const maxVal = Math.max(
      ...history.map((h) => Math.max(h.sent, h.recv)),
      1024
    );
    const graphH = height - 60;
    const graphW = width - 60;
    const step = graphW / (history.length - 1);

    // Download fill
    ctx.beginPath();
    ctx.moveTo(50, height - 30);
    history.forEach((h, i) => {
      const x = 50 + i * step;
      const y = height - 30 - (h.recv / maxVal) * graphH;
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(50 + (history.length - 1) * step, height - 30);
    ctx.closePath();
    const dlGrad = ctx.createLinearGradient(0, 20, 0, height - 30);
    dlGrad.addColorStop(0, "rgba(56, 189, 248, 0.35)");
    dlGrad.addColorStop(1, "rgba(56, 189, 248, 0.02)");
    ctx.fillStyle = dlGrad;
    ctx.fill();

    // Download line
    ctx.beginPath();
    history.forEach((h, i) => {
      const x = 50 + i * step;
      const y = height - 30 - (h.recv / maxVal) * graphH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#38bdf8";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Upload fill
    ctx.beginPath();
    ctx.moveTo(50, height - 30);
    history.forEach((h, i) => {
      const x = 50 + i * step;
      const y = height - 30 - (h.sent / maxVal) * graphH;
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(50 + (history.length - 1) * step, height - 30);
    ctx.closePath();
    const ulGrad = ctx.createLinearGradient(0, 20, 0, height - 30);
    ulGrad.addColorStop(0, "rgba(251, 146, 60, 0.3)");
    ulGrad.addColorStop(1, "rgba(251, 146, 60, 0.02)");
    ctx.fillStyle = ulGrad;
    ctx.fill();

    // Upload line
    ctx.beginPath();
    history.forEach((h, i) => {
      const x = 50 + i * step;
      const y = height - 30 - (h.sent / maxVal) * graphH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#fb923c";
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Y-axis labels
    ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
      const val = (maxVal / 5) * (5 - i);
      const y = 20 + (graphH / 5) * i + 3;
      ctx.fillText(formatRate(val), 45, y);
    }

    // Glow dot at latest point
    const lastRecv = history[history.length - 1].recv;
    const lastSent = history[history.length - 1].sent;
    const lastX = 50 + (history.length - 1) * step;
    const lastYr = height - 30 - (lastRecv / maxVal) * graphH;
    const lastYs = height - 30 - (lastSent / maxVal) * graphH;

    ctx.beginPath();
    ctx.arc(lastX, lastYr, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#38bdf8";
    ctx.shadowColor = "#38bdf8";
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(lastX, lastYs, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#fb923c";
    ctx.shadowColor = "#fb923c";
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }, [history, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 8 }} />;
}

// === MINI SPARKLINE ===
function Sparkline({ data, color, w = 80, h = 24 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || data.length < 2) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...data, 1);
    const step = w / (data.length - 1);
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * step;
      const y = h - (v / max) * (h - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [data, color, w, h]);
  return <canvas ref={canvasRef} style={{ width: w, height: h }} />;
}

// === MAIN APP ===
export default function NetMonitor() {
  const [tab, setTab] = useState("graph");
  const [history, setHistory] = useState([]);
  const [apps, setApps] = useState(MOCK_APPS);
  const [appHistory, setAppHistory] = useState({});
  const [totalSent, setTotalSent] = useState(0);
  const [totalRecv, setTotalRecv] = useState(0);
  const [blockedApps, setBlockedApps] = useState(new Set());
  const [alerts, setAlerts] = useState(ALERTS);
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedApp, setSelectedApp] = useState(null);
  const [askToConnect, setAskToConnect] = useState(false);
  const tickRef = useRef(0);

  // Simulate live traffic data
  useEffect(() => {
    const iv = setInterval(() => {
      tickRef.current++;
      const t = tickRef.current;

      // Generate per-app traffic
      const newApps = apps.map((app) => {
        if (blockedApps.has(app.name)) return { ...app, sent: 0, recv: 0 };
        const base = app.name === "chrome.exe" ? 80000 : app.name === "steam.exe" ? 120000 : app.name === "spotify.exe" ? 40000 : 15000;
        const sent = Math.random() * base * 0.3 + base * 0.05;
        const recv = Math.random() * base + base * 0.2 + Math.sin(t * 0.1) * base * 0.3;
        return { ...app, sent, recv };
      });

      const totalS = newApps.reduce((a, b) => a + b.sent, 0);
      const totalR = newApps.reduce((a, b) => a + b.recv, 0);

      setApps(newApps);
      setTotalSent((p) => p + totalS);
      setTotalRecv((p) => p + totalR);

      setHistory((prev) => {
        const next = [...prev, { sent: totalS, recv: totalR, time: Date.now() }];
        return next.length > 120 ? next.slice(-120) : next;
      });

      setAppHistory((prev) => {
        const next = { ...prev };
        newApps.forEach((app) => {
          const arr = next[app.name] || [];
          arr.push(app.recv);
          next[app.name] = arr.length > 30 ? arr.slice(-30) : arr;
        });
        return next;
      });
    }, 500);
    return () => clearInterval(iv);
  }, [apps, blockedApps]);

  const toggleBlock = (name) => {
    setBlockedApps((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filteredApps = apps.filter((a) =>
    a.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const filteredConns = selectedApp
    ? MOCK_CONNECTIONS.filter((c) => c.app === selectedApp)
    : MOCK_CONNECTIONS;

  const severityColor = { info: "#38bdf8", warning: "#fbbf24", danger: "#ef4444" };
  const severityBg = { info: "rgba(56,189,248,0.1)", warning: "rgba(251,191,36,0.1)", danger: "rgba(239,68,68,0.1)" };

  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      background: "#060a12",
      color: "#e2e8f0",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* === HEADER === */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 24px",
        borderBottom: "1px solid rgba(56,189,248,0.1)",
        background: "linear-gradient(180deg, rgba(56,189,248,0.04) 0%, transparent 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: "linear-gradient(135deg, #0ea5e9, #06b6d4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 900, color: "#0a0e17",
            boxShadow: "0 0 20px rgba(14,165,233,0.3)",
          }}>⚡</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.5, color: "#38bdf8" }}>NETWATCH</div>
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
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#22c55e",
            boxShadow: "0 0 8px #22c55e",
            animation: "pulse 2s infinite",
          }} />
        </div>
      </div>

      {/* === TAB BAR === */}
      <div style={{
        display: "flex",
        gap: 0,
        borderBottom: "1px solid rgba(56,189,248,0.08)",
        background: "#080c16",
      }}>
        {[
          { id: "graph", label: "📈 TRAFFIC", },
          { id: "firewall", label: "🛡️ FIREWALL" },
          { id: "connections", label: "🔗 CONNECTIONS" },
          { id: "alerts", label: `🔔 ALERTS ${alerts.filter(a => a.severity !== 'info').length ? `(${alerts.filter(a => a.severity !== 'info').length})` : ''}` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 20px",
              background: tab === t.id ? "rgba(56,189,248,0.08)" : "transparent",
              border: "none",
              borderBottom: tab === t.id ? "2px solid #38bdf8" : "2px solid transparent",
              color: tab === t.id ? "#38bdf8" : "#64748b",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.2,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.2s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* === CONTENT === */}
      <div style={{ flex: 1, padding: 20, overflow: "auto" }}>

        {/* ---- TRAFFIC TAB ---- */}
        {tab === "graph" && (
          <div>
            <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              <div style={{
                flex: 1, padding: "14px 18px", borderRadius: 10,
                background: "linear-gradient(135deg, rgba(56,189,248,0.08), rgba(56,189,248,0.02))",
                border: "1px solid rgba(56,189,248,0.12)",
              }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 4 }}>DOWNLOAD RATE</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#38bdf8" }}>
                  {history.length ? formatRate(history[history.length - 1].recv) : "0 B/s"}
                </div>
              </div>
              <div style={{
                flex: 1, padding: "14px 18px", borderRadius: 10,
                background: "linear-gradient(135deg, rgba(251,146,60,0.08), rgba(251,146,60,0.02))",
                border: "1px solid rgba(251,146,60,0.12)",
              }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 4 }}>UPLOAD RATE</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#fb923c" }}>
                  {history.length ? formatRate(history[history.length - 1].sent) : "0 B/s"}
                </div>
              </div>
              <div style={{
                flex: 1, padding: "14px 18px", borderRadius: 10,
                background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(139,92,246,0.02))",
                border: "1px solid rgba(139,92,246,0.12)",
              }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 4 }}>ACTIVE APPS</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#a78bfa" }}>
                  {apps.filter((a) => !blockedApps.has(a.name)).length}
                </div>
              </div>
              <div style={{
                flex: 1, padding: "14px 18px", borderRadius: 10,
                background: "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02))",
                border: "1px solid rgba(34,197,94,0.12)",
              }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 4 }}>CONNECTIONS</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#4ade80" }}>
                  {MOCK_CONNECTIONS.length}
                </div>
              </div>
            </div>

            <div style={{
              borderRadius: 10,
              border: "1px solid rgba(56,189,248,0.08)",
              background: "#0a0e17",
              padding: 16,
              marginBottom: 16,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>REAL-TIME TRAFFIC</div>
                <div style={{ display: "flex", gap: 16, fontSize: 10 }}>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#38bdf8", marginRight: 4 }} />Download</span>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#fb923c", marginRight: 4 }} />Upload</span>
                </div>
              </div>
              <TrafficGraph history={history} width={760} height={260} />
            </div>

            {/* Per-app usage */}
            <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1, marginBottom: 10 }}>APP BANDWIDTH USAGE</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {apps.sort((a, b) => b.recv - a.recv).map((app) => (
                <div key={app.name} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", borderRadius: 8,
                  background: blockedApps.has(app.name) ? "rgba(239,68,68,0.05)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${blockedApps.has(app.name) ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)"}`,
                  opacity: blockedApps.has(app.name) ? 0.5 : 1,
                }}>
                  <span style={{ fontSize: 18 }}>{app.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: blockedApps.has(app.name) ? "#ef4444" : "#e2e8f0" }}>
                      {app.name} {blockedApps.has(app.name) && <span style={{ fontSize: 9, color: "#ef4444" }}>[BLOCKED]</span>}
                    </div>
                    <div style={{ fontSize: 9, color: "#64748b" }}>
                      ↓ {formatRate(app.recv)} · ↑ {formatRate(app.sent)}
                    </div>
                  </div>
                  <Sparkline data={appHistory[app.name] || []} color={blockedApps.has(app.name) ? "#ef4444" : "#38bdf8"} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- FIREWALL TAB ---- */}
        {tab === "firewall" && (
          <div>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 16, padding: "12px 16px", borderRadius: 10,
              background: "linear-gradient(135deg, rgba(251,146,60,0.06), transparent)",
              border: "1px solid rgba(251,146,60,0.1)",
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Ask to Connect Mode</div>
                <div style={{ fontSize: 10, color: "#64748b" }}>Prompt before new apps access the network</div>
              </div>
              <button
                onClick={() => setAskToConnect(!askToConnect)}
                style={{
                  padding: "6px 16px", borderRadius: 6, border: "none",
                  background: askToConnect ? "#22c55e" : "#334155",
                  color: askToConnect ? "#0a0e17" : "#94a3b8",
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                  fontFamily: "inherit", letterSpacing: 0.5,
                  boxShadow: askToConnect ? "0 0 12px rgba(34,197,94,0.3)" : "none",
                }}
              >
                {askToConnect ? "ENABLED" : "DISABLED"}
              </button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Search apps..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                style={{
                  width: "100%", padding: "8px 14px", borderRadius: 8,
                  background: "#0f1422", border: "1px solid rgba(56,189,248,0.1)",
                  color: "#e2e8f0", fontSize: 12, fontFamily: "inherit",
                  outline: "none", boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filteredApps.map((app) => (
                <div key={app.name} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 16px", borderRadius: 10,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  transition: "all 0.2s",
                }}>
                  <span style={{ fontSize: 22 }}>{app.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{app.name}</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>
                      PID: {app.pid} · {app.connections} connections · ↓ {formatRate(app.recv)} · ↑ {formatRate(app.sent)}
                    </div>
                  </div>
                  <Sparkline data={appHistory[app.name] || []} color={blockedApps.has(app.name) ? "#ef4444" : "#38bdf8"} w={60} h={20} />
                  <button
                    onClick={() => toggleBlock(app.name)}
                    style={{
                      padding: "6px 14px", borderRadius: 6, border: "none",
                      background: blockedApps.has(app.name) ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
                      color: blockedApps.has(app.name) ? "#ef4444" : "#4ade80",
                      fontSize: 10, fontWeight: 700, cursor: "pointer",
                      fontFamily: "inherit", letterSpacing: 0.5,
                      minWidth: 72,
                    }}
                  >
                    {blockedApps.has(app.name) ? "🚫 BLOCKED" : "✓ ALLOW"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- CONNECTIONS TAB ---- */}
        {tab === "connections" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <button
                onClick={() => setSelectedApp(null)}
                style={{
                  padding: "5px 12px", borderRadius: 6, border: "none",
                  background: !selectedApp ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)",
                  color: !selectedApp ? "#38bdf8" : "#94a3b8",
                  fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >ALL</button>
              {[...new Set(MOCK_CONNECTIONS.map(c => c.app))].map(app => (
                <button
                  key={app}
                  onClick={() => setSelectedApp(app === selectedApp ? null : app)}
                  style={{
                    padding: "5px 12px", borderRadius: 6, border: "none",
                    background: selectedApp === app ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)",
                    color: selectedApp === app ? "#38bdf8" : "#94a3b8",
                    fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  }}
                >{app}</button>
              ))}
            </div>

            <div style={{
              borderRadius: 10, overflow: "hidden",
              border: "1px solid rgba(56,189,248,0.08)",
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "rgba(56,189,248,0.04)" }}>
                    {["App", "Remote Host", "IP Address", "Port", "Protocol", "Country", "Status"].map(h => (
                      <th key={h} style={{
                        padding: "10px 12px", textAlign: "left",
                        fontSize: 9, letterSpacing: 1.5, color: "#64748b",
                        fontWeight: 600, borderBottom: "1px solid rgba(56,189,248,0.06)",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredConns.map((c, i) => (
                    <tr key={i} style={{
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                    }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{c.app}</td>
                      <td style={{ padding: "8px 12px", color: "#38bdf8" }}>{c.host}</td>
                      <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{c.remote}</td>
                      <td style={{ padding: "8px 12px" }}>{c.port}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 4, fontSize: 9,
                          background: "rgba(139,92,246,0.12)", color: "#a78bfa",
                        }}>{c.protocol}</span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>{c.flag} {c.country}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: "50%",
                            background: c.status === "ESTABLISHED" ? "#22c55e" : "#fbbf24",
                          }} />
                          <span style={{ fontSize: 10, color: c.status === "ESTABLISHED" ? "#4ade80" : "#fbbf24" }}>
                            {c.status}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---- ALERTS TAB ---- */}
        {tab === "alerts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((a, i) => (
              <div key={i} style={{
                padding: "12px 16px", borderRadius: 10,
                background: severityBg[a.severity],
                border: `1px solid ${severityColor[a.severity]}22`,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: severityColor[a.severity],
                  boxShadow: `0 0 8px ${severityColor[a.severity]}`,
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>{a.message}</div>
                  <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{a.type.toUpperCase()} · {a.time}</div>
                </div>
                <span style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                  background: `${severityColor[a.severity]}22`,
                  color: severityColor[a.severity],
                  letterSpacing: 0.5,
                }}>
                  {a.severity.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* === FOOTER === */}
      <div style={{
        padding: "8px 24px",
        borderTop: "1px solid rgba(56,189,248,0.06)",
        display: "flex", justifyContent: "space-between",
        fontSize: 9, color: "#475569",
        background: "#080c16",
      }}>
        <span>NETWATCH v1.0 · Local Network Monitor</span>
        <span>Connect Python backend for live system data → python netwatch_backend.py</span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.2); border-radius: 3px; }
      `}</style>
    </div>
  );
}
