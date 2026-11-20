import { riskColor } from "../lib/colors";

// Full threat intel detail panel — shown as a floating modal
export function ThreatIntelPanel({ ip, result, onClose }) {
  if (!ip) return null;
  const vt  = result?.virustotal;
  const ab  = result?.abuseipdb;
  const err = result?.error;
  const score = result?.risk_score ?? 0;
  const rc  = riskColor(score);
  const isCached = result?.cached;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9100,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: "95vw", borderRadius: 14,
          background: "#0c1220",
          border: `1px solid ${rc.color}44`,
          boxShadow: `0 20px 60px rgba(0,0,0,0.8), 0 0 30px ${rc.color}18`,
          padding: "22px 26px",
          fontFamily: "inherit",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 22 }}>🔍</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{ip}</div>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.2, marginTop: 2 }}>THREAT INTELLIGENCE LOOKUP</div>
          </div>
          {!err && (
            <div style={{
              padding: "4px 12px", borderRadius: 6,
              background: rc.bg, border: `1px solid ${rc.color}44`,
              fontSize: 11, fontWeight: 800, color: rc.color, letterSpacing: 0.5,
            }}>
              {rc.label} RISK
            </div>
          )}
          {isCached && (
            <div style={{ fontSize: 8, color: "#475569", padding: "2px 6px", borderRadius: 3, background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.1)" }}>CACHED</div>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, padding: 4 }}>✕</button>
        </div>

        {err ? (
          <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#fca5a5" }}>
            ⚠ {err}
          </div>
        ) : (
          <>
            {/* Risk score bar */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748b", marginBottom: 4 }}>
                <span>COMBINED RISK SCORE</span>
                <span style={{ color: rc.color, fontWeight: 700 }}>{score}/100</span>
              </div>
              <div style={{ height: 6, background: "#0f1422", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${score}%`, background: rc.color, borderRadius: 3, transition: "width 0.4s" }} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

              {/* VirusTotal */}
              <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(56,189,248,0.08)" }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11 }}>🦠</span> VIRUSTOTAL
                </div>
                {vt ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <TiRow label="Detection" value={vt.detection_ratio}
                      valueColor={vt.malicious > 0 ? "#ef4444" : "#4ade80"} bold />
                    {vt.country && <TiRow label="Country" value={vt.country} />}
                    {vt.asn_owner && <TiRow label="ASN" value={`AS${vt.asn} ${vt.asn_owner}`} />}
                    {vt.last_analysis_date && <TiRow label="Last Scan" value={vt.last_analysis_date} />}
                    <TiRow label="Reputation" value={vt.reputation} valueColor={vt.reputation < 0 ? "#ef4444" : "#4ade80"} />
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: "#334155" }}>No key configured or lookup pending</div>
                )}
              </div>

              {/* AbuseIPDB */}
              <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(139,92,246,0.08)" }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11 }}>🛡️</span> ABUSEIPDB
                </div>
                {ab ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <TiRow label="Confidence" value={`${ab.confidence_score}%`}
                      valueColor={ab.confidence_score >= 50 ? "#ef4444" : ab.confidence_score >= 20 ? "#fb923c" : "#4ade80"} bold />
                    <TiRow label="Reports" value={ab.total_reports} />
                    {ab.last_reported && <TiRow label="Last Report" value={ab.last_reported} />}
                    {ab.country_code && <TiRow label="Country" value={ab.country_code} />}
                    {ab.isp && <TiRow label="ISP" value={ab.isp} />}
                    {ab.is_whitelisted && <TiRow label="Whitelisted" value="Yes" valueColor="#4ade80" />}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: "#334155" }}>No key configured or lookup pending</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Footer note */}
        <div style={{ marginTop: 14, fontSize: 9, color: "#334155", textAlign: "right" }}>
          {result?.cached_at
            ? `Cached: ${new Date(result.cached_at * 1000).toLocaleString()}`
            : ""}
        </div>
      </div>
    </div>
  );
}

function TiRow({ label, value, valueColor, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
      <span style={{ color: "#475569" }}>{label}</span>
      <span style={{ color: valueColor || "#94a3b8", fontWeight: bold ? 700 : 400, maxWidth: 160, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value ?? "—"}</span>
    </div>
  );
}
