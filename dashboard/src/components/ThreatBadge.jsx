import { THREAT_COLORS } from "../lib/colors";

// ════════════════════════════════════════════════════════════════════
// THREAT BADGE — shown on connections flagged by threat intel
// ════════════════════════════════════════════════════════════════════
export function ThreatBadge({ threat, compact = false }) {
  const c = THREAT_COLORS[threat.severity] || THREAT_COLORS.high;
  // Shorten long feed names for the badge label
  const shortLabel = threat.feed
    .replace("Emerging Threats ", "ET ")
    .replace("Botnet ", "")
    .replace(" Malware", "")
    .replace(" Compromised", " Comp.");
  const tooltip = [
    `Feed: ${threat.feed}`,
    `Category: ${threat.category}`,
    `Severity: ${threat.severity.toUpperCase()}`,
    `Description: ${threat.description}`,
    threat.tags?.length ? `Tags: ${threat.tags.join(", ")}` : null,
  ].filter(Boolean).join("\n");

  return (
    <div title={tooltip} style={{
      display: "inline-flex", alignItems: "center", gap: compact ? 3 : 4,
      padding: compact ? "1px 5px" : "3px 7px",
      borderRadius: 4,
      background: c.bg,
      border: `1px solid ${c.border}`,
      fontSize: compact ? 8 : 9,
      color: c.text,
      fontWeight: 700,
      letterSpacing: 0.4,
      whiteSpace: "nowrap",
      cursor: "help",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: compact ? 8 : 9 }}>⚠</span>
      {shortLabel}
    </div>
  );
}
