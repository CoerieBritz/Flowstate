// ── FlowState design tokens ─────────────────────────────────────────────
// Single source for colours, fonts and the shared panel style.
// Fonts are bundled locally via @fontsource (imported in main.jsx) so the
// app works offline.

export const T = {
  // Surfaces
  bg:          "#0a1120",
  panel:       "#0f1a2e",
  panelBorder: "rgba(148,163,184,0.14)",
  inset:       "#0b1424",          // inputs, bar tracks, nested wells
  chrome:      "#0c1526",          // header / nav / footer strips
  radius:      12,

  // Text
  text:          "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted:     "#64748b",

  // Metric accents
  download:    "#22d3ee",          // cyan
  upload:      "#a78bfa",          // violet
  apps:        "#60a5fa",
  connections: "#4ade80",
  threats:     "#94a3b8",
  incidents:   "#f87171",

  // UI accent + status colours
  accent:  "#22d3ee",
  danger:  "#ef4444",
  warning: "#fbbf24",
  orange:  "#fb923c",
  success: "#4ade80",

  // Fonts
  fontLabel: "'Rajdhani', 'Segoe UI', sans-serif",       // labels, headings
  fontMono:  "'JetBrains Mono', 'Consolas', monospace",  // numbers, data
};

// Minimum font size used anywhere in the UI.
const MIN_FONT = 11;

/** "#22d3ee" + 0.2 → "rgba(34,211,238,0.2)" */
export function withAlpha(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Shared panel surface: background, 1px border, 12px radius. */
const PANEL = {
  background: T.panel,
  border: `1px solid ${T.panelBorder}`,
  borderRadius: T.radius,
};

/** Uppercase label style (Rajdhani). */
const LABEL = {
  fontFamily: T.fontLabel,
  fontWeight: 600,
  letterSpacing: 1.2,
  textTransform: "uppercase",
};
