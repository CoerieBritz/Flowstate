export const PALETTE = [
  "#38bdf8","#fb923c","#a78bfa","#4ade80","#f472b6",
  "#34d399","#fbbf24","#60a5fa","#e879f9","#2dd4bf",
  "#0ea5e9","#f97316","#8b5cf6","#22c55e","#ec4899",
  "#10b981","#f59e0b","#3b82f6","#d946ef","#14b8a6",
];

export const INC_SEV = {
  CRITICAL: { color: "#ef4444", bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.35)",  pulse: true  },
  HIGH:     { color: "#fb923c", bg: "rgba(251,146,60,0.12)", border: "rgba(251,146,60,0.35)", pulse: false },
  MEDIUM:   { color: "#fbbf24", bg: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.30)", pulse: false },
  LOW:      { color: "#94a3b8", bg: "rgba(148,163,184,0.08)",border: "rgba(148,163,184,0.2)", pulse: false },
};

// Risk score → color/label
export function riskColor(score) {
  if (score >= 70) return { color: "#ef4444", label: "CRITICAL", bg: "rgba(239,68,68,0.12)" };
  if (score >= 40) return { color: "#fb923c", label: "HIGH",     bg: "rgba(251,146,60,0.10)" };
  if (score >= 15) return { color: "#fbbf24", label: "MEDIUM",   bg: "rgba(251,191,36,0.10)" };
  return           { color: "#4ade80",  label: "LOW",      bg: "rgba(34,197,94,0.08)"  };
}

export const THREAT_COLORS = {
  high:   { bg: "rgba(239,68,68,0.15)",   text: "#ef4444", border: "rgba(239,68,68,0.35)"   },
  medium: { bg: "rgba(251,146,60,0.15)",  text: "#fb923c", border: "rgba(251,146,60,0.35)"  },
  low:    { bg: "rgba(251,191,36,0.12)",  text: "#fbbf24", border: "rgba(251,191,36,0.30)"  },
};
