import { T } from "../lib/theme";

// ════════════════════════════════════════════════════════════════════
// STATUS BANNER
// ════════════════════════════════════════════════════════════════════
export function StatusBanner({ status }) {
  if (status === "connected") return null;
  if (status === "auth_failed") {
    return (
      <div role="alert" style={{
        padding: "8px 24px", fontSize: 11,
        background: "rgba(239,68,68,0.15)",
        borderBottom: "1px solid rgba(239,68,68,0.45)",
        color: T.danger, fontWeight: 600,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>⛔</span>
        Authentication failed — restart FlowState
      </div>
    );
  }
  const isConnecting = status === "connecting";
  return (
    <div style={{
      padding: "8px 24px", fontSize: 11,
      background: isConnecting ? "rgba(251,191,36,0.08)" : "rgba(239,68,68,0.08)",
      borderBottom: `1px solid ${isConnecting ? "rgba(251,191,36,0.2)" : "rgba(239,68,68,0.2)"}`,
      color: isConnecting ? T.warning : T.danger,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <span>{isConnecting ? "⏳" : "⚠️"}</span>
      {isConnecting ? "Connecting to backend at ws://localhost:8765…" : "Disconnected — reconnecting every 3 s…"}
    </div>
  );
}
