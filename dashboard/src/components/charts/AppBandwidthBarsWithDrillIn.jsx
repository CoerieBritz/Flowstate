import { useState, useMemo } from "react";
import { PALETTE } from "../../lib/colors";
import { formatRate } from "../../lib/format";
import { T, withAlpha } from "../../lib/theme";

const SEGMENTS = 48;          // segments per bar
const GENERIC_ICON = "💻";    // getAppIcon() fallback → show an initial instead

/** Thin bar of small rounded segments with 3px gaps; fills `frac` (0..1). */
function SegmentedBar({ frac, color }) {
  const exact = Math.max(0, Math.min(1, frac)) * SEGMENTS;
  const full = Math.floor(exact);
  const partial = exact - full;
  const lit = frac > 0 && exact < 1 ? 1 : full;   // any traffic shows ≥1 segment
  return (
    <div style={{ display: "flex", gap: 3, height: 6 }}>
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const on = i < lit;
        const part = !on && i === full && partial > 0.15;
        return (
          <div key={i} style={{
            flex: 1, borderRadius: 2,
            background: on ? color : part ? withAlpha(color, 0.25 + partial * 0.6) : withAlpha(T.textSecondary, 0.08),
            boxShadow: on ? `0 0 6px ${withAlpha(color, 0.45)}` : "none",
            transition: "background 0.3s",
          }} />
        );
      })}
    </div>
  );
}

function AppAvatar({ app, color }) {
  const showIcon = app.icon && app.icon !== GENERIC_ICON;
  return (
    <div style={{
      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: withAlpha(color, 0.14), border: `1px solid ${withAlpha(color, 0.35)}`,
      fontFamily: T.fontLabel, fontWeight: 700, fontSize: showIcon ? 16 : 15, color,
    }}>
      {showIcon ? app.icon : (app.name || "?").replace(/^[^a-z0-9]+/i, "").charAt(0).toUpperCase() || "?"}
    </div>
  );
}

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
            {/* Bar row — clickable: avatar · name · segmented bars · values */}
            <div
              onClick={() => setExpandedApp(isExpanded ? null : app.name)}
              onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = withAlpha(T.textSecondary, 0.05); }}
              onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
              style={{ cursor: "pointer", padding: "8px 10px", borderRadius: isExpanded ? "8px 8px 0 0" : 8, transition: "background 0.15s",
                display: "grid", gridTemplateColumns: "14px 30px minmax(120px, 200px) 1fr auto", alignItems: "center", columnGap: 12,
                background: isExpanded ? withAlpha(T.textSecondary, 0.06) : "transparent" }}
            >
              <span style={{ color: T.textSecondary, fontSize: 11 }}>{isExpanded ? "▼" : "▶"}</span>
              <AppAvatar app={app} color={color} />
              <span style={{ color: T.text, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={app.name}>
                {app.name}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }} title={`↓ ${formatRate(app.recv)}  ↑ ${formatRate(app.sent)}`}>
                <SegmentedBar frac={recvPct / 100} color={T.download} />
                <SegmentedBar frac={sentPct / 100} color={T.upload} />
              </div>
              <div style={{ fontFamily: T.fontMono, fontSize: 12, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", minWidth: 250 }}>
                <span style={{ color: T.download }}>↓ {formatRate(app.recv)}</span>
                <span style={{ color: T.textMuted }}> / </span>
                <span style={{ color: T.upload }}>↑ {formatRate(app.sent)}</span>
                <span style={{ color: T.textSecondary }}> · {appConns.length} connection{appConns.length !== 1 ? "s" : ""}</span>
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
      <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 11, color: T.textSecondary }}>
        <span><span style={{ display: "inline-block", width: 10, height: 6, background: T.download, borderRadius: 2, marginRight: 5 }} />Download (top)</span>
        <span><span style={{ display: "inline-block", width: 10, height: 6, background: T.upload, borderRadius: 2, marginRight: 5 }} />Upload (bottom)</span>
        <span style={{ marginLeft: "auto" }}>Click any row to expand</span>
      </div>
    </div>
  );
}
