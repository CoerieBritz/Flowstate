// ════════════════════════════════════════════════════════════════════
// PHASE 4 — THREAT INTEL PANEL + LOOKUP BUTTON
// ════════════════════════════════════════════════════════════════════

// Small button used in the connections table action column
export function LookupBtn({ ip, loading, cached, onClick }) {
  return (
    <button
      onClick={onClick}
      title={cached ? `Threat intel cached for ${ip} — click to view` : `Run VirusTotal + AbuseIPDB lookup for ${ip}`}
      style={{
        padding: "3px 7px", borderRadius: 5, border: "none", cursor: "pointer",
        background: cached ? "rgba(56,189,248,0.15)" : "rgba(167,139,250,0.10)",
        color: cached ? "#38bdf8" : "#a78bfa",
        fontSize: 9, fontWeight: 700, fontFamily: "inherit",
        display: "inline-flex", alignItems: "center", gap: 3,
        opacity: loading ? 0.6 : 1,
        minWidth: 52,
      }}
    >
      {loading
        ? <span style={{ animation: "spin 0.8s linear infinite", display: "inline-block" }}>⟳</span>
        : "🔍"}
      <span>{loading ? "…" : "Lookup"}</span>
      {cached && !loading && (
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#38bdf8", flexShrink: 0 }} />
      )}
    </button>
  );
}
