export function AppFooter({ wsStatus }) {
  return (
    <div style={{ padding: "8px 24px", borderTop: "1px solid rgba(56,189,248,0.06)", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", background: "#080c16" }}>
      <span>FLOWSTATE v1.0 · Local Network Monitor</span>
      <span>Backend: ws://localhost:8765 · Status: {wsStatus.replace("_", " ").toUpperCase()}</span>
    </div>
  );
}
