import { useState } from "react";
import { ActionBtn } from "../components/ActionBtn";
import { INC_SEV } from "../lib/colors";
import { fmtRelTime } from "../lib/format";
import { T, withAlpha } from "../lib/theme";

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
  OPEN:         { color: T.danger, bg: "rgba(239,68,68,0.12)",    label: "OPEN"         },
  ACKNOWLEDGED: { color: T.warning, bg: "rgba(251,191,36,0.12)",   label: "ACKNOWLEDGED" },
  RESOLVED:     { color: T.success, bg: "rgba(34,197,94,0.10)",    label: "RESOLVED"     },
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
          fontSize: 11, fontWeight: 800, color: sev.color, letterSpacing: 1,
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
              color: isResolved ? T.textSecondary : T.text,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {incident.title}
            </div>
            {incident.source === "playbook" && (
              <span style={{
                flexShrink: 0, padding: "1px 6px", borderRadius: 4, fontSize: 11,
                background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)",
                color: T.warning, fontWeight: 700, letterSpacing: 0.5,
              }}>
                📋 PLAYBOOK
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap", fontSize: 11, color: T.textMuted }}>
            <span style={{ color: T.textSecondary }}>
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
          background: st.bg, fontSize: 11, fontWeight: 700, color: st.color,
          letterSpacing: 0.5,
        }}>
          {st.label}
        </div>

        {/* Chevron */}
        <div style={{ flexShrink: 0, color: T.textMuted, fontSize: 11, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${sev.border}`, padding: "14px 16px", background: "rgba(0,0,0,0.2)" }}>
          {/* Metadata row */}
          <div style={{ display: "flex", gap: 24, marginBottom: 14, flexWrap: "wrap" }}>
            {incident.processes.length > 0 && (
              <div>
                <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1, marginBottom: 4 }}>PROCESSES</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {incident.processes.map((p) => (
                    <span key={p} style={{ padding: "2px 7px", borderRadius: 4, background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)", fontSize: 11, color: "#a78bfa" }}>{p}</span>
                  ))}
                </div>
              </div>
            )}
            {incident.ips.length > 0 && (
              <div>
                <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1, marginBottom: 4 }}>IPs / DESTINATIONS</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {incident.ips.slice(0, 6).map((ip) => (
                    <span key={ip} style={{ padding: "2px 7px", borderRadius: 4, background: withAlpha(T.accent, 0.08), border: `1px solid ${withAlpha(T.accent, 0.2)}`, fontSize: 11, color: T.accent, fontVariantNumeric: "tabular-nums" }}>{ip}</span>
                  ))}
                  {incident.ips.length > 6 && (
                    <span style={{ fontSize: 11, color: T.textMuted }}>+{incident.ips.length - 6} more</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Alert timeline */}
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1, marginBottom: 8 }}>ALERT TIMELINE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14, maxHeight: 200, overflowY: "auto" }}>
            {incident.alerts.map((a, i) => (
              <div key={i} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "6px 10px", borderRadius: 6,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.04)",
                fontSize: 11,
              }}>
                <span style={{ color: T.textMuted, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{a.time}</span>
                <span style={{ color: T.textSecondary, flex: 1 }}>{a.message}</span>
                {a.rule && (
                  <span style={{ flexShrink: 0, fontSize: 11, padding: "1px 5px", borderRadius: 3, background: withAlpha(T.accent, 0.08), color: T.textSecondary }}>{a.rule}</span>
                )}
              </div>
            ))}
          </div>

          {/* Recommended actions */}
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1, marginBottom: 8 }}>RECOMMENDED ACTIONS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
            {incident.recommended_actions.map((action, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11 }}>
                <span style={{ color: sev.color, flexShrink: 0, marginTop: 1 }}>›</span>
                <span style={{ color: T.textSecondary }}>{action}</span>
              </div>
            ))}
          </div>

          {/* Response actions */}
          {onAction && !isResolved && (incident.ips.length > 0 || incident.processes.length > 0) && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1, marginBottom: 8 }}>RESPONSE ACTIONS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {incident.ips.slice(0, 5).map((ip) => (
                  <ActionBtn key={ip} icon="🚫" label={`Block ${ip}`} color={T.danger}
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
                    <ActionBtn key={proc} icon="☠️" label={`Kill ${proc}`} color={T.orange}
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
                <ActionBtn icon="📸" label="Snapshot" color={T.accent}
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
                    background: "rgba(251,191,36,0.15)", color: T.warning,
                    fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Acknowledge
                </button>
              )}
              <button
                onClick={() => onResolve(incident.id)}
                style={{
                  padding: "6px 16px", borderRadius: 6, border: "none",
                  background: "rgba(34,197,94,0.15)", color: T.success,
                  fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
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

export function IncidentsTab({ incidents, onAcknowledge, onResolve, onAction, apps }) {
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
          { label: "OPEN",         value: open.length,     color: T.danger },
          { label: "ACKNOWLEDGED", value: acked.length,    color: T.warning },
          { label: "RESOLVED",     value: resolved.length, color: T.success },
        ].map((s) => (
          <div key={s.label} style={{
            padding: "10px 16px", borderRadius: 8, flex: 1, minWidth: 100,
            background: `${s.color}0d`, border: `1px solid ${s.color}22`,
          }}>
            <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1.5, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
        {Object.entries(sevCounts).filter(([, v]) => v > 0).map(([sev, count]) => {
          const c = INC_SEV[sev];
          return (
            <div key={sev} style={{ padding: "10px 16px", borderRadius: 8, background: c.bg, border: `1px solid ${c.border}` }}>
              <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textMuted, letterSpacing: 1.5, marginBottom: 4 }}>{sev}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{count}</div>
            </div>
          );
        })}
      </div>

      {/* Alert-only mode notice */}
      <div style={{
        padding: "8px 14px", borderRadius: 8, marginBottom: 16,
        background: withAlpha(T.accent, 0.05), border: `1px solid ${withAlpha(T.accent, 0.12)}`,
        fontSize: 11, color: T.textMuted, display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ color: T.accent }}>ℹ</span>
        Alert-only mode — the correlator groups and recommends, never executes.
        No traffic has been blocked automatically.
      </div>

      {incidents.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: 12, padding: "40px 0", textAlign: "center" }}>
          No incidents yet — the correlator is watching for patterns.
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <>
              <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1.5, marginBottom: 10 }}>OPEN INCIDENTS</div>
              {open.map((inc) => (
                <IncidentCard key={inc.id} incident={inc} onAcknowledge={onAcknowledge} onResolve={onResolve} onAction={onAction} apps={apps} />
              ))}
            </>
          )}
          {acked.length > 0 && (
            <>
              <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1.5, margin: "16px 0 10px" }}>ACKNOWLEDGED</div>
              {acked.map((inc) => (
                <IncidentCard key={inc.id} incident={inc} onAcknowledge={onAcknowledge} onResolve={onResolve} onAction={onAction} apps={apps} />
              ))}
            </>
          )}
          {resolved.length > 0 && (
            <>
              <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1.5, margin: "16px 0 10px" }}>RESOLVED (last 10)</div>
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
