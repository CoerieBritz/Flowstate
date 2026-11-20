// Two-level navigation: group row + sub-tab row for the active group.
export const NAV_GROUPS = [
  { id: "monitor", label: "MONITOR", tabs: [
    { id: "graph",       label: "Traffic" },
    { id: "analytics",   label: "Analytics" },
    { id: "firewall",    label: "Firewall" },
  ] },
  { id: "network", label: "NETWORK", tabs: [
    { id: "map",         label: "Map" },
    { id: "connections", label: "Connections" },
  ] },
  { id: "soar", label: "SOAR", tabs: [
    { id: "alerts",      label: "Alerts" },
    { id: "incidents",   label: "Incidents" },
    { id: "playbooks",   label: "Playbooks" },
    { id: "audit",       label: "Audit" },
  ] },
];

export function groupOfTab(tabId) {
  return NAV_GROUPS.find((g) => g.tabs.some((t) => t.id === tabId))?.id ?? null;
}
