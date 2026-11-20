import { formatBytes } from "../lib/format";
import { T, withAlpha } from "../lib/theme";

export function AppHeader({ totalSent, totalRecv, wsStatus }) {
  const wsStatusColor = { connecting: T.warning, connected: "#22c55e", disconnected: T.danger, auth_failed: T.danger }[wsStatus];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: `1px solid ${withAlpha(T.accent, 0.1)}`, background: `linear-gradient(180deg,${withAlpha(T.accent, 0.04)} 0%,transparent 100%)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#0ea5e9,#06b6d4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: T.panel, boxShadow: "0 0 20px rgba(14,165,233,0.3)" }}>⚡</div>
        <div>
          <div style={{ fontFamily: T.fontLabel, fontSize: 15, fontWeight: 700, letterSpacing: 1.5, color: T.accent }}>FLOWSTATE</div>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 2 }}>LOCAL NETWORK MONITOR</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1 }}>TOTAL SESSION</div>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: T.download }}>↓ {formatBytes(totalRecv)}</span>
            <span style={{ margin: "0 8px", color: "#334155" }}>|</span>
            <span style={{ color: T.upload }}>↑ {formatBytes(totalSent)}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: wsStatusColor, boxShadow: `0 0 8px ${wsStatusColor}`, animation: wsStatus === "connected" ? "pulse 2s infinite" : "none" }} />
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 0.5 }}>{wsStatus.replace("_", " ").toUpperCase()}</div>
        </div>
      </div>
    </div>
  );
}
