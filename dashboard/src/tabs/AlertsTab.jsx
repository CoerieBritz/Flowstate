import { severityBg, severityColor } from "../lib/colors";

export function AlertsTab({ alerts }) {
  return (
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
  );
}
