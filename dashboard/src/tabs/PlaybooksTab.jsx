import { useState } from "react";
import { PlaybookEditor } from "../components/PlaybookEditor";
import { INPUT_STYLE } from "../lib/styles";
import { T, withAlpha } from "../lib/theme";

// ════════════════════════════════════════════════════════════════════
// PLAYBOOKS TAB
// ════════════════════════════════════════════════════════════════════

const TRIGGER_META = {
  threat_flagged:  { label: "Threat Flagged",    color: T.danger, bg: "rgba(239,68,68,0.08)"   },
  bandwidth_spike: { label: "Bandwidth Spike",   color: T.orange, bg: "rgba(251,146,60,0.08)"  },
  new_process:     { label: "New Process",        color: "#a78bfa", bg: "rgba(139,92,246,0.08)"  },
  port_scan:       { label: "Port Scan",          color: T.warning, bg: "rgba(251,191,36,0.08)"  },
};

const SEV_META = {
  LOW:      { color: T.success,  bg: "rgba(74,222,128,0.08)"  },
  MEDIUM:   { color: T.warning,  bg: "rgba(251,191,36,0.08)"  },
  HIGH:     { color: T.orange,  bg: "rgba(251,146,60,0.08)"  },
  CRITICAL: { color: T.danger,  bg: "rgba(239,68,68,0.08)"   },
};

function PipelineStage({ label, detail, color, active }) {
  return (
    <div style={{
      flex: 1, padding: "10px 12px", borderRadius: 8, textAlign: "center",
      background: active ? `${color}15` : "rgba(255,255,255,0.02)",
      border: `1px solid ${active ? color + "40" : "rgba(255,255,255,0.06)"}`,
      opacity: active ? 1 : 0.45,
    }}>
      <div style={{ fontFamily: T.fontLabel, fontSize: 11, fontWeight: 700, color: active ? color : T.textMuted, letterSpacing: 1.2, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: T.textSecondary, lineHeight: 1.5 }}>{detail}</div>
    </div>
  );
}

export function PlaybooksTab({
  playbooks, incidents, playbookActivity, dryRunResults, dryRunLoading,
  onToggle, onDryRun, onSave, onDelete, onReload, wsReady,
}) {
  const [expandedCard, setExpandedCard]   = useState(null);
  const [editorOpen, setEditorOpen]       = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [activityFilter, setActivityFilter] = useState({ name: "", severity: "" });
  const [activityExpanded, setActivityExpanded] = useState(new Set());

  const handleEdit = (pb) => { setEditingPlaybook(pb); setEditorOpen(true); setExpandedCard(null); };
  const handleNew  = ()   => { setEditingPlaybook(null); setEditorOpen(true); };
  const handleSave = (yaml, filename) => {
    onSave(yaml, filename);
    setEditorOpen(false);
    setEditingPlaybook(null);
  };

  const playbookIncidentCount = (name) =>
    incidents.filter((i) => i.source === "playbook" && i.playbook_name === name).length;

  const triggerPlainEnglish = (pb) => {
    if (pb.trigger_type === "threat_flagged")
      return `Fires when a connection is flagged by a local threat feed${pb.min_severity ? ` with severity ≥ ${pb.min_severity.toUpperCase()}` : ""}.`;
    if (pb.trigger_type === "bandwidth_spike")
      return "Fires when a process exceeds 2× its rolling 1-hour bandwidth average.";
    if (pb.trigger_type === "new_process")
      return "Fires when a process makes its first observed outbound connection.";
    if (pb.trigger_type === "port_scan")
      return `Fires when a single remote IP is seen connecting to ${pb.min_port_count || 5}+ distinct local ports.`;
    return pb.trigger_type;
  };

  const filteredActivity = playbookActivity.filter((e) => {
    if (activityFilter.name && e.playbook_name !== activityFilter.name) return false;
    if (activityFilter.severity && e.severity !== activityFilter.severity) return false;
    return true;
  });

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: T.fontLabel, fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: 0.5 }}>Playbook Library</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
            {playbooks.length} playbook{playbooks.length !== 1 ? "s" : ""} loaded ·{" "}
            {playbooks.filter((p) => p.enabled).length} enabled ·{" "}
            {incidents.filter((i) => i.source === "playbook").length} incidents generated
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onReload} disabled={!wsReady} title="Reload playbooks from disk" style={{
            padding: "7px 14px", borderRadius: 7,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: T.textSecondary, fontSize: 11, cursor: wsReady ? "pointer" : "not-allowed",
            fontFamily: "inherit", fontWeight: 600,
          }}>🔄 Reload</button>
          <button onClick={handleNew} disabled={!wsReady} style={{
            padding: "7px 16px", borderRadius: 7,
            background: `linear-gradient(135deg,${withAlpha(T.accent, 0.15)},rgba(14,165,233,0.08))`,
            border: `1px solid ${withAlpha(T.accent, 0.25)}`, color: T.accent,
            fontSize: 11, fontWeight: 700, cursor: wsReady ? "pointer" : "not-allowed", fontFamily: "inherit",
          }}>+ Create New Playbook</button>
        </div>
      </div>

      {/* ── Editor panel ────────────────────────────────────────────── */}
      {editorOpen && (
        <PlaybookEditor
          playbook={editingPlaybook}
          onSave={handleSave}
          onCancel={() => { setEditorOpen(false); setEditingPlaybook(null); }}
          wsReady={wsReady}
        />
      )}

      {/* ── Confirm delete ───────────────────────────────────────────── */}
      {confirmDelete && (
        <div style={{
          marginBottom: 16, padding: "14px 18px", borderRadius: T.radius,
          background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <span style={{ color: T.danger, fontWeight: 700, fontSize: 11 }}>⚠ Delete "{confirmDelete}"?</span>
            <span style={{ color: T.textSecondary, fontSize: 11, marginLeft: 10 }}>This removes the YAML file permanently.</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); setExpandedCard(null); }}
              disabled={!wsReady}
              style={{ padding: "5px 14px", borderRadius: 5, border: "none", background: T.danger, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Delete
            </button>
            <button onClick={() => setConfirmDelete(null)}
              style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: T.textSecondary, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Library ─────────────────────────────────────────────────── */}
      {playbooks.length === 0 ? (
        <div style={{
          padding: "40px 20px", textAlign: "center", borderRadius: 12,
          border: `1px dashed ${withAlpha(T.accent, 0.12)}`, color: "#334155", fontSize: 12,
        }}>
          No playbooks loaded. Add YAML files to{" "}
          <code style={{ color: T.accent }}>playbooks/</code> or use "+ Create New Playbook".
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {playbooks.map((pb) => {
            const tm = TRIGGER_META[pb.trigger_type] || { label: pb.trigger_type, color: T.textSecondary, bg: "rgba(100,116,139,0.08)" };
            const sm = SEV_META[pb.severity]         || { color: T.textSecondary, bg: "rgba(100,116,139,0.08)" };
            const isExpanded = expandedCard === pb.name;
            const pbIncidents = incidents.filter((i) => i.source === "playbook" && i.playbook_name === pb.name);
            const drResult    = dryRunResults[pb.name];
            const drLoading   = dryRunLoading === pb.name;

            return (
              <div key={pb.name} style={{
                borderRadius: T.radius, overflow: "hidden",
                border: `1px solid ${isExpanded ? withAlpha(T.accent, 0.3) : T.panelBorder}`,
                background: isExpanded ? `linear-gradient(180deg,${withAlpha(T.accent, 0.05)},${T.panel} 120px)` : T.panel,
              }}>
                {/* Card header */}
                <div
                  onClick={() => setExpandedCard(isExpanded ? null : pb.name)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                    cursor: "pointer", opacity: pb.enabled ? 1 : 0.6,
                  }}
                >
                  <span style={{ fontSize: 20 }}>📋</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: pb.enabled ? T.text : T.textSecondary }}>
                        {pb.display_name}
                      </span>
                      <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, background: tm.bg, color: tm.color, border: `1px solid ${tm.color}30` }}>
                        {tm.label.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, background: sm.bg, color: sm.color, border: `1px solid ${sm.color}30` }}>
                        {pb.severity}
                      </span>
                      {pb.enrich_vt && <span style={{ fontSize: 11, color: T.textMuted }} title="Uses VirusTotal">🦠 VT</span>}
                      {pb.enrich_ab && <span style={{ fontSize: 11, color: T.textMuted }} title="Uses AbuseIPDB">🛡️ AB</span>}
                    </div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {pb.description}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: "flex", gap: 16, flexShrink: 0, fontSize: 11, color: T.textMuted, textAlign: "center" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: pb.times_triggered > 0 ? T.accent : "#334155" }}>{pb.times_triggered || 0}</div>
                      <div style={{ fontFamily: T.fontLabel, letterSpacing: 1 }}>TRIGGERED</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: playbookIncidentCount(pb.name) > 0 ? T.warning : "#334155" }}>{playbookIncidentCount(pb.name)}</div>
                      <div style={{ fontFamily: T.fontLabel, letterSpacing: 1 }}>INCIDENTS</div>
                    </div>
                    {pb.last_triggered_at && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.textSecondary }}>
                          {new Date(pb.last_triggered_at * 1000).toLocaleTimeString()}
                        </div>
                        <div style={{ fontFamily: T.fontLabel, letterSpacing: 1 }}>LAST HIT</div>
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => onToggle(pb.name, !pb.enabled)} disabled={!wsReady} style={{
                      padding: "4px 10px", borderRadius: 5, border: "none",
                      background: pb.enabled ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
                      color: pb.enabled ? T.success : T.textSecondary,
                      fontSize: 11, fontWeight: 700, cursor: wsReady ? "pointer" : "not-allowed", fontFamily: "inherit",
                    }}>{pb.enabled ? "ON" : "OFF"}</button>
                    <button onClick={() => handleEdit(pb)} title="Edit playbook" style={{
                      padding: "4px 8px", borderRadius: 5,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                      color: T.textSecondary, fontSize: 11, cursor: "pointer",
                    }}>✏️</button>
                    <button onClick={() => setConfirmDelete(pb.name)} title="Delete playbook" style={{
                      padding: "4px 8px", borderRadius: 5,
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
                      color: T.danger, fontSize: 11, cursor: "pointer",
                    }}>🗑️</button>
                    <span style={{ fontSize: 14, color: "#334155", padding: "4px 2px" }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* ── Detail View ─────────────────────────────────────── */}
                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${withAlpha(T.accent, 0.08)}`, padding: "16px 20px" }}>

                    {/* Trigger plain English */}
                    <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 16, lineHeight: 1.7,
                      padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 8,
                      borderLeft: `3px solid ${tm.color}`,
                    }}>
                      <span style={{ fontWeight: 600, color: tm.color }}>Trigger: </span>
                      {triggerPlainEnglish(pb)}
                    </div>

                    {/* Pipeline */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1.5, marginBottom: 8 }}>EXECUTION PIPELINE</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <PipelineStage
                          label="TRIGGER"
                          detail={tm.label}
                          color={tm.color}
                          active={true}
                        />
                        <span style={{ color: "#334155", fontSize: 14 }}>→</span>
                        <PipelineStage
                          label="ENRICH"
                          detail={(pb.enrich_vt ? "VT " : "") + (pb.enrich_ab ? "AB" : "") || "None"}
                          color={T.accent}
                          active={pb.enrich_vt || pb.enrich_ab}
                        />
                        <span style={{ color: "#334155", fontSize: 14 }}>→</span>
                        <PipelineStage
                          label="CORRELATE"
                          detail="Link to incidents"
                          color="#a78bfa"
                          active={true}
                        />
                        <span style={{ color: "#334155", fontSize: 14 }}>→</span>
                        <PipelineStage
                          label="RECOMMEND"
                          detail={`${(pb.recommended_actions || []).length} action${(pb.recommended_actions || []).length !== 1 ? "s" : ""}`}
                          color={T.success}
                          active={(pb.recommended_actions || []).length > 0}
                        />
                      </div>
                    </div>

                    {/* Description */}
                    {pb.description && (
                      <div style={{ marginBottom: 14, fontSize: 11, color: T.textSecondary, lineHeight: 1.7 }}>
                        {pb.description}
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                      {/* Recommended actions */}
                      <div>
                        <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1.5, marginBottom: 8 }}>
                          RECOMMENDED ACTIONS — <span style={{ color: sm.color }}>{pb.severity}</span> THRESHOLD
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {(pb.recommended_actions || []).map((action, i) => (
                            <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, color: T.textSecondary, lineHeight: 1.5 }}>
                              <span style={{ color: "#334155", flexShrink: 0 }}>{i + 1}.</span>
                              <span>{action}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Related incidents */}
                      <div>
                        <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1.5, marginBottom: 8 }}>
                          INCIDENTS GENERATED ({pbIncidents.length})
                        </div>
                        {pbIncidents.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#334155" }}>No incidents yet.</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {pbIncidents.slice(0, 5).map((inc) => {
                              const sm2 = SEV_META[inc.severity] || {};
                              return (
                                <div key={inc.id} style={{
                                  padding: "6px 10px", borderRadius: 6, fontSize: 11,
                                  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                                  display: "flex", alignItems: "center", gap: 8,
                                }}>
                                  <span style={{ fontSize: 11, color: sm2.color || T.textSecondary, fontWeight: 700,
                                    padding: "1px 5px", borderRadius: 3, background: sm2.bg || "transparent",
                                  }}>{inc.severity}</span>
                                  <span style={{ color: T.textSecondary, flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{inc.title}</span>
                                  <span style={{ color: "#334155", fontSize: 11, flexShrink: 0 }}>{inc.status}</span>
                                </div>
                              );
                            })}
                            {pbIncidents.length > 5 && (
                              <div style={{ fontSize: 11, color: T.textMuted }}>+{pbIncidents.length - 5} more in Incidents tab</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Dry run */}
                    <div style={{ paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: drResult ? 10 : 0 }}>
                        <button onClick={() => onDryRun(pb.name)} disabled={!wsReady || drLoading} style={{
                          padding: "7px 16px", borderRadius: 7, border: `1px solid ${withAlpha(T.accent, 0.25)}`,
                          background: withAlpha(T.accent, 0.08), color: T.accent,
                          fontSize: 11, fontWeight: 700, cursor: wsReady && !drLoading ? "pointer" : "not-allowed",
                          fontFamily: "inherit", opacity: wsReady ? 1 : 0.5,
                        }}>
                          {drLoading ? "⏳ Testing…" : "🧪 Test Playbook"}
                        </button>
                        <span style={{ fontSize: 11, color: "#334155" }}>
                          Dry run — checks against current connections. No incidents created.
                        </span>
                        {drResult && (
                          <span style={{ fontSize: 11, color: T.textMuted, marginLeft: "auto" }}>
                            Tested at {new Date(drResult.ts).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      {drResult && (() => {
                        const r = drResult.results?.find((r) => r.playbook_name === pb.name);
                        if (!r) return null;
                        return (
                          <div style={{ padding: "10px 14px", borderRadius: 8, background: r.would_fire ? "rgba(251,191,36,0.06)" : "rgba(34,197,94,0.06)", border: `1px solid ${r.would_fire ? "rgba(251,191,36,0.2)" : "rgba(34,197,94,0.2)"}` }}>
                            {r.would_fire ? (
                              <>
                                <div style={{ fontSize: 11, fontWeight: 700, color: T.warning, marginBottom: 6 }}>
                                  ⚡ Would fire — {r.matches.length} match{r.matches.length !== 1 ? "es" : ""}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  {r.matches.slice(0, 5).map((m, i) => (
                                    <div key={i} style={{ fontSize: 11, color: T.textSecondary, display: "flex", gap: 8 }}>
                                      <span style={{ color: T.textSecondary }}>{m.app || m.ip || "—"}</span>
                                      <span style={{ color: "#334155" }}>→</span>
                                      <span style={{ color: T.textMuted }}>{m.host || m.ip || "—"}</span>
                                      <span style={{ color: "#334155", fontStyle: "italic" }}>{m.reason}</span>
                                    </div>
                                  ))}
                                  {r.matches.length > 5 && <div style={{ fontSize: 11, color: T.textMuted }}>+{r.matches.length - 5} more</div>}
                                </div>
                              </>
                            ) : (
                              <div style={{ fontSize: 11, color: T.success }}>
                                ✓ Would not fire — no matches in current connections
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Activity Feed ───────────────────────────────────────────── */}
      <div style={{
        padding: "16px 20px", borderRadius: 12,
        background: "rgba(255,255,255,0.01)", border: `1px solid ${withAlpha(T.accent, 0.07)}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 2, fontWeight: 700 }}>PLAYBOOK ACTIVITY FEED</div>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={activityFilter.name}
              onChange={(e) => setActivityFilter((p) => ({ ...p, name: e.target.value }))}
              style={{ ...INPUT_STYLE, width: "auto", fontSize: 11, padding: "3px 8px" }}
            >
              <option value="">All playbooks</option>
              {playbooks.map((pb) => <option key={pb.name} value={pb.name}>{pb.display_name}</option>)}
            </select>
            <select
              value={activityFilter.severity}
              onChange={(e) => setActivityFilter((p) => ({ ...p, severity: e.target.value }))}
              style={{ ...INPUT_STYLE, width: "auto", fontSize: 11, padding: "3px 8px" }}
            >
              <option value="">All severities</option>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {filteredActivity.length === 0 ? (
          <div style={{ color: "#334155", fontSize: 11, textAlign: "center", padding: "20px 0" }}>
            {playbookActivity.length === 0 ? "No playbook activity yet." : "No entries match the filter."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {filteredActivity.map((entry, i) => {
              const sm2 = SEV_META[entry.severity] || {};
              const isNew = entry.result === "new_incident";
              const isEx  = activityExpanded.has(i);
              return (
                <div key={i} style={{
                  borderRadius: 6, overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.03)",
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                }}>
                  <div
                    onClick={() => setActivityExpanded((prev) => {
                      const n = new Set(prev);
                      if (n.has(i)) n.delete(i); else n.add(i);
                      return n;
                    })}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", cursor: "pointer" }}
                  >
                    <span style={{ fontSize: 11, color: T.textMuted, flexShrink: 0, width: 60 }}>{entry.time_str}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.textSecondary, flexShrink: 0, width: 140, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {entry.playbook_display}
                    </span>
                    <span style={{ flex: 1, fontSize: 11, color: T.textSecondary, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {entry.trigger_event}
                    </span>
                    <span style={{ fontSize: 11, padding: "1px 5px", borderRadius: 3, background: sm2.bg || "transparent", color: sm2.color || T.textSecondary, flexShrink: 0 }}>
                      {entry.severity}
                    </span>
                    <span style={{
                      fontSize: 11, padding: "1px 6px", borderRadius: 3, flexShrink: 0,
                      background: isNew ? "rgba(74,222,128,0.1)" : "rgba(100,116,139,0.08)",
                      color: isNew ? T.success : T.textMuted,
                    }}>
                      {isNew ? "NEW INCIDENT" : "DEDUP"}
                    </span>
                    <span style={{ color: "#334155", fontSize: 11 }}>{isEx ? "▲" : "▼"}</span>
                  </div>
                  {isEx && (
                    <div style={{ padding: "6px 12px 10px 42px", fontSize: 11, color: T.textMuted, lineHeight: 1.6, borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                      <span style={{ color: T.textSecondary }}>Incident ID:</span>{" "}
                      <code style={{ color: T.accent }}>{entry.incident_id}</code>
                      {" · "}
                      <span style={{ color: T.textSecondary }}>Result:</span>{" "}
                      {isNew ? "New incident created" : "Merged into existing open incident"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 11, color: "#1e293b", marginTop: 8 }}>
          Showing last {filteredActivity.length} entries · Resets on backend restart
        </div>
      </div>
    </div>
  );
}
