import { useState, useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { ActionBtn } from "./components/ActionBtn";
import { ConfirmModal } from "./components/ConfirmModal";
import { LookupBtn } from "./components/LookupBtn";
import { PlaybookEditor } from "./components/PlaybookEditor";
import { SectionHeader } from "./components/SectionHeader";
import { StatusBanner } from "./components/StatusBanner";
import { ThreatBadge } from "./components/ThreatBadge";
import { ThreatIntelPanel } from "./components/ThreatIntelPanel";
import { ToastContainer } from "./components/ToastContainer";
import { useContainerWidth } from "./hooks/useContainerWidth";
import { INC_SEV, PALETTE, riskColor } from "./lib/colors";
import { fmtRelTime, formatBytes, formatRate, formatRateDetailed, getAppIcon } from "./lib/format";
import { INPUT_STYLE } from "./lib/styles";
import { WS_URL } from "./lib/ws";
import { AnalyticsSummary } from "./components/charts/AnalyticsSummary";
import { AppBandwidthBarsWithDrillIn } from "./components/charts/AppBandwidthBarsWithDrillIn";
import { ConnectionsTable } from "./components/charts/ConnectionsTable";
import { DonutChart } from "./components/charts/DonutChart";
import { GlobalConnectionMap } from "./components/charts/GlobalConnectionMap";
import { NetworkMap } from "./components/charts/NetworkMap";
import { SankeyChart } from "./components/charts/SankeyChart";
import { Sparkline } from "./components/charts/Sparkline";
import { TrafficGraph } from "./components/charts/TrafficGraph";
import { TreemapChart } from "./components/charts/TreemapChart";
import { TrendBadge } from "./components/charts/TrendBadge";

// ════════════════════════════════════════════════════════════════════
// INCIDENTS TAB — SOAR Phase 2 alert correlation
// ════════════════════════════════════════════════════════════════════

const RULE_LABELS = {
  R1: "Repeated Connection",
  R2: "Multi-Threat Contact",
  R3: "Multi-Process Fan-out",
  R4: "Bandwidth Anomaly",
  R5: "New Process",
};

const STATUS_STYLE = {
  OPEN:         { color: "#ef4444", bg: "rgba(239,68,68,0.12)",    label: "OPEN"         },
  ACKNOWLEDGED: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)",   label: "ACKNOWLEDGED" },
  RESOLVED:     { color: "#4ade80", bg: "rgba(34,197,94,0.10)",    label: "RESOLVED"     },
};

function IncidentCard({ incident, onAcknowledge, onResolve, onAction, apps }) {
  const [expanded, setExpanded] = useState(false);
  const sev = INC_SEV[incident.severity] || INC_SEV.LOW;
  const st  = STATUS_STYLE[incident.status] || STATUS_STYLE.OPEN;
  const isResolved = incident.status === "RESOLVED";

  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${sev.border}`,
      background: isResolved ? "rgba(255,255,255,0.015)" : sev.bg,
      marginBottom: 10,
      overflow: "hidden",
      opacity: isResolved ? 0.6 : 1,
      transition: "opacity 0.2s",
    }}>
      {/* ── Card header ── */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}
      >
        {/* Severity badge */}
        <div style={{
          flexShrink: 0, padding: "3px 8px", borderRadius: 5,
          background: `${sev.color}22`, border: `1px solid ${sev.color}44`,
          fontSize: 9, fontWeight: 800, color: sev.color, letterSpacing: 1,
          minWidth: 64, textAlign: "center",
          boxShadow: sev.pulse ? `0 0 8px ${sev.color}55` : "none",
        }}>
          {incident.severity}
        </div>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: isResolved ? "#64748b" : "#e2e8f0",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {incident.title}
            </div>
            {incident.source === "playbook" && (
              <span style={{
                flexShrink: 0, padding: "1px 6px", borderRadius: 4, fontSize: 8,
                background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)",
                color: "#fbbf24", fontWeight: 700, letterSpacing: 0.5,
              }}>
                📋 PLAYBOOK
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap", fontSize: 9, color: "#475569" }}>
            <span style={{ color: "#64748b" }}>
              {incident.source === "playbook"
                ? (incident.playbook_display || incident.rule)
                : (RULE_LABELS[incident.rule] || incident.rule)}
            </span>
            <span>·</span>
            <span>{incident.alert_count} event{incident.alert_count !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>{fmtRelTime(incident.created_at)}</span>
            {incident.processes.length > 0 && (
              <>
                <span>·</span>
                <span style={{ color: "#a78bfa" }}>
                  {incident.processes.slice(0, 3).join(", ")}
                  {incident.processes.length > 3 ? ` +${incident.processes.length - 3}` : ""}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div style={{
          flexShrink: 0, padding: "2px 8px", borderRadius: 4,
          background: st.bg, fontSize: 9, fontWeight: 700, color: st.color,
          letterSpacing: 0.5,
        }}>
          {st.label}
        </div>

        {/* Chevron */}
        <div style={{ flexShrink: 0, color: "#475569", fontSize: 11, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${sev.border}`, padding: "14px 16px", background: "rgba(0,0,0,0.2)" }}>
          {/* Metadata row */}
          <div style={{ display: "flex", gap: 24, marginBottom: 14, flexWrap: "wrap" }}>
            {incident.processes.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 4 }}>PROCESSES</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {incident.processes.map((p) => (
                    <span key={p} style={{ padding: "2px 7px", borderRadius: 4, background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)", fontSize: 10, color: "#a78bfa" }}>{p}</span>
                  ))}
                </div>
              </div>
            )}
            {incident.ips.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 4 }}>IPs / DESTINATIONS</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {incident.ips.slice(0, 6).map((ip) => (
                    <span key={ip} style={{ padding: "2px 7px", borderRadius: 4, background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", fontSize: 10, color: "#38bdf8", fontVariantNumeric: "tabular-nums" }}>{ip}</span>
                  ))}
                  {incident.ips.length > 6 && (
                    <span style={{ fontSize: 10, color: "#475569" }}>+{incident.ips.length - 6} more</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Alert timeline */}
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 8 }}>ALERT TIMELINE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14, maxHeight: 200, overflowY: "auto" }}>
            {incident.alerts.map((a, i) => (
              <div key={i} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "6px 10px", borderRadius: 6,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.04)",
                fontSize: 10,
              }}>
                <span style={{ color: "#475569", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{a.time}</span>
                <span style={{ color: "#94a3b8", flex: 1 }}>{a.message}</span>
                {a.rule && (
                  <span style={{ flexShrink: 0, fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "rgba(56,189,248,0.08)", color: "#64748b" }}>{a.rule}</span>
                )}
              </div>
            ))}
          </div>

          {/* Recommended actions */}
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 8 }}>RECOMMENDED ACTIONS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
            {incident.recommended_actions.map((action, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11 }}>
                <span style={{ color: sev.color, flexShrink: 0, marginTop: 1 }}>›</span>
                <span style={{ color: "#94a3b8" }}>{action}</span>
              </div>
            ))}
          </div>

          {/* Response actions */}
          {onAction && !isResolved && (incident.ips.length > 0 || incident.processes.length > 0) && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 8 }}>RESPONSE ACTIONS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {incident.ips.slice(0, 5).map((ip) => (
                  <ActionBtn key={ip} icon="🚫" label={`Block ${ip}`} color="#ef4444"
                    onClick={() => onAction(
                      "block_ip", { ip },
                      `Block IP ${ip}`,
                      `Add Windows Firewall rules blocking all inbound and outbound traffic to/from ${ip}. Triggered by incident: "${incident.title}".`,
                      `netsh advfirewall firewall add rule name="FlowState Block OUT ${ip}" dir=out action=block remoteip=${ip}`,
                      false,
                    )}
                  />
                ))}
                {incident.processes.slice(0, 3).map((proc) => {
                  const app = (apps || []).find((a) => a.name === proc);
                  if (!app?.pid) return null;
                  return (
                    <ActionBtn key={proc} icon="☠️" label={`Kill ${proc}`} color="#fb923c"
                      onClick={() => onAction(
                        "kill_process", { pid: app.pid, name: proc },
                        `Kill Process: ${proc}`,
                        `Terminate ${proc} (PID ${app.pid}) immediately. This cannot be undone.`,
                        `taskkill /PID ${app.pid} /F`,
                        true,
                      )}
                    />
                  );
                })}
                {incident.ips.slice(0, 3).map((ip) => (
                  <ActionBtn key={`bl-${ip}`} icon="📋" label={`Blocklist ${ip}`} color="#a78bfa"
                    onClick={() => onAction(
                      "add_blocklist", { ip },
                      `Add ${ip} to Blocklist`,
                      `Append ${ip} to data/blocklist.txt for persistent tracking. This does not automatically block the IP — use "Block IP" for that.`,
                      `echo ${ip} >> data/blocklist.txt`,
                      false,
                    )}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Snapshot + status buttons */}
          {!isResolved && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onAction && (
                <ActionBtn icon="📸" label="Snapshot" color="#38bdf8"
                  onClick={() => onAction(
                    "capture_snapshot", {},
                    "Capture System Snapshot",
                    "Save the current process list and all active connections to data/snapshots/. Useful for forensic analysis.",
                    "snapshot → data/snapshots/snapshot_{timestamp}.json",
                    false,
                  )}
                />
              )}
              {incident.status === "OPEN" && (
                <button
                  onClick={() => onAcknowledge(incident.id)}
                  style={{
                    padding: "6px 16px", borderRadius: 6, border: "none",
                    background: "rgba(251,191,36,0.15)", color: "#fbbf24",
                    fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Acknowledge
                </button>
              )}
              <button
                onClick={() => onResolve(incident.id)}
                style={{
                  padding: "6px 16px", borderRadius: 6, border: "none",
                  background: "rgba(34,197,94,0.15)", color: "#4ade80",
                  fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Resolve
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IncidentsTab({ incidents, onAcknowledge, onResolve, onAction, apps }) {
  const open        = incidents.filter((i) => i.status === "OPEN");
  const acked       = incidents.filter((i) => i.status === "ACKNOWLEDGED");
  const resolved    = incidents.filter((i) => i.status === "RESOLVED");

  const sevCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  open.concat(acked).forEach((i) => { if (sevCounts[i.severity] !== undefined) sevCounts[i.severity]++; });

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "OPEN",         value: open.length,     color: "#ef4444" },
          { label: "ACKNOWLEDGED", value: acked.length,    color: "#fbbf24" },
          { label: "RESOLVED",     value: resolved.length, color: "#4ade80" },
        ].map((s) => (
          <div key={s.label} style={{
            padding: "10px 16px", borderRadius: 8, flex: 1, minWidth: 100,
            background: `${s.color}0d`, border: `1px solid ${s.color}22`,
          }}>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
        {Object.entries(sevCounts).filter(([, v]) => v > 0).map(([sev, count]) => {
          const c = INC_SEV[sev];
          return (
            <div key={sev} style={{ padding: "10px 16px", borderRadius: 8, background: c.bg, border: `1px solid ${c.border}` }}>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 4 }}>{sev}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{count}</div>
            </div>
          );
        })}
      </div>

      {/* Alert-only mode notice */}
      <div style={{
        padding: "8px 14px", borderRadius: 8, marginBottom: 16,
        background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.12)",
        fontSize: 10, color: "#475569", display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ color: "#38bdf8" }}>ℹ</span>
        Alert-only mode — the correlator groups and recommends, never executes.
        No traffic has been blocked automatically.
      </div>

      {incidents.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 12, padding: "40px 0", textAlign: "center" }}>
          No incidents yet — the correlator is watching for patterns.
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 10 }}>OPEN INCIDENTS</div>
              {open.map((inc) => (
                <IncidentCard key={inc.id} incident={inc} onAcknowledge={onAcknowledge} onResolve={onResolve} onAction={onAction} apps={apps} />
              ))}
            </>
          )}
          {acked.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, margin: "16px 0 10px" }}>ACKNOWLEDGED</div>
              {acked.map((inc) => (
                <IncidentCard key={inc.id} incident={inc} onAcknowledge={onAcknowledge} onResolve={onResolve} onAction={onAction} apps={apps} />
              ))}
            </>
          )}
          {resolved.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, margin: "16px 0 10px" }}>RESOLVED (last 10)</div>
              {resolved.map((inc) => (
                <IncidentCard key={inc.id} incident={inc} onAcknowledge={onAcknowledge} onResolve={onResolve} onAction={onAction} apps={apps} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

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

function AuditLogTab({ auditLog, undoStack, onAction }) {
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

// ════════════════════════════════════════════════════════════════════
// PLAYBOOKS TAB
// ════════════════════════════════════════════════════════════════════

const TRIGGER_META = {
  threat_flagged:  { label: "Threat Flagged",    color: "#ef4444", bg: "rgba(239,68,68,0.08)"   },
  bandwidth_spike: { label: "Bandwidth Spike",   color: "#fb923c", bg: "rgba(251,146,60,0.08)"  },
  new_process:     { label: "New Process",        color: "#a78bfa", bg: "rgba(139,92,246,0.08)"  },
  port_scan:       { label: "Port Scan",          color: "#fbbf24", bg: "rgba(251,191,36,0.08)"  },
};
const SEV_META = {
  LOW:      { color: "#4ade80",  bg: "rgba(74,222,128,0.08)"  },
  MEDIUM:   { color: "#fbbf24",  bg: "rgba(251,191,36,0.08)"  },
  HIGH:     { color: "#fb923c",  bg: "rgba(251,146,60,0.08)"  },
  CRITICAL: { color: "#ef4444",  bg: "rgba(239,68,68,0.08)"   },
};

function PipelineStage({ label, detail, color, active }) {
  return (
    <div style={{
      flex: 1, padding: "10px 12px", borderRadius: 8, textAlign: "center",
      background: active ? `${color}15` : "rgba(255,255,255,0.02)",
      border: `1px solid ${active ? color + "40" : "rgba(255,255,255,0.06)"}`,
      opacity: active ? 1 : 0.45,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: active ? color : "#475569", letterSpacing: 1.2, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 9, color: "#64748b", lineHeight: 1.5 }}>{detail}</div>
    </div>
  );
}

function PlaybooksTab({
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
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", letterSpacing: 0.5 }}>Playbook Library</div>
          <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
            {playbooks.length} playbook{playbooks.length !== 1 ? "s" : ""} loaded ·{" "}
            {playbooks.filter((p) => p.enabled).length} enabled ·{" "}
            {incidents.filter((i) => i.source === "playbook").length} incidents generated
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onReload} disabled={!wsReady} title="Reload playbooks from disk" style={{
            padding: "7px 14px", borderRadius: 7,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: "#64748b", fontSize: 10, cursor: wsReady ? "pointer" : "not-allowed",
            fontFamily: "inherit", fontWeight: 600,
          }}>🔄 Reload</button>
          <button onClick={handleNew} disabled={!wsReady} style={{
            padding: "7px 16px", borderRadius: 7,
            background: "linear-gradient(135deg,rgba(56,189,248,0.15),rgba(14,165,233,0.08))",
            border: "1px solid rgba(56,189,248,0.25)", color: "#38bdf8",
            fontSize: 10, fontWeight: 700, cursor: wsReady ? "pointer" : "not-allowed", fontFamily: "inherit",
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
          marginBottom: 16, padding: "14px 18px", borderRadius: 10,
          background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 11 }}>⚠ Delete "{confirmDelete}"?</span>
            <span style={{ color: "#64748b", fontSize: 10, marginLeft: 10 }}>This removes the YAML file permanently.</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); setExpandedCard(null); }}
              disabled={!wsReady}
              style={{ padding: "5px 14px", borderRadius: 5, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Delete
            </button>
            <button onClick={() => setConfirmDelete(null)}
              style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#64748b", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Library ─────────────────────────────────────────────────── */}
      {playbooks.length === 0 ? (
        <div style={{
          padding: "40px 20px", textAlign: "center", borderRadius: 12,
          border: "1px dashed rgba(56,189,248,0.12)", color: "#334155", fontSize: 12,
        }}>
          No playbooks loaded. Add YAML files to{" "}
          <code style={{ color: "#38bdf8" }}>playbooks/</code> or use "+ Create New Playbook".
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {playbooks.map((pb) => {
            const tm = TRIGGER_META[pb.trigger_type] || { label: pb.trigger_type, color: "#64748b", bg: "rgba(100,116,139,0.08)" };
            const sm = SEV_META[pb.severity]         || { color: "#64748b", bg: "rgba(100,116,139,0.08)" };
            const isExpanded = expandedCard === pb.name;
            const pbIncidents = incidents.filter((i) => i.source === "playbook" && i.playbook_name === pb.name);
            const drResult    = dryRunResults[pb.name];
            const drLoading   = dryRunLoading === pb.name;

            return (
              <div key={pb.name} style={{
                borderRadius: 10, overflow: "hidden",
                border: `1px solid ${isExpanded ? "rgba(56,189,248,0.2)" : "rgba(255,255,255,0.05)"}`,
                background: isExpanded ? "rgba(56,189,248,0.03)" : "rgba(255,255,255,0.01)",
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
                      <span style={{ fontSize: 12, fontWeight: 700, color: pb.enabled ? "#e2e8f0" : "#64748b" }}>
                        {pb.display_name}
                      </span>
                      <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: tm.bg, color: tm.color, border: `1px solid ${tm.color}30` }}>
                        {tm.label.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: sm.bg, color: sm.color, border: `1px solid ${sm.color}30` }}>
                        {pb.severity}
                      </span>
                      {pb.enrich_vt && <span style={{ fontSize: 8, color: "#475569" }} title="Uses VirusTotal">🦠 VT</span>}
                      {pb.enrich_ab && <span style={{ fontSize: 8, color: "#475569" }} title="Uses AbuseIPDB">🛡️ AB</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {pb.description}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: "flex", gap: 16, flexShrink: 0, fontSize: 9, color: "#475569", textAlign: "center" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: pb.times_triggered > 0 ? "#38bdf8" : "#334155" }}>{pb.times_triggered || 0}</div>
                      <div style={{ letterSpacing: 1 }}>TRIGGERED</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: playbookIncidentCount(pb.name) > 0 ? "#fbbf24" : "#334155" }}>{playbookIncidentCount(pb.name)}</div>
                      <div style={{ letterSpacing: 1 }}>INCIDENTS</div>
                    </div>
                    {pb.last_triggered_at && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b" }}>
                          {new Date(pb.last_triggered_at * 1000).toLocaleTimeString()}
                        </div>
                        <div style={{ letterSpacing: 1 }}>LAST HIT</div>
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => onToggle(pb.name, !pb.enabled)} disabled={!wsReady} style={{
                      padding: "4px 10px", borderRadius: 5, border: "none",
                      background: pb.enabled ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
                      color: pb.enabled ? "#4ade80" : "#64748b",
                      fontSize: 9, fontWeight: 700, cursor: wsReady ? "pointer" : "not-allowed", fontFamily: "inherit",
                    }}>{pb.enabled ? "ON" : "OFF"}</button>
                    <button onClick={() => handleEdit(pb)} title="Edit playbook" style={{
                      padding: "4px 8px", borderRadius: 5,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                      color: "#64748b", fontSize: 11, cursor: "pointer",
                    }}>✏️</button>
                    <button onClick={() => setConfirmDelete(pb.name)} title="Delete playbook" style={{
                      padding: "4px 8px", borderRadius: 5,
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
                      color: "#ef4444", fontSize: 11, cursor: "pointer",
                    }}>🗑️</button>
                    <span style={{ fontSize: 14, color: "#334155", padding: "4px 2px" }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* ── Detail View ─────────────────────────────────────── */}
                {isExpanded && (
                  <div style={{ borderTop: "1px solid rgba(56,189,248,0.08)", padding: "16px 20px" }}>

                    {/* Trigger plain English */}
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16, lineHeight: 1.7,
                      padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 8,
                      borderLeft: `3px solid ${tm.color}`,
                    }}>
                      <span style={{ fontWeight: 600, color: tm.color }}>Trigger: </span>
                      {triggerPlainEnglish(pb)}
                    </div>

                    {/* Pipeline */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 8 }}>EXECUTION PIPELINE</div>
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
                          color="#38bdf8"
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
                          color="#4ade80"
                          active={(pb.recommended_actions || []).length > 0}
                        />
                      </div>
                    </div>

                    {/* Description */}
                    {pb.description && (
                      <div style={{ marginBottom: 14, fontSize: 11, color: "#64748b", lineHeight: 1.7 }}>
                        {pb.description}
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                      {/* Recommended actions */}
                      <div>
                        <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 8 }}>
                          RECOMMENDED ACTIONS — <span style={{ color: sm.color }}>{pb.severity}</span> THRESHOLD
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {(pb.recommended_actions || []).map((action, i) => (
                            <div key={i} style={{ display: "flex", gap: 8, fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
                              <span style={{ color: "#334155", flexShrink: 0 }}>{i + 1}.</span>
                              <span>{action}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Related incidents */}
                      <div>
                        <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5, marginBottom: 8 }}>
                          INCIDENTS GENERATED ({pbIncidents.length})
                        </div>
                        {pbIncidents.length === 0 ? (
                          <div style={{ fontSize: 10, color: "#334155" }}>No incidents yet.</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {pbIncidents.slice(0, 5).map((inc) => {
                              const sm2 = SEV_META[inc.severity] || {};
                              return (
                                <div key={inc.id} style={{
                                  padding: "6px 10px", borderRadius: 6, fontSize: 10,
                                  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                                  display: "flex", alignItems: "center", gap: 8,
                                }}>
                                  <span style={{ fontSize: 8, color: sm2.color || "#64748b", fontWeight: 700,
                                    padding: "1px 5px", borderRadius: 3, background: sm2.bg || "transparent",
                                  }}>{inc.severity}</span>
                                  <span style={{ color: "#94a3b8", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{inc.title}</span>
                                  <span style={{ color: "#334155", fontSize: 9, flexShrink: 0 }}>{inc.status}</span>
                                </div>
                              );
                            })}
                            {pbIncidents.length > 5 && (
                              <div style={{ fontSize: 9, color: "#475569" }}>+{pbIncidents.length - 5} more in Incidents tab</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Dry run */}
                    <div style={{ paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: drResult ? 10 : 0 }}>
                        <button onClick={() => onDryRun(pb.name)} disabled={!wsReady || drLoading} style={{
                          padding: "7px 16px", borderRadius: 7, border: "1px solid rgba(56,189,248,0.25)",
                          background: "rgba(56,189,248,0.08)", color: "#38bdf8",
                          fontSize: 10, fontWeight: 700, cursor: wsReady && !drLoading ? "pointer" : "not-allowed",
                          fontFamily: "inherit", opacity: wsReady ? 1 : 0.5,
                        }}>
                          {drLoading ? "⏳ Testing…" : "🧪 Test Playbook"}
                        </button>
                        <span style={{ fontSize: 9, color: "#334155" }}>
                          Dry run — checks against current connections. No incidents created.
                        </span>
                        {drResult && (
                          <span style={{ fontSize: 9, color: "#475569", marginLeft: "auto" }}>
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
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>
                                  ⚡ Would fire — {r.matches.length} match{r.matches.length !== 1 ? "es" : ""}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  {r.matches.slice(0, 5).map((m, i) => (
                                    <div key={i} style={{ fontSize: 10, color: "#94a3b8", display: "flex", gap: 8 }}>
                                      <span style={{ color: "#64748b" }}>{m.app || m.ip || "—"}</span>
                                      <span style={{ color: "#334155" }}>→</span>
                                      <span style={{ color: "#475569" }}>{m.host || m.ip || "—"}</span>
                                      <span style={{ color: "#334155", fontStyle: "italic" }}>{m.reason}</span>
                                    </div>
                                  ))}
                                  {r.matches.length > 5 && <div style={{ fontSize: 9, color: "#475569" }}>+{r.matches.length - 5} more</div>}
                                </div>
                              </>
                            ) : (
                              <div style={{ fontSize: 10, color: "#4ade80" }}>
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
        background: "rgba(255,255,255,0.01)", border: "1px solid rgba(56,189,248,0.07)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 2, fontWeight: 700 }}>PLAYBOOK ACTIVITY FEED</div>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={activityFilter.name}
              onChange={(e) => setActivityFilter((p) => ({ ...p, name: e.target.value }))}
              style={{ ...INPUT_STYLE, width: "auto", fontSize: 9, padding: "3px 8px" }}
            >
              <option value="">All playbooks</option>
              {playbooks.map((pb) => <option key={pb.name} value={pb.name}>{pb.display_name}</option>)}
            </select>
            <select
              value={activityFilter.severity}
              onChange={(e) => setActivityFilter((p) => ({ ...p, severity: e.target.value }))}
              style={{ ...INPUT_STYLE, width: "auto", fontSize: 9, padding: "3px 8px" }}
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
                    <span style={{ fontSize: 9, color: "#475569", flexShrink: 0, width: 60 }}>{entry.time_str}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "#64748b", flexShrink: 0, width: 140, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {entry.playbook_display}
                    </span>
                    <span style={{ flex: 1, fontSize: 10, color: "#94a3b8", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {entry.trigger_event}
                    </span>
                    <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: sm2.bg || "transparent", color: sm2.color || "#64748b", flexShrink: 0 }}>
                      {entry.severity}
                    </span>
                    <span style={{
                      fontSize: 8, padding: "1px 6px", borderRadius: 3, flexShrink: 0,
                      background: isNew ? "rgba(74,222,128,0.1)" : "rgba(100,116,139,0.08)",
                      color: isNew ? "#4ade80" : "#475569",
                    }}>
                      {isNew ? "NEW INCIDENT" : "DEDUP"}
                    </span>
                    <span style={{ color: "#334155", fontSize: 10 }}>{isEx ? "▲" : "▼"}</span>
                  </div>
                  {isEx && (
                    <div style={{ padding: "6px 12px 10px 42px", fontSize: 10, color: "#475569", lineHeight: 1.6, borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                      <span style={{ color: "#64748b" }}>Incident ID:</span>{" "}
                      <code style={{ color: "#38bdf8" }}>{entry.incident_id}</code>
                      {" · "}
                      <span style={{ color: "#64748b" }}>Result:</span>{" "}
                      {isNew ? "New incident created" : "Merged into existing open incident"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 9, color: "#1e293b", marginTop: 8 }}>
          Showing last {filteredActivity.length} entries · Resets on backend restart
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SETTINGS TAB — begins below
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ════════════════════════════════════════════════════════════════════
const FLOWSTATE_VERSION = "1.0.0";

function SettingsSection({ title, children }) {
  return (
    <div style={{
      marginBottom: 24, padding: "20px 24px", borderRadius: 12,
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(56,189,248,0.08)",
    }}>
      <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 2, marginBottom: 16, fontWeight: 700 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SettingsField({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{label}</label>
        {hint && <span style={{ fontSize: 9, color: "#475569" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function KeyStatusDot({ masked }) {
  const isSet = masked && masked.length > 0;
  return (
    <span title={isSet ? "Key is set" : "No key configured"} style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: isSet ? "#4ade80" : "#334155",
      boxShadow: isSet ? "0 0 6px #4ade80" : "none",
      marginLeft: 6, verticalAlign: "middle", flexShrink: 0,
    }} />
  );
}

function SettingsTab({ settings, soarStats, onSave, onRefreshFeeds, wsReady }) {
  // Draft mirrors settings; user edits draft, saves to backend
  const [draft, setDraft]     = useState(() => settings);
  const [vtKey, setVtKey]     = useState("");  // new key input (blank = unchanged)
  const [abKey, setAbKey]     = useState("");  // new key input (blank = unchanged)
  const [saving, setSaving]   = useState(false);

  // Sync draft when settings change from backend
  useEffect(() => { setDraft(settings); }, [settings]);

  const set = (section, key, value) =>
    setDraft((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));

  const handleSave = (section) => {
    const payload = { ...draft };
    // Inject new key values only if the user actually typed something
    if (section === "threat_intel" || section === "all") {
      if (vtKey.trim()) payload.threat_intel = { ...payload.threat_intel, virustotal_api_key: vtKey.trim() };
      if (abKey.trim()) payload.threat_intel = { ...payload.threat_intel, abuseipdb_api_key:  abKey.trim() };
    }
    onSave(section === "all" ? payload : { [section]: payload[section] });
    setSaving(true);
    setTimeout(() => setSaving(false), 1500);
    if (section === "threat_intel" || section === "all") {
      setVtKey(""); setAbKey("");
    }
  };

  const ti        = draft.threat_intel  || {};
  const alerts    = draft.alerts        || {};
  const display   = draft.display       || {};
  const feeds     = soarStats?.feeds    || [];

  return (
    <div style={{ maxWidth: 760 }}>

      {/* ── API Keys ─────────────────────────────────────────────── */}
      <SettingsSection title="API KEYS — THREAT INTELLIGENCE">
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 16, lineHeight: 1.7 }}>
          Add your own API keys to enable live threat lookups. Free tiers are
          sufficient for personal use. Keys are stored locally in{" "}
          <code style={{ color: "#38bdf8", fontSize: 10 }}>data/settings.json</code>{" "}
          and never transmitted off your machine.
        </div>

        <SettingsField
          label={<>VirusTotal API Key <KeyStatusDot masked={ti.virustotal_api_key} /></>}
          hint={ti.virustotal_api_key ? `Currently set: ${ti.virustotal_api_key}` : "Not configured"}
        >
          <input
            type="password" placeholder={ti.virustotal_api_key ? "Enter new key to replace…" : "Paste your API key…"}
            value={vtKey} onChange={(e) => setVtKey(e.target.value)}
            style={INPUT_STYLE}
            autoComplete="new-password"
          />
          <div style={{ marginTop: 5, fontSize: 9, color: "#475569" }}>
            Free tier: 4 req/min · 500 req/day ·{" "}
            <span style={{ color: "#38bdf8", cursor: "pointer" }}
              onClick={() => window.open("https://www.virustotal.com/gui/join-us", "_blank")}>
              Get a free key at virustotal.com ↗
            </span>
          </div>
        </SettingsField>

        <SettingsField
          label={<>AbuseIPDB API Key <KeyStatusDot masked={ti.abuseipdb_api_key} /></>}
          hint={ti.abuseipdb_api_key ? `Currently set: ${ti.abuseipdb_api_key}` : "Not configured"}
        >
          <input
            type="password" placeholder={ti.abuseipdb_api_key ? "Enter new key to replace…" : "Paste your API key…"}
            value={abKey} onChange={(e) => setAbKey(e.target.value)}
            style={INPUT_STYLE}
            autoComplete="new-password"
          />
          <div style={{ marginTop: 5, fontSize: 9, color: "#475569" }}>
            Free tier: 1 000 checks/day ·{" "}
            <span style={{ color: "#38bdf8", cursor: "pointer" }}
              onClick={() => window.open("https://www.abuseipdb.com/register", "_blank")}>
              Get a free key at abuseipdb.com ↗
            </span>
          </div>
        </SettingsField>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <button
            disabled={!wsReady || saving}
            onClick={() => handleSave("threat_intel")}
            style={{
              padding: "8px 20px", borderRadius: 7, border: "none", cursor: wsReady ? "pointer" : "not-allowed",
              background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff",
              fontSize: 11, fontWeight: 700, fontFamily: "inherit",
              opacity: wsReady ? 1 : 0.5,
            }}
          >
            {saving ? "Saving…" : "Save API Keys"}
          </button>
          <span style={{ fontSize: 10, color: "#475569" }}>
            {wsReady ? "Keys are stored locally only." : "Backend offline"}
          </span>
        </div>
      </SettingsSection>

      {/* ── Alert Thresholds ─────────────────────────────────────── */}
      <SettingsSection title="ALERT THRESHOLDS">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SettingsField label="Bandwidth alert threshold (MB/hr)" hint="per app">
            <input
              type="number" min={1} max={10000}
              value={alerts.bandwidth_threshold_mb ?? 100}
              onChange={(e) => set("alerts", "bandwidth_threshold_mb", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
          <SettingsField label="Poll interval (seconds)" hint="1–10">
            <input
              type="number" min={1} max={10} step={0.5}
              value={alerts.poll_interval_seconds ?? 1}
              onChange={(e) => set("alerts", "poll_interval_seconds", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
        </div>
        <SaveRow onSave={() => handleSave("alerts")} wsReady={wsReady} saving={saving} />
      </SettingsSection>

      {/* ── Display Settings ─────────────────────────────────────── */}
      <SettingsSection title="DISPLAY SETTINGS">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SettingsField label="Max connections shown" hint="per poll">
            <input
              type="number" min={10} max={1000}
              value={display.max_connections_shown ?? 100}
              onChange={(e) => set("display", "max_connections_shown", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
          <SettingsField label="Max apps shown" hint="per poll">
            <input
              type="number" min={5} max={200}
              value={display.max_apps_shown ?? 30}
              onChange={(e) => set("display", "max_apps_shown", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
        </div>
        <SaveRow onSave={() => handleSave("display")} wsReady={wsReady} saving={saving} />
      </SettingsSection>

      {/* ── Feed Management ──────────────────────────────────────── */}
      <SettingsSection title="THREAT FEED MANAGEMENT">
        {soarStats ? (
          <>
            <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
              {[
                { label: "TOTAL INDICATORS", value: soarStats.total_indicators?.toLocaleString() ?? "—", color: "#38bdf8" },
                { label: "EXACT IPs",         value: soarStats.exact_ips?.toLocaleString()         ?? "—", color: "#a78bfa" },
                { label: "CIDR RANGES",       value: soarStats.cidr_ranges?.toLocaleString()       ?? "—", color: "#fb923c" },
                { label: "FEEDS LOADED",      value: feeds.length,                                          color: "#4ade80" },
              ].map((s) => (
                <div key={s.label} style={{
                  flex: 1, minWidth: 110, padding: "10px 14px", borderRadius: 8,
                  background: `${s.color}0d`, border: `1px solid ${s.color}22`,
                }}>
                  <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.2, marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {feeds.length > 0 && (
              <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(56,189,248,0.08)", marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ background: "rgba(56,189,248,0.04)" }}>
                      {["Feed", "Indicators", "Type", "Last Updated"].map((h) => (
                        <th key={h} style={{
                          padding: "8px 12px", textAlign: "left", fontSize: 9,
                          letterSpacing: 1.2, color: "#64748b", fontWeight: 600,
                          borderBottom: "1px solid rgba(56,189,248,0.06)",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {feeds.map((f, i) => (
                      <tr key={i} style={{
                        background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                        borderBottom: "1px solid rgba(255,255,255,0.03)",
                      }}>
                        <td style={{ padding: "8px 12px", fontWeight: 600, color: "#e2e8f0" }}>
                          <span style={{ fontSize: 12, marginRight: 6 }}>
                            {f.count > 0 ? "✅" : "⚠️"}
                          </span>
                          {f.name}
                        </td>
                        <td style={{ padding: "8px 12px", color: "#38bdf8" }}>
                          {(f.count ?? 0).toLocaleString()}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{
                            padding: "2px 7px", borderRadius: 4, fontSize: 9,
                            background: "rgba(139,92,246,0.12)", color: "#a78bfa",
                          }}>
                            {f.type || "blocklist"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px", color: "#64748b", fontSize: 9 }}>
                          {f.updated_at || soarStats.loaded_at || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#475569", fontSize: 11, padding: "10px 0" }}>
            Threat intel engine not loaded — soar/ module may be missing.
          </div>
        )}

        <button
          disabled={!wsReady}
          onClick={onRefreshFeeds}
          style={{
            padding: "8px 20px", borderRadius: 7, border: "none",
            cursor: wsReady ? "pointer" : "not-allowed",
            background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)",
            color: "#38bdf8", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
            opacity: wsReady ? 1 : 0.5,
          }}
        >
          🔄 Update Feeds Now
        </button>
      </SettingsSection>

      {/* ── About ────────────────────────────────────────────────── */}
      <SettingsSection title="ABOUT FLOWSTATE">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "linear-gradient(135deg,#0ea5e9,#06b6d4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: "#0a0e17", fontWeight: 900,
            }}>⚡</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#38bdf8", letterSpacing: 1 }}>FLOWSTATE</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5 }}>
                v{FLOWSTATE_VERSION} · LOCAL NETWORK MONITOR
              </div>
            </div>
          </div>

          <div style={{
            padding: "12px 16px", borderRadius: 8,
            background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.12)",
            fontSize: 11, color: "#94a3b8", lineHeight: 1.8,
          }}>
            Made for the community — add your own API keys to enable live threat lookups.
            All monitoring is local. No data leaves your machine. Alert-only SOAR:
            nothing is blocked without your explicit confirmation.
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "⭐ GitHub", color: "#fbbf24" },
              { label: "📄 MIT License", color: "#4ade80" },
              { label: "🛡️ Alert-Only Mode", color: "#38bdf8" },
            ].map((b) => (
              <span key={b.label} style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                background: `${b.color}12`, border: `1px solid ${b.color}30`, color: b.color,
              }}>
                {b.label}
              </span>
            ))}
          </div>

          <div style={{ fontSize: 9, color: "#334155", marginTop: 4 }}>
            Stack: Python 3.10+ · psutil · websockets · React 18 · Vite · d3
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

// Small inline save row used inside threshold/display sections
function SaveRow({ onSave, wsReady, saving }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
      <button
        disabled={!wsReady || saving}
        onClick={onSave}
        style={{
          padding: "7px 18px", borderRadius: 7, border: "none",
          cursor: wsReady ? "pointer" : "not-allowed",
          background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff",
          fontSize: 11, fontWeight: 700, fontFamily: "inherit",
          opacity: wsReady ? 1 : 0.5,
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════
export default function NetMonitor() {
  const [tab, setTab] = useState("graph");
  const [history, setHistory] = useState([]);               // { sent, recv, time }
  const [apps, setApps] = useState([]);
  const [appHistory, setAppHistory] = useState({});         // 300 s per-app recv history
  const [totalSent, setTotalSent] = useState(0);
  const [totalRecv, setTotalRecv] = useState(0);
  const [blockedApps, setBlockedApps] = useState(new Set());
  const [alerts, setAlerts] = useState([]);
  const [connections, setConnections] = useState([]);
  const [threats, setThreats] = useState([]);               // [{ip,feed,category,severity,...}]
  const [soarStats, setSoarStats] = useState(null);         // engine metadata
  const [incidents, setIncidents] = useState([]);           // correlated incident list
  // Phase 3 — Response Engine
  const [pendingAction, setPendingAction] = useState(null); // confirmation modal
  const [auditLog, setAuditLog]           = useState([]);
  const [blocklist, setBlocklist]         = useState([]);
  const [blockedIps, setBlockedIps]       = useState([]);
  const [undoStack, setUndoStack]         = useState([]);
  const [toasts, setToasts]               = useState([]);
  // Phase 4 — Threat Intel API + Playbooks
  const [threatIntelCache, setThreatIntelCache] = useState({}); // ip → result dict
  const [lookupLoading, setLookupLoading]       = useState(new Set()); // IPs in-flight
  const [tiPanelIp, setTiPanelIp]               = useState(null);      // open TI panel
  const [playbooks, setPlaybooks]               = useState([]);         // loaded playbooks
  const [playbookActivity, setPlaybookActivity] = useState([]);         // execution log
  const [dryRunResults, setDryRunResults]       = useState({});         // name → {results, ts}
  const [dryRunLoading, setDryRunLoading]       = useState(null);       // pb name being tested
  const [settings, setSettings]           = useState({
    threat_intel: { virustotal_api_key: "", abuseipdb_api_key: "", auto_lookup_flagged: true, cache_ttl_hours: 24 },
    alerts:       { bandwidth_threshold_mb: 100, poll_interval_seconds: 1 },
    display:      { max_connections_shown: 100, max_apps_shown: 30 },
  });
  const [newBlocklistIp, setNewBlocklistIp] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedApp, setSelectedApp] = useState(null);
  const [askToConnect, setAskToConnect] = useState(false);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [gateway, setGateway] = useState("");
  const [localIp, setLocalIp] = useState("");
  const [lanDevices, setLanDevices] = useState([]);
  const wsRef = useRef(null);
  const graphContainerRef = useRef(null);
  const graphWidth = useContainerWidth(graphContainerRef, 760);

  // ── WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    let ws, reconnectTimer, dead = false;

    function connect() {
      if (dead) return;
      setWsStatus("connecting");
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = async () => {
        // Stay "connecting" until the backend replies with auth_ok.
        // Obtain auth token. Inside Tauri it always comes from the Rust side.
        // VITE_WS_TOKEN is only read in the Vite dev server outside Tauri;
        // the import.meta.env.DEV guard lets the production build drop it.
        let token = "";
        if (isTauri()) {
          try {
            token = await invoke("get_ws_token");
          } catch (err) {
            console.error("get_ws_token failed:", err);
          }
        } else if (import.meta.env.DEV) {
          token = import.meta.env.VITE_WS_TOKEN || "";
        }
        if (ws.readyState !== WebSocket.OPEN) return;   // closed during invoke
        ws.send(JSON.stringify({ action: "auth", token }));
        ws.send(JSON.stringify({ action: "get_settings" }));
      };

      ws.onmessage = ({ data: raw }) => {
        const data = JSON.parse(raw);

        // ── Auth confirmation ─────────────────────────────────────────
        if (data.type === "auth_ok") {
          setWsStatus("connected");
          return;
        }

        // ── Settings responses ────────────────────────────────────────
        if (data.type === "settings_response") {
          setSettings(data.settings || {});
          return;
        }

        // ── Action results (targeted responses, not poll broadcasts) ──
        if (data.type === "action_result") {
          if (data.success) {
            addToast("success", data.details || `${data.action} completed`);
          } else {
            addToast("error", data.error || `${data.action} failed`);
          }
          return;
        }

        // ── Phase 4: Playbook dry run result ─────────────────────────
        if (data.type === "dry_run_result") {
          setDryRunLoading(null);
          const byName = {};
          (data.results || []).forEach((r) => { byName[r.playbook_name] = r; });
          setDryRunResults((prev) => ({
            ...prev,
            ...Object.fromEntries(
              Object.entries(byName).map(([k, v]) => [k, { results: [v], ts: Date.now() }])
            ),
          }));
          if (data.error) addToast("error", data.error);
          return;
        }

        // ── Phase 4: Threat Intel lookup result ───────────────────────
        if (data.type === "threat_intel_result") {
          const ip = data.ip;
          setThreatIntelCache((prev) => ({ ...prev, [ip]: data.result }));
          setLookupLoading((prev) => { const n = new Set(prev); n.delete(ip); return n; });
          if (data.result?.error) {
            addToast("error", `Lookup failed for ${ip}: ${data.result.error}`);
          } else {
            addToast("success", `Threat intel ready for ${ip}`);
          }
          return;
        }

        const liveApps = data.apps.map((app) => ({ ...app, icon: getAppIcon(app.name) }));
        setApps(liveApps);
        setBlockedApps(new Set(liveApps.filter((a) => a.blocked).map((a) => a.name)));
        setTotalSent((p) => p + (data.total_sent || 0));
        setTotalRecv((p) => p + (data.total_recv || 0));

        // Rolling 2-min history for the graph
        setHistory(prev => [...prev.slice(-119), {recv: data.total_recv, sent: data.total_sent, time: Date.now()}]);

        // Per-app history: keep 300 samples (5 min at 1 Hz)
        setAppHistory((prev) => {
          const next = { ...prev };
          liveApps.forEach((app) => {
            const arr = next[app.name] ? [...next[app.name]] : [];
            arr.push(app.recv || 0);
            next[app.name] = arr.length > 300 ? arr.slice(-300) : arr;
          });
          return next;
        });

        setConnections(data.connections || []);
        setAlerts(data.alerts || []);
        setThreats(data.threats || []);
        if (data.soar_stats) setSoarStats(data.soar_stats);
        if (data.incidents !== undefined) setIncidents(data.incidents || []);
        if (data.audit_log  !== undefined) setAuditLog(data.audit_log   || []);
        if (data.blocklist  !== undefined) setBlocklist(data.blocklist   || []);
        if (data.blocked_ips !== undefined) setBlockedIps(data.blocked_ips || []);
        if (data.undo_stack !== undefined) setUndoStack(data.undo_stack  || []);
        if (data.gateway !== undefined) setGateway(data.gateway || "");
        if (data.local_ip !== undefined) setLocalIp(data.local_ip || "");
        if (data.lan_devices !== undefined) setLanDevices(data.lan_devices || []);
        if (data.playbooks          !== undefined) setPlaybooks(data.playbooks || []);
        if (data.playbook_activity  !== undefined) setPlaybookActivity(data.playbook_activity || []);
        // Merge any inline threat_intel results from connections into cache
        if (data.connections) {
          const incoming = {};
          data.connections.forEach((c) => {
            if (c.remote && c.threat_intel) incoming[c.remote] = c.threat_intel;
          });
          if (Object.keys(incoming).length > 0) {
            setThreatIntelCache((prev) => ({ ...prev, ...incoming }));
          }
        }
      };

      ws.onclose = (ev) => {
        if (dead) return;
        if (ev.code === 4401) {
          // Wrong/missing token: retrying cannot succeed, so stop reconnecting.
          dead = true;
          setWsStatus("auth_failed");
          return;
        }
        setWsStatus("disconnected");
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { dead = true; clearTimeout(reconnectTimer); if (ws) ws.close(); };
  }, []);

  const toggleBlock = (name) => {
    const isBlocked = blockedApps.has(name);
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ action: isBlocked ? "unblock" : "block", app: name }));
    setBlockedApps((prev) => { const n = new Set(prev); isBlocked ? n.delete(name) : n.add(name); return n; });
  };

  const acknowledgeIncident = (id) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ action: "acknowledge_incident", id }));
    setIncidents((prev) =>
      prev.map((i) => i.id === id && i.status === "OPEN" ? { ...i, status: "ACKNOWLEDGED" } : i)
    );
  };

  const resolveIncident = (id) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ action: "resolve_incident", id }));
    setIncidents((prev) =>
      prev.map((i) => i.id === id && i.status !== "RESOLVED" ? { ...i, status: "RESOLVED" } : i)
    );
  };

  // ── Response Engine action helpers ──────────────────────────────────
  // triggerAction opens the confirmation modal.
  // The 6th arg `dangerous` marks non-reversible actions (kill, etc.)
  const triggerAction = (action, params, title, description, command = "", dangerous = false) => {
    setPendingAction({ action, params, title, description, command, dangerous });
  };

  const confirmAction = () => {
    if (!pendingAction) return;
    const { action, params } = pendingAction;
    const cmd = { action, ...params, confirm: true };
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(cmd));
    setPendingAction(null);
  };

  const cancelAction = () => setPendingAction(null);

  const addToast = (type, message) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  };

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const saveSettings = (partialSettings) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "save_settings", settings: partialSettings, confirm: true }));
  };

  const refreshFeeds = () => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "refresh_feeds" }));
  };

  // Phase 4 — send a manual IP lookup request to the backend
  const sendLookup = (ip) => {
    if (!ip || wsRef.current?.readyState !== WebSocket.OPEN) return;
    setLookupLoading((prev) => new Set([...prev, ip]));
    wsRef.current.send(JSON.stringify({ action: "lookup_ip", ip }));
  };

  const toggleTiPanel = (ip) => {
    setTiPanelIp((prev) => (prev === ip ? null : ip));
  };

  const togglePlaybook = (name, enabled) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "toggle_playbook", name, enabled }));
    setPlaybooks((prev) => prev.map((pb) => pb.name === name ? { ...pb, enabled } : pb));
  };

  const dryRunPlaybook = (name) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    setDryRunLoading(name || "all");
    wsRef.current.send(JSON.stringify({ action: "dry_run_playbook", name: name || null }));
  };

  const savePlaybook = (yaml, filename) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "save_playbook", yaml, filename, confirm: true }));
  };

  const deletePlaybook = (name) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "delete_playbook", name, confirm: true }));
  };

  const reloadPlaybooks = () => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "reload_playbooks" }));
  };

  // Smoothed rates: average last 5 polls to avoid 0-spike display
  const smoothRate = (field) => {
    if (history.length === 0) return 0;
    const s = history.slice(-5);
    return s.reduce((acc, h) => acc + (h[field] || 0), 0) / s.length;
  };

  const filteredApps = apps.filter((a) => a.name.toLowerCase().includes(searchFilter.toLowerCase()));
  const filteredConns = selectedApp ? connections.filter((c) => c.app === selectedApp) : connections;
  const severityColor = { info: "#38bdf8", warning: "#fbbf24", danger: "#ef4444" };
  const severityBg = { info: "rgba(56,189,248,0.1)", warning: "rgba(251,191,36,0.1)", danger: "rgba(239,68,68,0.1)" };
  const wsStatusColor = { connecting: "#fbbf24", connected: "#22c55e", disconnected: "#ef4444", auth_failed: "#ef4444" }[wsStatus];

  const threatCount = threats.length;
  const openIncidentCount = incidents.filter((i) => i.status === "OPEN").length;
  const criticalIncidentCount = incidents.filter((i) => i.status === "OPEN" && i.severity === "CRITICAL").length;

  const _dlRate = formatRateDetailed(smoothRate("recv"));
  const _ulRate = formatRateDetailed(smoothRate("sent"));
  const statCards = [
    { label: "DOWNLOAD RATE", value: _dlRate.main, rateSub: _dlRate.sub, color: "#38bdf8", bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.12)", trend: <TrendBadge history={history} field="recv" /> },
    { label: "UPLOAD RATE", value: _ulRate.main, rateSub: _ulRate.sub, color: "#fb923c", bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.12)", trend: <TrendBadge history={history} field="sent" /> },
    { label: "ACTIVE APPS", value: apps.filter((a) => !blockedApps.has(a.name)).length, color: "#a78bfa", bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.12)", trend: null },
    { label: "CONNECTIONS", value: connections.length, color: "#4ade80", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.12)", trend: null },
    {
      label: "THREATS",
      value: threatCount,
      color: threatCount > 0 ? "#ef4444" : "#334155",
      bg: threatCount > 0 ? "rgba(239,68,68,0.10)" : "rgba(51,65,85,0.06)",
      border: threatCount > 0 ? "rgba(239,68,68,0.25)" : "rgba(51,65,85,0.12)",
      trend: soarStats
        ? <div style={{ fontSize: 9, color: "#475569", marginTop: 4 }}>{(soarStats.total_indicators || 0).toLocaleString()} indicators loaded</div>
        : <div style={{ fontSize: 9, color: "#334155", marginTop: 4 }}>no feeds loaded</div>,
    },
    {
      label: "INCIDENTS",
      value: openIncidentCount,
      color: criticalIncidentCount > 0 ? "#ef4444" : openIncidentCount > 0 ? "#fbbf24" : "#334155",
      bg:    criticalIncidentCount > 0 ? "rgba(239,68,68,0.10)" : openIncidentCount > 0 ? "rgba(251,191,36,0.08)" : "rgba(51,65,85,0.06)",
      border: criticalIncidentCount > 0 ? "rgba(239,68,68,0.25)" : openIncidentCount > 0 ? "rgba(251,191,36,0.2)" : "rgba(51,65,85,0.12)",
      trend: <div style={{ fontSize: 9, color: "#475569", marginTop: 4 }}>
        {criticalIncidentCount > 0 ? `${criticalIncidentCount} CRITICAL` : openIncidentCount > 0 ? "open incidents" : "all clear"}
      </div>,
    },
  ];

  const tabs = [
    { id: "graph",       label: "📈 TRAFFIC" },
    { id: "analytics",   label: "📊 ANALYTICS" },
    { id: "map",         label: "🗺️ MAP" },
    { id: "firewall",    label: "🛡️ FIREWALL" },
    { id: "connections", label: "🔗 CONNECTIONS" },
    { id: "alerts",      label: `🔔 ALERTS${alerts.filter((a) => a.severity !== "info").length ? ` (${alerts.filter((a) => a.severity !== "info").length})` : ""}` },
    { id: "incidents",   label: `🚨 INCIDENTS${openIncidentCount ? ` (${openIncidentCount})` : ""}` },
    { id: "playbooks",   label: `📋 PLAYBOOKS${playbooks.length ? ` (${playbooks.length})` : ""}` },
    { id: "audit",       label: `🗒️ AUDIT${auditLog.length ? ` (${auditLog.length})` : ""}` },
    { id: "settings",    label: "⚙️ SETTINGS" },
  ];

  return (
    <div style={{ fontFamily: "'JetBrains Mono','Fira Code','SF Mono',monospace", background: "#060a12", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── HEADER ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid rgba(56,189,248,0.1)", background: "linear-gradient(180deg,rgba(56,189,248,0.04) 0%,transparent 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#0ea5e9,#06b6d4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#0a0e17", boxShadow: "0 0 20px rgba(14,165,233,0.3)" }}>⚡</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.5, color: "#38bdf8" }}>FLOWSTATE</div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 2 }}>LOCAL NETWORK MONITOR</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>TOTAL SESSION</div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: "#38bdf8" }}>↓ {formatBytes(totalRecv)}</span>
              <span style={{ margin: "0 8px", color: "#334155" }}>|</span>
              <span style={{ color: "#fb923c" }}>↑ {formatBytes(totalSent)}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: wsStatusColor, boxShadow: `0 0 8px ${wsStatusColor}`, animation: wsStatus === "connected" ? "pulse 2s infinite" : "none" }} />
            <div style={{ fontSize: 8, color: "#475569", letterSpacing: 0.5 }}>{wsStatus.replace("_", " ").toUpperCase()}</div>
          </div>
        </div>
      </div>

      <StatusBanner status={wsStatus} />

      {/* ── TAB BAR ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(56,189,248,0.08)", background: "#080c16" }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "10px 18px", background: tab === t.id ? "rgba(56,189,248,0.08)" : "transparent",
            border: "none", borderBottom: tab === t.id ? "2px solid #38bdf8" : "2px solid transparent",
            color: tab === t.id ? "#38bdf8" : "#64748b", fontSize: 11, fontWeight: 600, letterSpacing: 1.2,
            cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, padding: 20, overflow: "auto" }}>

        {/* ══ TRAFFIC TAB ══════════════════════════════════════════ */}
        {tab === "graph" && (
          <div>
            {/* Stat cards */}
            <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              {statCards.map((card) => (
                <div key={card.label} style={{ flex: 1, padding: "14px 18px", borderRadius: 10, background: `linear-gradient(135deg,${card.bg},${card.bg.replace("0.08","0.02")})`, border: `1px solid ${card.border}` }}>
                  <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 4 }}>{card.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
                  {card.rateSub && <div style={{ fontSize: 9, color: `${card.color}88`, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{card.rateSub}</div>}
                  {card.trend}
                </div>
              ))}
            </div>

            {/* Real-time traffic graph */}
            <div ref={graphContainerRef} style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#0a0e17", padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>REAL-TIME TRAFFIC <span style={{ color: "#475569", fontWeight: 400 }}>(last 2 min)</span></div>
                <div style={{ display: "flex", gap: 16, fontSize: 10 }}>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#38bdf8", marginRight: 4 }} />Download</span>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#fb923c", marginRight: 4 }} />Upload</span>
                </div>
              </div>
              <TrafficGraph history={history} width={graphWidth} height={260} />
            </div>

            {/* Per-app bandwidth bars with drill-in */}
            <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#0a0e17", padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1, marginBottom: 12 }}>
                TOP APPS BY BANDWIDTH <span style={{ color: "#475569", fontWeight: 400 }}>(solid = download, faded = upload)</span>
              </div>
              <AppBandwidthBarsWithDrillIn
                apps={apps}
                connections={connections}
                blockedApps={blockedApps}
                triggerAction={triggerAction}
                toggleBlock={toggleBlock}
              />
            </div>

            {/* Global connection map */}
            <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#0a0e17", padding: 16, marginBottom: 0 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1, marginBottom: 12 }}>
                GLOBAL CONNECTION MAP <span style={{ color: "#475569", fontWeight: 400 }}>(dot size = bandwidth · hover for details · click to inspect)</span>
              </div>
              <GlobalConnectionMap connections={connections} apps={apps} />
            </div>
          </div>
        )}

        {/* ══ ANALYTICS TAB ════════════════════════════════════════ */}
        {tab === "analytics" && (
          <div>
            {/* ── 1. Summary stat cards ─────────────────────────── */}
            <AnalyticsSummary apps={apps} connections={connections} />

            {/* ── 2. Bandwidth distribution + top hosts ─────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              {/* Donut chart */}
              <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: "18px 20px" }}>
                <SectionHeader
                  title="BANDWIDTH DISTRIBUTION"
                  desc="Share of total bandwidth consumed by each app (hover slices or legend to highlight)" />
                <DonutChart apps={apps} />
              </div>

              {/* Top destinations compact list */}
              <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: "18px 20px" }}>
                <SectionHeader
                  title="TOP DESTINATIONS"
                  desc="Most-connected remote hosts across all apps right now" />
                {connections.length === 0 ? (
                  <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>Waiting for connection data…</div>
                ) : (() => {
                  const hostMap = new Map();
                  connections.forEach((c) => {
                    if (!c.host) return;
                    if (!hostMap.has(c.host)) hostMap.set(c.host, { count: 0, apps: new Set() });
                    const e = hostMap.get(c.host);
                    e.count++;
                    if (c.app) e.apps.add(c.app);
                  });
                  const top = [...hostMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
                  const maxCount = top[0]?.[1].count || 1;
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {top.map(([host, info], i) => (
                        <div key={host}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
                            <span style={{ color: "#38bdf8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }} title={host}>{host}</span>
                            <span style={{ color: "#64748b" }}>{info.count} conn{info.count !== 1 ? "s" : ""}</span>
                          </div>
                          <div style={{ height: 5, background: "#0f1422", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(info.count / maxCount) * 100}%`, background: PALETTE[i % PALETTE.length], borderRadius: 3, transition: "width 0.3s" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* ── 3. Traffic flow (Sankey) ───────────────────────── */}
            <div style={{ marginBottom: 24 }}>
              <SectionHeader
                title="TRAFFIC FLOW"
                desc="Sankey diagram showing how bandwidth flows from each app to its network destinations. Link thickness is proportional to bandwidth. Hover links for exact rates." />
              <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: 16, overflow: "visible" }}>
                <SankeyChart apps={apps} connections={connections} />
              </div>
            </div>

            {/* ── 4. Top 10 connections table ────────────────────── */}
            <div style={{ marginBottom: 24 }}>
              <SectionHeader
                title="TOP 10 CONNECTIONS"
                desc="Aggregated by app + destination. Click column headers to sort. Bandwidth is estimated proportionally from each app's total." />
              <ConnectionsTable connections={connections} apps={apps} />
            </div>

            {/* ── 5. Treemap ─────────────────────────────────────── */}
            <div>
              <SectionHeader
                title="BANDWIDTH TREEMAP"
                desc="Tile area ∝ total bandwidth. Color intensity ∝ traffic level — brighter tiles are using more bandwidth. Hover any tile for detailed stats." />
              <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: 16 }}>
                <TreemapChart apps={apps} />
              </div>
            </div>
          </div>
        )}

        {/* ══ NETWORK MAP TAB ══════════════════════════════════════ */}
        {tab === "map" && (
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>
                NETWORK TOPOLOGY <span style={{ color: "#475569", fontWeight: 400 }}>— LAN · Router/Gateway · Internet</span>
              </div>
              {gateway && (
                <div style={{ fontSize: 10, color: "#475569" }}>
                  GW: <span style={{ color: "#f59e0b" }}>{gateway}</span>
                  {localIp && <> · PC: <span style={{ color: "#38bdf8" }}>{localIp}</span></>}
                  {lanDevices.length > 0 && <> · {lanDevices.length} ARP device{lanDevices.length !== 1 ? "s" : ""}</>}
                </div>
              )}
            </div>
            <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: 16 }}>
              <NetworkMap gateway={gateway} localIp={localIp} lanDevices={lanDevices} connections={connections} apps={apps} />
            </div>
          </div>
        )}

        {/* ══ FIREWALL TAB ═════════════════════════════════════════ */}
        {tab === "firewall" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: "linear-gradient(135deg,rgba(251,146,60,0.06),transparent)", border: "1px solid rgba(251,146,60,0.1)" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Ask to Connect Mode</div>
                <div style={{ fontSize: 10, color: "#64748b" }}>Prompt before new apps access the network</div>
              </div>
              <button onClick={() => setAskToConnect(!askToConnect)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: askToConnect ? "#22c55e" : "#334155", color: askToConnect ? "#0a0e17" : "#94a3b8", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: askToConnect ? "0 0 12px rgba(34,197,94,0.3)" : "none" }}>
                {askToConnect ? "ENABLED" : "DISABLED"}
              </button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <input type="text" placeholder="Search apps..." value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)}
                style={{ width: "100%", padding: "8px 14px", borderRadius: 8, background: "#0f1422", border: "1px solid rgba(56,189,248,0.1)", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            </div>
            {filteredApps.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>{apps.length === 0 ? "Waiting for data…" : "No apps match."}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filteredApps.map((app) => (
                  <div key={app.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ fontSize: 22 }}>{app.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{app.name}</div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>PID: {app.pid} · {app.connections} conns · ↓ {formatRate(app.recv)} · ↑ {formatRate(app.sent)}</div>
                    </div>
                    <Sparkline data={(appHistory[app.name] || []).slice(-60)} color={blockedApps.has(app.name) ? "#ef4444" : "#38bdf8"} w={60} h={40} />
                    {app.pid > 0 && (
                      <ActionBtn icon="☠️" label="Kill" color="#fb923c"
                        onClick={() => triggerAction(
                          "kill_process", { pid: app.pid, name: app.name },
                          `Kill Process: ${app.name}`,
                          `Terminate ${app.name} (PID ${app.pid}) immediately using taskkill /F.`,
                          `taskkill /PID ${app.pid} /F`,
                          true,
                        )}
                      />
                    )}
                    <button onClick={() => toggleBlock(app.name)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: blockedApps.has(app.name) ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", color: blockedApps.has(app.name) ? "#ef4444" : "#4ade80", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minWidth: 80 }}>
                      {blockedApps.has(app.name) ? "🚫 BLOCKED" : "✓ ALLOW"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Blocklist Manager ─────────────────────────────── */}
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: 1.5, marginBottom: 12 }}>BLOCKLIST MANAGER</div>

              {/* Session netsh blocks */}
              {blockedIps.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1, marginBottom: 8 }}>
                    ACTIVE IP BLOCKS (this session — Windows Firewall rules)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {blockedIps.map((ip) => (
                      <div key={ip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderRadius: 8, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                        <span style={{ color: "#ef4444", fontSize: 12 }}>🚫</span>
                        <span style={{ flex: 1, fontSize: 11, fontVariantNumeric: "tabular-nums", color: "#fca5a5" }}>{ip}</span>
                        <ActionBtn icon="✅" label="Unblock" color="#4ade80"
                          onClick={() => triggerAction(
                            "unblock_ip", { ip },
                            `Unblock IP ${ip}`,
                            `Remove Windows Firewall rules for ${ip}. Traffic to/from this IP will be permitted again.`,
                            `netsh advfirewall firewall delete rule name="FlowState Block OUT ${ip}"`,
                            false,
                          )}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Persistent blocklist */}
              <div>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1, marginBottom: 8 }}>
                  PERSISTENT BLOCKLIST (data/blocklist.txt — {blocklist.length} entries)
                </div>
                {blocklist.length === 0 ? (
                  <div style={{ color: "#334155", fontSize: 11, padding: "10px 0" }}>No IPs in blocklist.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
                    {blocklist.map((ip) => (
                      <div key={ip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 7, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <span style={{ flex: 1, fontSize: 11, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{ip}</span>
                        <ActionBtn icon="🚫" label="Block Now" color="#ef4444"
                          onClick={() => triggerAction(
                            "block_ip", { ip },
                            `Block IP ${ip}`,
                            `Add Windows Firewall rules to block all traffic to/from ${ip}.`,
                            `netsh advfirewall firewall add rule name="FlowState Block OUT ${ip}" dir=out action=block remoteip=${ip}`,
                            false,
                          )}
                        />
                        <ActionBtn icon="🗑️" label="Remove" color="#64748b"
                          onClick={() => triggerAction(
                            "remove_blocklist", { ip },
                            `Remove ${ip} from Blocklist`,
                            `Remove ${ip} from data/blocklist.txt. This does not remove any existing firewall rules.`,
                            `remove ${ip} from data/blocklist.txt`,
                            false,
                          )}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Add to blocklist form */}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text" placeholder="IP address (e.g. 1.2.3.4)"
                    value={newBlocklistIp} onChange={(e) => setNewBlocklistIp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newBlocklistIp.trim()) {
                        triggerAction("add_blocklist", { ip: newBlocklistIp.trim() },
                          `Add ${newBlocklistIp.trim()} to Blocklist`,
                          `Append ${newBlocklistIp.trim()} to data/blocklist.txt for persistent tracking.`,
                          `echo ${newBlocklistIp.trim()} >> data/blocklist.txt`, false);
                        setNewBlocklistIp("");
                      }
                    }}
                    style={{ flex: 1, padding: "7px 12px", borderRadius: 7, background: "#0f1422", border: "1px solid rgba(56,189,248,0.12)", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", outline: "none" }}
                  />
                  <ActionBtn icon="+" label="Add to Blocklist" color="#a78bfa"
                    onClick={() => {
                      if (!newBlocklistIp.trim()) return;
                      triggerAction("add_blocklist", { ip: newBlocklistIp.trim() },
                        `Add ${newBlocklistIp.trim()} to Blocklist`,
                        `Append ${newBlocklistIp.trim()} to data/blocklist.txt.`,
                        `echo ${newBlocklistIp.trim()} >> data/blocklist.txt`, false);
                      setNewBlocklistIp("");
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ CONNECTIONS TAB ══════════════════════════════════════ */}
        {tab === "connections" && (
          <div>
            {/* App filter buttons + threat summary banner */}
            <div style={{ display: "flex", gap: 8, marginBottom: threatCount > 0 ? 10 : 16, flexWrap: "wrap" }}>
              <button onClick={() => setSelectedApp(null)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: !selectedApp ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)", color: !selectedApp ? "#38bdf8" : "#94a3b8", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>ALL</button>
              {[...new Set(connections.map((c) => c.app))].map((app) => (
                <button key={app} onClick={() => setSelectedApp(app === selectedApp ? null : app)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: selectedApp === app ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)", color: selectedApp === app ? "#38bdf8" : "#94a3b8", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{app}</button>
              ))}
            </div>

            {/* Threat summary banner — only shown when threats are present */}
            {threatCount > 0 && (
              <div style={{
                marginBottom: 14, padding: "10px 14px", borderRadius: 8,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              }}>
                <span style={{ fontSize: 13 }}>⚠</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>
                  {threatCount} flagged connection{threatCount !== 1 ? "s" : ""}
                </span>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>
                  — matched against threat intelligence feeds. Alert-only mode: no traffic has been blocked.
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
                  {[...new Set(threats.map((t) => t.feed))].map((f) => (
                    <span key={f} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>{f}</span>
                  ))}
                </div>
              </div>
            )}

            {connections.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>Waiting for connection data…</div>
            ) : (
              <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(56,189,248,0.08)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "rgba(56,189,248,0.04)" }}>
                      {["App","Remote Host","IP Address","Port","Protocol","Status","Threat","Actions"].map((h) => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: h === "Threat" ? "#ef4444" : h === "Actions" ? "#a78bfa" : "#64748b", fontWeight: 600, borderBottom: "1px solid rgba(56,189,248,0.06)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredConns.map((c, i) => {
                      const isThreat = Boolean(c.threat);
                      const tiResult  = threatIntelCache[c.remote];
                      const tiScore   = tiResult?.risk_score ?? -1;
                      const tiActive  = tiPanelIp === c.remote;
                      // Row tint from TI score (overrides threat tint when higher confidence)
                      let rowBg = isThreat ? "rgba(239,68,68,0.06)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)";
                      let rowBorder = isThreat ? "1px solid rgba(239,68,68,0.15)" : "1px solid rgba(255,255,255,0.03)";
                      if (tiScore >= 70) { rowBg = "rgba(239,68,68,0.10)"; rowBorder = "1px solid rgba(239,68,68,0.25)"; }
                      else if (tiScore >= 40) { rowBg = "rgba(251,146,60,0.08)"; rowBorder = "1px solid rgba(251,146,60,0.2)"; }
                      else if (tiScore >= 15) { rowBg = "rgba(251,191,36,0.06)"; rowBorder = "1px solid rgba(251,191,36,0.15)"; }
                      return (
                        <tr key={i} style={{ background: rowBg, borderBottom: rowBorder }}>
                          <td style={{ padding: "8px 12px", fontWeight: 600, color: isThreat ? "#fca5a5" : undefined }}>{c.app}</td>
                          <td style={{ padding: "8px 12px", color: isThreat ? "#fca5a5" : "#38bdf8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.host}>{c.host}</td>
                          <td style={{ padding: "8px 12px", color: isThreat ? "#ef4444" : "#94a3b8", fontWeight: isThreat ? 700 : 400 }}>{c.remote}</td>
                          <td style={{ padding: "8px 12px" }}>{c.port}</td>
                          <td style={{ padding: "8px 12px" }}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>{c.protocol}</span></td>
                          <td style={{ padding: "8px 12px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.status === "ESTABLISHED" ? "#22c55e" : "#fbbf24" }} />
                              <span style={{ fontSize: 10, color: c.status === "ESTABLISHED" ? "#4ade80" : "#fbbf24" }}>{c.status}</span>
                            </span>
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            {isThreat
                              ? <ThreatBadge threat={c.threat} compact />
                              : tiScore >= 0
                                ? <span style={{ fontSize: 9, color: riskColor(tiScore).color, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: riskColor(tiScore).bg }}>{riskColor(tiScore).label}</span>
                                : <span style={{ color: "#1e293b", fontSize: 9 }}>—</span>
                            }
                          </td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", gap: 4 }}>
                              {c.remote && c.remote !== "N/A" && (
                                <ActionBtn icon="🚫" label="Block" color="#ef4444"
                                  title={`Block IP ${c.remote}`}
                                  onClick={() => triggerAction(
                                    "block_ip", { ip: c.remote },
                                    `Block IP ${c.remote}`,
                                    `Add Windows Firewall rules to block all inbound and outbound traffic to/from ${c.remote} (${c.app}).`,
                                    `netsh advfirewall firewall add rule name="FlowState Block ${c.remote}" dir=out action=block remoteip=${c.remote}`,
                                    true
                                  )}
                                />
                              )}
                              {c.pid && (
                                <ActionBtn icon="☠️" label="Kill" color="#fb923c"
                                  title={`Kill process ${c.app} (PID ${c.pid})`}
                                  onClick={() => triggerAction(
                                    "kill_process", { pid: c.pid, name: c.app },
                                    `Kill Process ${c.app}`,
                                    `Terminate process "${c.app}" (PID ${c.pid}) immediately with taskkill /F. All open connections from this process will be closed. This cannot be undone.`,
                                    `taskkill /PID ${c.pid} /F`,
                                    true
                                  )}
                                />
                              )}
                              <ActionBtn icon="📸" label="Snap" color="#38bdf8"
                                title="Capture network snapshot"
                                onClick={() => triggerAction(
                                  "capture_snapshot", {},
                                  "Capture Network Snapshot",
                                  "Save current connection state and process list to data/snapshots/{timestamp}.json for forensic review.",
                                  "Save snapshot to data/snapshots/",
                                  false
                                )}
                              />
                              {c.remote && c.remote !== "N/A" && (
                                <LookupBtn
                                  ip={c.remote}
                                  loading={lookupLoading.has(c.remote)}
                                  cached={Boolean(tiResult)}
                                  onClick={() => {
                                    if (!tiResult) sendLookup(c.remote);
                                    toggleTiPanel(c.remote);
                                  }}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ══ ALERTS TAB ═══════════════════════════════════════════ */}
        {tab === "alerts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>No alerts yet.</div>
            ) : (
              [...alerts].reverse().map((a, i) => (
                <div key={i} style={{ padding: "12px 16px", borderRadius: 10, background: severityBg[a.severity] || severityBg.info, border: `1px solid ${(severityColor[a.severity] || severityColor.info)}22`, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: severityColor[a.severity] || severityColor.info, boxShadow: `0 0 8px ${severityColor[a.severity] || severityColor.info}` }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{a.message}</div>
                    <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{a.type.toUpperCase()} · {a.time}</div>
                  </div>
                  <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: `${(severityColor[a.severity] || severityColor.info)}22`, color: severityColor[a.severity] || severityColor.info, letterSpacing: 0.5 }}>
                    {(a.severity || "info").toUpperCase()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* ══ INCIDENTS TAB ════════════════════════════════════════ */}
        {tab === "incidents" && (
          <IncidentsTab
            incidents={incidents}
            onAcknowledge={acknowledgeIncident}
            onResolve={resolveIncident}
            onAction={triggerAction}
            apps={apps}
          />
        )}

        {/* ══ PLAYBOOKS TAB ════════════════════════════════════════ */}
        {tab === "playbooks" && (
          <PlaybooksTab
            playbooks={playbooks}
            incidents={incidents}
            playbookActivity={playbookActivity}
            dryRunResults={dryRunResults}
            dryRunLoading={dryRunLoading}
            onToggle={togglePlaybook}
            onDryRun={dryRunPlaybook}
            onSave={savePlaybook}
            onDelete={deletePlaybook}
            onReload={reloadPlaybooks}
            wsReady={wsStatus === "connected"}
          />
        )}

        {/* ══ AUDIT TAB ════════════════════════════════════════════ */}
        {tab === "audit" && (
          <AuditLogTab auditLog={auditLog} undoStack={undoStack} onAction={triggerAction} />
        )}

        {/* ══ SETTINGS TAB ═════════════════════════════════════════ */}
        {tab === "settings" && (
          <SettingsTab
            settings={settings}
            soarStats={soarStats}
            onSave={saveSettings}
            onRefreshFeeds={refreshFeeds}
            wsReady={wsStatus === "connected"}
          />
        )}
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <div style={{ padding: "8px 24px", borderTop: "1px solid rgba(56,189,248,0.06)", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", background: "#080c16" }}>
        <span>FLOWSTATE v1.0 · Local Network Monitor</span>
        <span>Backend: ws://localhost:8765 · Status: {wsStatus.replace("_", " ").toUpperCase()}</span>
      </div>

      {/* ── CONFIRMATION MODAL + TOASTS ───────────────────────────── */}
      <ConfirmModal pending={pendingAction} onConfirm={confirmAction} onCancel={cancelAction} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Phase 4 — Threat Intel Panel */}
      {tiPanelIp && (
        <ThreatIntelPanel
          ip={tiPanelIp}
          result={threatIntelCache[tiPanelIp]}
          onClose={() => setTiPanelIp(null)}
        />
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
        @keyframes toastIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.2); border-radius: 3px; }
      `}</style>
    </div>
  );
}
