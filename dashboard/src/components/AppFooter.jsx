import { T, withAlpha } from "../lib/theme";

export function AppFooter({ wsStatus }) {
  return (
    <div style={{ padding: "8px 24px", borderTop: `1px solid ${withAlpha(T.accent, 0.06)}`, display: "flex", justifyContent: "space-between", fontSize: 11, color: T.textMuted, background: T.chrome }}>
      <span>FLOWSTATE v1.0 · Local Network Monitor</span>
      <span>Backend: ws://localhost:8765 · Status: {wsStatus.replace("_", " ").toUpperCase()}</span>
    </div>
  );
}
