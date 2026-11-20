import { T } from "../lib/theme";

// ════════════════════════════════════════════════════════════════════
// ACTION BUTTON — compact, used in tables and cards
// ════════════════════════════════════════════════════════════════════
export function ActionBtn({ icon, label, color = T.accent, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title || label}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 7px", borderRadius: 4, border: "none",
        background: `${color}18`, color, fontSize: 11, fontWeight: 700,
        cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
        letterSpacing: 0.3,
      }}
    >
      {icon && <span style={{ fontSize: 11 }}>{icon}</span>}
      {label}
    </button>
  );
}
