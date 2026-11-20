import { formatBytes } from "../lib/format";

export function AppHeader({ totalSent, totalRecv, wsStatus }) {
  const wsStatusColor = { connecting: "#fbbf24", connected: "#22c55e", disconnected: "#ef4444", auth_failed: "#ef4444" }[wsStatus];

  return (
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
          <div style={{ fontSize: 8, color: "#475569", letterSpacing: 0.5 }}>{wsStatus.replace("_", " ").toUpperCase()}</div>
        </div>
      </div>
    </div>
  );
}
