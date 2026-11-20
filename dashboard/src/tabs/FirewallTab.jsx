import { ActionBtn } from "../components/ActionBtn";
import { formatRate } from "../lib/format";
import { T, withAlpha } from "../lib/theme";
import { Sparkline } from "../components/charts/Sparkline";

export function FirewallTab({ apps, appHistory, blockedApps, blocklist, blockedIps, newBlocklistIp, setNewBlocklistIp, searchFilter, setSearchFilter, askToConnect, setAskToConnect, toggleBlock, triggerAction }) {
  const filteredApps = apps.filter((a) => a.name.toLowerCase().includes(searchFilter.toLowerCase()));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: "linear-gradient(135deg,rgba(251,146,60,0.06),transparent)", border: "1px solid rgba(251,146,60,0.1)" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Ask to Connect Mode</div>
          <div style={{ fontSize: 11, color: T.textSecondary }}>Prompt before new apps access the network</div>
        </div>
        <button onClick={() => setAskToConnect(!askToConnect)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: askToConnect ? "#22c55e" : "#334155", color: askToConnect ? T.panel : T.textSecondary, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: askToConnect ? "0 0 12px rgba(34,197,94,0.3)" : "none" }}>
          {askToConnect ? "ENABLED" : "DISABLED"}
        </button>
      </div>
      <div style={{ marginBottom: 12 }}>
        <input type="text" placeholder="Search apps..." value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)}
          style={{ width: "100%", padding: "8px 14px", borderRadius: 8, background: T.inset, border: `1px solid ${withAlpha(T.accent, 0.1)}`, color: T.text, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
      </div>
      {filteredApps.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: 12, padding: "20px 0" }}>{apps.length === 0 ? "Waiting for data…" : "No apps match."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filteredApps.map((app) => (
            <div key={app.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize: 22 }}>{app.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{app.name}</div>
                <div style={{ fontSize: 11, color: T.textSecondary }}>PID: {app.pid} · {app.connections} conns · ↓ {formatRate(app.recv)} · ↑ {formatRate(app.sent)}</div>
              </div>
              <Sparkline data={(appHistory[app.name] || []).slice(-60)} color={blockedApps.has(app.name) ? T.danger : T.accent} w={60} h={40} />
              {app.pid > 0 && (
                <ActionBtn icon="☠️" label="Kill" color={T.orange}
                  onClick={() => triggerAction(
                    "kill_process", { pid: app.pid, name: app.name },
                    `Kill Process: ${app.name}`,
                    `Terminate ${app.name} (PID ${app.pid}) immediately using taskkill /F.`,
                    `taskkill /PID ${app.pid} /F`,
                    true,
                  )}
                />
              )}
              <button onClick={() => toggleBlock(app.name)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: blockedApps.has(app.name) ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", color: blockedApps.has(app.name) ? T.danger : T.success, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minWidth: 80 }}>
                {blockedApps.has(app.name) ? "🚫 BLOCKED" : "✓ ALLOW"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Blocklist Manager ─────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1.5, marginBottom: 12 }}>BLOCKLIST MANAGER</div>

        {/* Session netsh blocks */}
        {blockedIps.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1, marginBottom: 8 }}>
              ACTIVE IP BLOCKS (this session — Windows Firewall rules)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {blockedIps.map((ip) => (
                <div key={ip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderRadius: 8, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <span style={{ color: T.danger, fontSize: 12 }}>🚫</span>
                  <span style={{ flex: 1, fontSize: 11, fontVariantNumeric: "tabular-nums", color: "#fca5a5" }}>{ip}</span>
                  <ActionBtn icon="✅" label="Unblock" color={T.success}
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
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1, marginBottom: 8 }}>
            PERSISTENT BLOCKLIST (data/blocklist.txt — {blocklist.length} entries)
          </div>
          {blocklist.length === 0 ? (
            <div style={{ color: "#334155", fontSize: 11, padding: "10px 0" }}>No IPs in blocklist.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
              {blocklist.map((ip) => (
                <div key={ip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 7, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <span style={{ flex: 1, fontSize: 11, color: T.textSecondary, fontVariantNumeric: "tabular-nums" }}>{ip}</span>
                  <ActionBtn icon="🚫" label="Block Now" color={T.danger}
                    onClick={() => triggerAction(
                      "block_ip", { ip },
                      `Block IP ${ip}`,
                      `Add Windows Firewall rules to block all traffic to/from ${ip}.`,
                      `netsh advfirewall firewall add rule name="FlowState Block OUT ${ip}" dir=out action=block remoteip=${ip}`,
                      false,
                    )}
                  />
                  <ActionBtn icon="🗑️" label="Remove" color={T.textSecondary}
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
              style={{ flex: 1, padding: "7px 12px", borderRadius: 7, background: T.inset, border: `1px solid ${withAlpha(T.accent, 0.12)}`, color: T.text, fontSize: 11, fontFamily: "inherit", outline: "none" }}
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
  );
}
