import { formatBytes } from "../lib/format";
import { T, withAlpha } from "../lib/theme";

// Served from public/logo.png (copied from src/assets/logo.png by
// scripts/copy-assets.mjs; see that file for why it isn't imported).
const LOGO_URL = "/logo.png";

export function AppHeader({ totalSent, totalRecv, wsStatus }) {
  const wsStatusColor = { connecting: T.warning, connected: "#22c55e", disconnected: T.danger, auth_failed: T.danger }[wsStatus];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: `1px solid ${T.panelBorder}`, background: `linear-gradient(180deg,${withAlpha(T.accent, 0.05)} 0%,${T.chrome} 100%)` }}>
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src={LOGO_URL} alt="" width={40} height={40}
          style={{ width: 40, height: 40, borderRadius: 10, display: "block", boxShadow: `0 0 16px ${withAlpha(T.accent, 0.25)}` }} />
        <div style={{ lineHeight: 1.05 }}>
          <div style={{ fontFamily: T.fontLabel, fontSize: 24, fontWeight: 700, letterSpacing: 3, color: T.accent, textShadow: `0 0 12px ${withAlpha(T.accent, 0.55)}, 0 0 28px ${withAlpha(T.accent, 0.25)}` }}>
            FLOWSTATE
          </div>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, fontWeight: 600, color: T.textSecondary, letterSpacing: 2.5, marginTop: 2 }}>
            LOCAL NETWORK MONITOR
          </div>
        </div>
      </div>

      {/* Session totals + connection status */}
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, fontWeight: 600, color: T.textSecondary, letterSpacing: 1.5, marginBottom: 2 }}>TOTAL SESSION</div>
          <div style={{ fontFamily: T.fontMono, fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: T.download, textShadow: `0 0 10px ${withAlpha(T.download, 0.35)}` }}>↓ {formatBytes(totalRecv)}</span>
            <span style={{ margin: "0 10px", color: T.textMuted }}>|</span>
            <span style={{ color: T.upload, textShadow: `0 0 10px ${withAlpha(T.upload, 0.35)}` }}>↑ {formatBytes(totalSent)}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: wsStatusColor, boxShadow: `0 0 8px ${wsStatusColor}`, animation: wsStatus === "connected" ? "pulse 2s infinite" : "none" }} />
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, fontWeight: 600, color: T.textSecondary, letterSpacing: 0.8 }}>{wsStatus.replace("_", " ").toUpperCase()}</div>
        </div>
      </div>
    </div>
  );
}
