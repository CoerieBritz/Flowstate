import { severityBg, severityColor } from "../lib/colors";
import { PANEL, T } from "../lib/theme";

export function AlertsTab({ alerts }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {alerts.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: 12, padding: "20px 0" }}>No alerts yet.</div>
      ) : (
        [...alerts].reverse().map((a, i) => (
          <div key={i} style={{ padding: "12px 16px", ...PANEL, background: `linear-gradient(90deg,${severityBg[a.severity] || severityBg.info},${T.panel} 45%)`, borderLeft: `3px solid ${severityColor[a.severity] || severityColor.info}`, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: severityColor[a.severity] || severityColor.info, boxShadow: `0 0 8px ${severityColor[a.severity] || severityColor.info}` }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{a.message}</div>
              <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 2 }}>{a.type.toUpperCase()} · {a.time}</div>
            </div>
            <span style={{ fontFamily: T.fontLabel, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: `${(severityColor[a.severity] || severityColor.info)}22`, color: severityColor[a.severity] || severityColor.info, letterSpacing: 0.5 }}>
              {(a.severity || "info").toUpperCase()}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
