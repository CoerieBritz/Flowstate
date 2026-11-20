// ════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════
export function ToastContainer({ toasts, onDismiss }) {
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
