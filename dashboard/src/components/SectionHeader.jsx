// ════════════════════════════════════════════════════════════════════
// ANALYTICS — shared helpers
// ════════════════════════════════════════════════════════════════════

// Section header with horizontal rule divider
export function SectionHeader({ title, desc }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1.5, whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ flex: 1, height: 1, background: "rgba(56,189,248,0.10)" }} />
      </div>
      {desc && <div style={{ fontSize: 10, color: "#475569", marginTop: 5 }}>{desc}</div>}
    </div>
  );
}
