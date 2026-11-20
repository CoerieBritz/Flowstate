import { groupOfTab, NAV_GROUPS } from "../lib/nav";
import { T, withAlpha } from "../lib/theme";

const glowText = `0 0 10px ${withAlpha(T.accent, 0.6)}`;
const glowLine = `0 2px 10px ${withAlpha(T.accent, 0.55)}`;

function Badge({ value, color }) {
  if (!value) return null;
  return (
    <span style={{
      marginLeft: 7, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontFamily: T.fontMono, fontSize: 11, fontWeight: 700, lineHeight: 1,
      background: color, color: "#0a1120", boxShadow: `0 0 8px ${withAlpha(color, 0.6)}`,
    }}>{value}</span>
  );
}

function NavButton({ active, onClick, children, size = "group", title }) {
  const isGroup = size === "group";
  return (
    <button onClick={onClick} title={title} style={{
      position: "relative", display: "inline-flex", alignItems: "center",
      padding: isGroup ? "11px 20px" : "8px 16px",
      background: active ? withAlpha(T.accent, isGroup ? 0.08 : 0.06) : "transparent",
      border: "none", borderRadius: isGroup ? "8px 8px 0 0" : 6,
      color: active ? T.accent : T.textSecondary,
      textShadow: active ? glowText : "none",
      fontFamily: T.fontLabel, fontSize: isGroup ? 15 : 14, fontWeight: isGroup ? 700 : 600,
      letterSpacing: isGroup ? 2 : 1, cursor: "pointer", transition: "color 0.15s, background 0.15s",
    }}>
      {children}
      {/* cyan underline + glow on the active item */}
      <span style={{
        position: "absolute", left: isGroup ? 12 : 10, right: isGroup ? 12 : 10, bottom: 0, height: 2,
        borderRadius: 2, background: active ? T.accent : "transparent",
        boxShadow: active ? glowLine : "none",
      }} />
    </button>
  );
}

/**
 * props:
 *   tab           active tab id
 *   onSelectTab   (tabId) => void
 *   onSelectGroup (groupId) => void   — opens that group's last-used tab
 *   counts        { alerts, incidents, playbooks, audit, openIncidents }
 */
export function TabNav({ tab, onSelectTab, onSelectGroup, counts }) {
  const activeGroup = groupOfTab(tab);
  const group = NAV_GROUPS.find((g) => g.id === activeGroup);
  const subCount = { alerts: counts.alerts, incidents: counts.incidents, playbooks: counts.playbooks, audit: counts.audit };

  return (
    <div style={{ background: T.chrome, borderBottom: `1px solid ${T.panelBorder}` }}>
      {/* Row 1 — groups + settings */}
      <div style={{ display: "flex", alignItems: "flex-end", padding: "6px 20px 0", borderBottom: `1px solid ${T.panelBorder}` }}>
        {NAV_GROUPS.map((g) => (
          <NavButton key={g.id} active={activeGroup === g.id} onClick={() => onSelectGroup(g.id)}>
            {g.label}
            {g.id === "soar" && <Badge value={counts.openIncidents} color={T.incidents} />}
          </NavButton>
        ))}
        <div style={{ flex: 1 }} />
        <NavButton active={tab === "settings"} onClick={() => onSelectTab("settings")} title="Settings">
          ⚙️ <span style={{ marginLeft: 8 }}>SETTINGS</span>
        </NavButton>
      </div>

      {/* Row 2 — sub-tabs of the active group */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 20px", minHeight: 44 }}>
        {group ? group.tabs.map((t) => (
          <NavButton key={t.id} size="sub" active={tab === t.id} onClick={() => onSelectTab(t.id)}>
            {t.label}
            <Badge value={subCount[t.id]} color={t.id === "incidents" ? T.incidents : T.textSecondary} />
          </NavButton>
        )) : (
          <span style={{ fontFamily: T.fontLabel, fontSize: 14, fontWeight: 600, letterSpacing: 1, color: T.textSecondary, padding: "0 16px" }}>
            Application settings
          </span>
        )}
      </div>
    </div>
  );
}
