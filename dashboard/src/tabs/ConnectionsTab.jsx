import { ActionBtn } from "../components/ActionBtn";
import { LookupBtn } from "../components/LookupBtn";
import { ThreatBadge } from "../components/ThreatBadge";
import { riskColor } from "../lib/colors";
import { PANEL, T, withAlpha } from "../lib/theme";

export function ConnectionsTab({ connections, threats, threatIntelCache, lookupLoading, tiPanelIp, selectedApp, setSelectedApp, triggerAction, sendLookup, toggleTiPanel, threatCount }) {
  const filteredConns = selectedApp ? connections.filter((c) => c.app === selectedApp) : connections;

  return (
    <div>
      {/* App filter buttons + threat summary banner */}
      <div style={{ display: "flex", gap: 8, marginBottom: threatCount > 0 ? 10 : 16, flexWrap: "wrap" }}>
        <button onClick={() => setSelectedApp(null)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: !selectedApp ? withAlpha(T.accent, 0.15) : "rgba(255,255,255,0.04)", color: !selectedApp ? T.accent : T.textSecondary, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>ALL</button>
        {[...new Set(connections.map((c) => c.app))].map((app) => (
          <button key={app} onClick={() => setSelectedApp(app === selectedApp ? null : app)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: selectedApp === app ? withAlpha(T.accent, 0.15) : "rgba(255,255,255,0.04)", color: selectedApp === app ? T.accent : T.textSecondary, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{app}</button>
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
          <span style={{ fontSize: 11, fontWeight: 700, color: T.danger }}>
            {threatCount} flagged connection{threatCount !== 1 ? "s" : ""}
          </span>
          <span style={{ fontSize: 11, color: T.textSecondary }}>
            — matched against threat intelligence feeds. Alert-only mode: no traffic has been blocked.
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
            {[...new Set(threats.map((t) => t.feed))].map((f) => (
              <span key={f} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 3, background: "rgba(239,68,68,0.12)", color: T.danger, border: "1px solid rgba(239,68,68,0.2)" }}>{f}</span>
            ))}
          </div>
        </div>
      )}

      {connections.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: 12, padding: "20px 0" }}>Waiting for connection data…</div>
      ) : (
        <div style={{ ...PANEL, overflow: "clip" }}>
          <table className="fs-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: withAlpha(T.accent, 0.04) }}>
                {["App","Remote Host","IP Address","Port","Protocol","Status","Threat","Actions"].map((h) => (
                  <th key={h} style={{ fontFamily: T.fontLabel, padding: "10px 12px", textAlign: "left", fontSize: 11, letterSpacing: 1.5, color: h === "Threat" ? T.danger : h === "Actions" ? "#a78bfa" : T.textSecondary, fontWeight: 600, borderBottom: `1px solid ${withAlpha(T.accent, 0.06)}` }}>{h}</th>
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
                    <td style={{ padding: "8px 12px", color: isThreat ? "#fca5a5" : T.accent, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.host}>{c.host}</td>
                    <td style={{ padding: "8px 12px", color: isThreat ? T.danger : T.textSecondary, fontWeight: isThreat ? 700 : 400 }}>{c.remote}</td>
                    <td style={{ padding: "8px 12px" }}>{c.port}</td>
                    <td style={{ padding: "8px 12px" }}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>{c.protocol}</span></td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.status === "ESTABLISHED" ? "#22c55e" : T.warning }} />
                        <span style={{ fontSize: 11, color: c.status === "ESTABLISHED" ? T.success : T.warning }}>{c.status}</span>
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {isThreat
                        ? <ThreatBadge threat={c.threat} compact />
                        : tiScore >= 0
                          ? <span style={{ fontSize: 11, color: riskColor(tiScore).color, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: riskColor(tiScore).bg }}>{riskColor(tiScore).label}</span>
                          : <span style={{ color: "#1e293b", fontSize: 11 }}>—</span>
                      }
                    </td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {c.remote && c.remote !== "N/A" && (
                          <ActionBtn icon="🚫" label="Block" color={T.danger}
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
                        {c.pid > 0 && (
                          <ActionBtn icon="☠️" label="Kill" color={T.orange}
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
                        <ActionBtn icon="📸" label="Snap" color={T.accent}
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
  );
}
