import { useState } from "react";

// ════════════════════════════════════════════════════════════════════
// AUDIT LOG TAB
// ════════════════════════════════════════════════════════════════════
const ACTION_LABELS = {
  block_ip:         "Block IP",
  unblock_ip:       "Unblock IP",
  kill_process:     "Kill Process",
  add_blocklist:    "Add to Blocklist",
  remove_blocklist: "Remove from Blocklist",
  capture_snapshot: "Capture Snapshot",
  undo_action:      "Undo",
};

export function AuditLogTab({ auditLog, undoStack, onAction }) {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all"
    ? auditLog
    : auditLog.filter((e) => e.action === filter);

  const undoIds = new Set(undoStack.map((u) => u.undo_id || u.id));

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "TOTAL ACTIONS",  value: auditLog.length, color: "#38bdf8" },
          { label: "SUCCESSES",      value: auditLog.filter((e) => e.result === "success").length, color: "#4ade80" },
          { label: "FAILURES",       value: auditLog.filter((e) => e.result === "failure").length, color: "#ef4444" },
          { label: "UNDO AVAILABLE", value: undoStack.length, color: "#fbbf24" },
        ].map((s) => (
          <div key={s.label} style={{
            flex: 1, minWidth: 100, padding: "10px 16px", borderRadius: 8,
            background: `${s.color}0d`, border: `1px solid ${s.color}22`,
          }}>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter buttons */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {["all", "block_ip", "unblock_ip", "kill_process", "capture_snapshot", "add_blocklist", "remove_blocklist"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "4px 12px", borderRadius: 5, border: "none", fontFamily: "inherit",
            background: filter === f ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)",
            color: filter === f ? "#38bdf8" : "#64748b", fontSize: 10, fontWeight: 600, cursor: "pointer",
          }}>
            {f === "all" ? "ALL" : (ACTION_LABELS[f] || f).toUpperCase()}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 12, padding: "40px 0", textAlign: "center" }}>
          {auditLog.length === 0 ? "No actions taken yet." : "No actions match the filter."}
        </div>
      ) : (
        <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(56,189,248,0.08)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "rgba(56,189,248,0.04)" }}>
                {["Timestamp", "Action", "Target", "Result", "Details", "Undo"].map((h) => (
                  <th key={h} style={{
                    padding: "10px 12px", textAlign: "left",
                    fontSize: 9, letterSpacing: 1.2, color: "#64748b", fontWeight: 600,
                    borderBottom: "1px solid rgba(56,189,248,0.06)", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => {
                const success = entry.result === "success";
                // Find if this entry has a corresponding undo available
                const undoEntry = entry.undo_id
                  ? undoStack.find((u) => u.id === entry.undo_id)
                  : null;
                return (
                  <tr key={i} style={{
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                  }}>
                    <td style={{ padding: "8px 12px", color: "#475569", whiteSpace: "nowrap", fontSize: 10 }}>
                      {entry.timestamp}
                    </td>
                    <td style={{ padding: "8px 12px", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {ACTION_LABELS[entry.action] || entry.action}
                    </td>
                    <td style={{
                      padding: "8px 12px", color: "#38bdf8",
                      maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={entry.target}>
                      {entry.target}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{
                        padding: "2px 7px", borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                        background: success ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                        color: success ? "#4ade80" : "#ef4444",
                      }}>
                        {success ? "SUCCESS" : "FAILED"}
                      </span>
                    </td>
                    <td style={{
                      padding: "8px 12px", color: "#64748b", fontSize: 10,
                      maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={entry.details}>
                      {entry.details}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {undoEntry ? (
                        <button
                          onClick={() => onAction("undo_action",
                            { undo_id: undoEntry.id },
                            `Undo: ${undoEntry.description}`,
                            `This will execute the reverse operation: ${undoEntry.description}`,
                            "",
                            false,
                          )}
                          style={{
                            padding: "3px 10px", borderRadius: 5, border: "none",
                            background: "rgba(251,191,36,0.15)", color: "#fbbf24",
                            fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          ↩ Undo
                        </button>
                      ) : (
                        <span style={{ color: "#1e293b", fontSize: 9 }}>
                          {entry.reversible ? "—" : "irreversible"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
