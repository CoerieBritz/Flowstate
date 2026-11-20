import { useState, useMemo } from "react";
import { PALETTE } from "../../lib/colors";
import { formatRate } from "../../lib/format";
import { T } from "../../lib/theme";

// ════════════════════════════════════════════════════════════════════
// APP BANDWIDTH BARS — horizontal stacked bars with click-to-drill-in
// ════════════════════════════════════════════════════════════════════
export function AppBandwidthBarsWithDrillIn({ apps, connections, blockedApps, triggerAction, toggleBlock }) {
  const [expandedApp, setExpandedApp] = useState(null);

  const top10 = useMemo(
    () => [...apps].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent)).slice(0, 10),
    [apps]
  );
  if (top10.length === 0) {
    return <div style={{ color: T.textMuted, fontSize: 12, padding: "20px 0" }}>Waiting for data…</div>;
  }
  const maxBw = Math.max(...top10.map((a) => a.recv + a.sent), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {top10.map((app, i) => {
        const recvPct = (app.recv / maxBw) * 100;
        const sentPct = (app.sent / maxBw) * 100;
        const color = PALETTE[i % PALETTE.length];
        const isExpanded = expandedApp === app.name;

        // Aggregate app's connections by destination
        const appConns = connections.filter((c) => c.app === app.name);
        const totalAppConns = appConns.length || 1;
        const destMap = new Map();
        appConns.forEach((c) => {
          const key = c.host || c.remote;
          if (!destMap.has(key)) destMap.set(key, { host: key, ip: c.remote, port: c.port, protocol: c.protocol, pid: c.pid, count: 0, bw: 0 });
          const d = destMap.get(key);
          d.count++;
          d.bw += ((app.recv + app.sent) * (1 / totalAppConns));
        });
        const dests = [...destMap.values()].sort((a, b) => b.bw - a.bw);
        const maxDestBw = Math.max(...dests.map((d) => d.bw), 1);

        return (
          <div key={app.name}>
            {/* Bar row — clickable */}
            <div
              onClick={() => setExpandedApp(isExpanded ? null : app.name)}
              style={{ cursor: "pointer", padding: "6px 0", borderRadius: isExpanded ? "6px 6px 0 0" : 6, transition: "background 0.15s",
                background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, marginBottom: 4 }}>
                <span style={{ color, fontWeight: 600 }}>
                  {isExpanded ? "▼ " : "▶ "}{app.icon} {app.name}
                </span>
                <span style={{ color: T.textSecondary }}>
                  <span style={{ color: T.download }}>↓{formatRate(app.recv)}</span>
                  {" "}
                  <span style={{ color: T.upload }}>↑{formatRate(app.sent)}</span>
                  <span style={{ marginLeft: 8, color: T.textMuted }}>{appConns.length} conn{appConns.length !== 1 ? "s" : ""}</span>
                </span>
              </div>
              <div style={{ height: 12, background: T.inset, borderRadius: 6, overflow: "hidden", display: "flex" }}>
                <div style={{ width: `${recvPct}%`, background: `${color}cc`, transition: "width 0.4s", borderRadius: "6px 0 0 6px" }} />
                <div style={{ width: `${sentPct}%`, background: `${color}55`, transition: "width 0.4s" }} />
              </div>
            </div>

            {/* Drill-in panel */}
            {isExpanded && (
              <div style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${color}22`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "12px 14px" }}>
                {/* Summary + actions */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: T.textSecondary }}>
                    <span style={{ color }}>{appConns.length}</span> connections · total <span style={{ color }}>{formatRate(app.recv + app.sent)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {app.pid > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); triggerAction("kill_process", { pid: app.pid, name: app.name }, `Kill Process: ${app.name}`, `Terminate ${app.name} (PID ${app.pid}) immediately.`, `taskkill /PID ${app.pid} /F`, true); }}
                        style={{ padding: "4px 10px", borderRadius: 5, border: "none", background: "rgba(251,146,60,0.15)", color: T.orange, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        ☠️ Kill
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleBlock(app.name); }}
                      style={{ padding: "4px 10px", borderRadius: 5, border: "none", background: blockedApps?.has(app.name) ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", color: blockedApps?.has(app.name) ? T.danger : T.success, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      {blockedApps?.has(app.name) ? "🚫 Blocked" : "🛡️ Block"}
                    </button>
                  </div>
                </div>

                {dests.length === 0 ? (
                  <div style={{ color: T.textMuted, fontSize: 11 }}>No active connections.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {dests.slice(0, 8).map((d) => (
                      <div key={d.host} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* Mini bar */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                            <span style={{ color: T.accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }} title={d.host}>{d.host}</span>
                            <span style={{ color: T.textSecondary, whiteSpace: "nowrap" }}>
                              :{d.port}
                              <span style={{ marginLeft: 6, padding: "1px 5px", borderRadius: 3, fontSize: 11, background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>{d.protocol}</span>
                              <span style={{ marginLeft: 6 }}>{d.count}×</span>
                            </span>
                          </div>
                          <div style={{ height: 5, background: T.inset, borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(d.bw / maxDestBw) * 100}%`, background: `${color}99`, transition: "width 0.3s", borderRadius: 3 }} />
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color, minWidth: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatRate(d.bw)}</div>
                      </div>
                    ))}
                    {dests.length > 8 && (
                      <div style={{ fontSize: 11, color: T.textMuted }}>+{dests.length - 8} more destinations</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 11, color: T.textMuted }}>
        <span><span style={{ display: "inline-block", width: 10, height: 6, background: `${T.download}cc`, borderRadius: 2, marginRight: 4 }} />Download (solid)</span>
        <span><span style={{ display: "inline-block", width: 10, height: 6, background: `${T.upload}55`, borderRadius: 2, marginRight: 4 }} />Upload (faded)</span>
        <span style={{ marginLeft: "auto" }}>Click any row to expand</span>
      </div>
    </div>
  );
}
