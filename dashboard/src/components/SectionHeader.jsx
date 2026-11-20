import { T, withAlpha } from "../lib/theme";

// ════════════════════════════════════════════════════════════════════
// ANALYTICS — shared helpers
// ════════════════════════════════════════════════════════════════════

// Section header with horizontal rule divider
export function SectionHeader({ title, desc }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontFamily: T.fontLabel, fontSize: 11, fontWeight: 700, color: T.textSecondary, letterSpacing: 1.5, whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ flex: 1, height: 1, background: withAlpha(T.accent, 0.10) }} />
      </div>
      {desc && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 5 }}>{desc}</div>}
    </div>
  );
}
