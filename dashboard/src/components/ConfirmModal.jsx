import { T, withAlpha } from "../lib/theme";

// ════════════════════════════════════════════════════════════════════
// CONFIRMATION MODAL
// ════════════════════════════════════════════════════════════════════
const ACTION_META = {
  block_ip:         { icon: "🚫", label: "Block IP",              dangerous: false },
  unblock_ip:       { icon: "✅", label: "Unblock IP",            dangerous: false },
  kill_process:     { icon: "☠️", label: "Kill Process",          dangerous: true  },
  add_blocklist:    { icon: "📋", label: "Add to Blocklist",       dangerous: false },
  remove_blocklist: { icon: "🗑️", label: "Remove from Blocklist", dangerous: false },
  capture_snapshot: { icon: "📸", label: "Capture Snapshot",      dangerous: false },
  undo_action:      { icon: "↩️", label: "Undo",                  dangerous: false },
};

export function ConfirmModal({ pending, onConfirm, onCancel }) {
  if (!pending) return null;
  const meta = ACTION_META[pending.action] || { icon: "⚡", label: pending.action, dangerous: false };
  const isDangerous = pending.dangerous ?? meta.dangerous;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, borderRadius: 14,
          background: T.panel,
          border: `1px solid ${isDangerous ? "rgba(239,68,68,0.4)" : withAlpha(T.accent, 0.25)}`,
          boxShadow: `0 20px 60px rgba(0,0,0,0.8), 0 0 30px ${isDangerous ? "rgba(239,68,68,0.15)" : withAlpha(T.accent, 0.1)}`,
          padding: "24px 28px",
          fontFamily: "inherit",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 24 }}>{meta.icon}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: isDangerous ? T.danger : T.text }}>
              {pending.title || meta.label}
            </div>
            <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1, marginTop: 2 }}>CONFIRM ACTION</div>
          </div>
        </div>

        {/* Description */}
        <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.7, marginBottom: 14 }}>
          {pending.description}
        </div>

        {/* Command preview */}
        {pending.command && (
          <div style={{
            padding: "8px 12px", borderRadius: 6, marginBottom: 14,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
            fontSize: 11, color: T.textSecondary, fontFamily: "monospace",
            wordBreak: "break-all",
          }}>
            {pending.command}
          </div>
        )}

        {/* Reversibility warning */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 20,
          padding: "8px 12px", borderRadius: 6,
          background: isDangerous ? "rgba(239,68,68,0.08)" : withAlpha(T.accent, 0.05),
          border: `1px solid ${isDangerous ? "rgba(239,68,68,0.2)" : withAlpha(T.accent, 0.12)}`,
          fontSize: 11,
          color: isDangerous ? "#fca5a5" : T.textSecondary,
        }}>
          <span>{isDangerous ? "⚠️" : "ℹ️"}</span>
          <span>{isDangerous ? "This action cannot be undone." : "This action is reversible via the Audit Log."}</span>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            padding: "8px 20px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)",
            background: "transparent", color: T.textSecondary, fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{
            padding: "8px 24px", borderRadius: 7, border: "none",
            background: isDangerous
              ? "linear-gradient(135deg,#dc2626,#b91c1c)"
              : "linear-gradient(135deg,#0ea5e9,#0284c7)",
            color: "#fff", fontSize: 11, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
            boxShadow: isDangerous
              ? "0 2px 12px rgba(239,68,68,0.4)"
              : "0 2px 12px rgba(14,165,233,0.4)",
          }}>
            {isDangerous ? "Confirm — I understand" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
