import { useState, useEffect } from "react";
import { INPUT_STYLE } from "../lib/styles";

// ════════════════════════════════════════════════════════════════════
// SETTINGS TAB — begins below
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ════════════════════════════════════════════════════════════════════
const FLOWSTATE_VERSION = "1.0.0";

function SettingsSection({ title, children }) {
  return (
    <div style={{
      marginBottom: 24, padding: "20px 24px", borderRadius: 12,
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(56,189,248,0.08)",
    }}>
      <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 2, marginBottom: 16, fontWeight: 700 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SettingsField({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{label}</label>
        {hint && <span style={{ fontSize: 9, color: "#475569" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function KeyStatusDot({ masked }) {
  const isSet = masked && masked.length > 0;
  return (
    <span title={isSet ? "Key is set" : "No key configured"} style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: isSet ? "#4ade80" : "#334155",
      boxShadow: isSet ? "0 0 6px #4ade80" : "none",
      marginLeft: 6, verticalAlign: "middle", flexShrink: 0,
    }} />
  );
}

export function SettingsTab({ settings, soarStats, onSave, onRefreshFeeds, wsReady }) {
  // Draft mirrors settings; user edits draft, saves to backend
  const [draft, setDraft]     = useState(() => settings);
  const [vtKey, setVtKey]     = useState("");  // new key input (blank = unchanged)
  const [abKey, setAbKey]     = useState("");  // new key input (blank = unchanged)
  const [saving, setSaving]   = useState(false);

  // Sync draft when settings change from backend
  useEffect(() => { setDraft(settings); }, [settings]);

  const set = (section, key, value) =>
    setDraft((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));

  const handleSave = (section) => {
    const payload = { ...draft };
    // Inject new key values only if the user actually typed something
    if (section === "threat_intel" || section === "all") {
      if (vtKey.trim()) payload.threat_intel = { ...payload.threat_intel, virustotal_api_key: vtKey.trim() };
      if (abKey.trim()) payload.threat_intel = { ...payload.threat_intel, abuseipdb_api_key:  abKey.trim() };
    }
    onSave(section === "all" ? payload : { [section]: payload[section] });
    setSaving(true);
    setTimeout(() => setSaving(false), 1500);
    if (section === "threat_intel" || section === "all") {
      setVtKey(""); setAbKey("");
    }
  };

  const ti        = draft.threat_intel  || {};
  const alerts    = draft.alerts        || {};
  const display   = draft.display       || {};
  const feeds     = soarStats?.feeds    || [];

  return (
    <div style={{ maxWidth: 760 }}>

      {/* ── API Keys ─────────────────────────────────────────────── */}
      <SettingsSection title="API KEYS — THREAT INTELLIGENCE">
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 16, lineHeight: 1.7 }}>
          Add your own API keys to enable live threat lookups. Free tiers are
          sufficient for personal use. Keys are stored locally in{" "}
          <code style={{ color: "#38bdf8", fontSize: 10 }}>data/settings.json</code>{" "}
          and never transmitted off your machine.
        </div>

        <SettingsField
          label={<>VirusTotal API Key <KeyStatusDot masked={ti.virustotal_api_key} /></>}
          hint={ti.virustotal_api_key ? `Currently set: ${ti.virustotal_api_key}` : "Not configured"}
        >
          <input
            type="password" placeholder={ti.virustotal_api_key ? "Enter new key to replace…" : "Paste your API key…"}
            value={vtKey} onChange={(e) => setVtKey(e.target.value)}
            style={INPUT_STYLE}
            autoComplete="new-password"
          />
          <div style={{ marginTop: 5, fontSize: 9, color: "#475569" }}>
            Free tier: 4 req/min · 500 req/day ·{" "}
            <span style={{ color: "#38bdf8", cursor: "pointer" }}
              onClick={() => window.open("https://www.virustotal.com/gui/join-us", "_blank")}>
              Get a free key at virustotal.com ↗
            </span>
          </div>
        </SettingsField>

        <SettingsField
          label={<>AbuseIPDB API Key <KeyStatusDot masked={ti.abuseipdb_api_key} /></>}
          hint={ti.abuseipdb_api_key ? `Currently set: ${ti.abuseipdb_api_key}` : "Not configured"}
        >
          <input
            type="password" placeholder={ti.abuseipdb_api_key ? "Enter new key to replace…" : "Paste your API key…"}
            value={abKey} onChange={(e) => setAbKey(e.target.value)}
            style={INPUT_STYLE}
            autoComplete="new-password"
          />
          <div style={{ marginTop: 5, fontSize: 9, color: "#475569" }}>
            Free tier: 1 000 checks/day ·{" "}
            <span style={{ color: "#38bdf8", cursor: "pointer" }}
              onClick={() => window.open("https://www.abuseipdb.com/register", "_blank")}>
              Get a free key at abuseipdb.com ↗
            </span>
          </div>
        </SettingsField>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <button
            disabled={!wsReady || saving}
            onClick={() => handleSave("threat_intel")}
            style={{
              padding: "8px 20px", borderRadius: 7, border: "none", cursor: wsReady ? "pointer" : "not-allowed",
              background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff",
              fontSize: 11, fontWeight: 700, fontFamily: "inherit",
              opacity: wsReady ? 1 : 0.5,
            }}
          >
            {saving ? "Saving…" : "Save API Keys"}
          </button>
          <span style={{ fontSize: 10, color: "#475569" }}>
            {wsReady ? "Keys are stored locally only." : "Backend offline"}
          </span>
        </div>
      </SettingsSection>

      {/* ── Alert Thresholds ─────────────────────────────────────── */}
      <SettingsSection title="ALERT THRESHOLDS">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SettingsField label="Bandwidth alert threshold (MB/hr)" hint="per app">
            <input
              type="number" min={1} max={10000}
              value={alerts.bandwidth_threshold_mb ?? 100}
              onChange={(e) => set("alerts", "bandwidth_threshold_mb", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
          <SettingsField label="Poll interval (seconds)" hint="1–10">
            <input
              type="number" min={1} max={10} step={0.5}
              value={alerts.poll_interval_seconds ?? 1}
              onChange={(e) => set("alerts", "poll_interval_seconds", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
        </div>
        <SaveRow onSave={() => handleSave("alerts")} wsReady={wsReady} saving={saving} />
      </SettingsSection>

      {/* ── Display Settings ─────────────────────────────────────── */}
      <SettingsSection title="DISPLAY SETTINGS">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SettingsField label="Max connections shown" hint="per poll">
            <input
              type="number" min={10} max={1000}
              value={display.max_connections_shown ?? 100}
              onChange={(e) => set("display", "max_connections_shown", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
          <SettingsField label="Max apps shown" hint="per poll">
            <input
              type="number" min={5} max={200}
              value={display.max_apps_shown ?? 30}
              onChange={(e) => set("display", "max_apps_shown", Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </SettingsField>
        </div>
        <SaveRow onSave={() => handleSave("display")} wsReady={wsReady} saving={saving} />
      </SettingsSection>

      {/* ── Feed Management ──────────────────────────────────────── */}
      <SettingsSection title="THREAT FEED MANAGEMENT">
        {soarStats ? (
          <>
            <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
              {[
                { label: "TOTAL INDICATORS", value: soarStats.total_indicators?.toLocaleString() ?? "—", color: "#38bdf8" },
                { label: "EXACT IPs",         value: soarStats.exact_ips?.toLocaleString()         ?? "—", color: "#a78bfa" },
                { label: "CIDR RANGES",       value: soarStats.cidr_ranges?.toLocaleString()       ?? "—", color: "#fb923c" },
                { label: "FEEDS LOADED",      value: feeds.length,                                          color: "#4ade80" },
              ].map((s) => (
                <div key={s.label} style={{
                  flex: 1, minWidth: 110, padding: "10px 14px", borderRadius: 8,
                  background: `${s.color}0d`, border: `1px solid ${s.color}22`,
                }}>
                  <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.2, marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {feeds.length > 0 && (
              <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(56,189,248,0.08)", marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ background: "rgba(56,189,248,0.04)" }}>
                      {["Feed", "Indicators", "Type", "Last Updated"].map((h) => (
                        <th key={h} style={{
                          padding: "8px 12px", textAlign: "left", fontSize: 9,
                          letterSpacing: 1.2, color: "#64748b", fontWeight: 600,
                          borderBottom: "1px solid rgba(56,189,248,0.06)",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {feeds.map((f, i) => (
                      <tr key={i} style={{
                        background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                        borderBottom: "1px solid rgba(255,255,255,0.03)",
                      }}>
                        <td style={{ padding: "8px 12px", fontWeight: 600, color: "#e2e8f0" }}>
                          <span style={{ fontSize: 12, marginRight: 6 }}>
                            {f.count > 0 ? "✅" : "⚠️"}
                          </span>
                          {f.name}
                        </td>
                        <td style={{ padding: "8px 12px", color: "#38bdf8" }}>
                          {(f.count ?? 0).toLocaleString()}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{
                            padding: "2px 7px", borderRadius: 4, fontSize: 9,
                            background: "rgba(139,92,246,0.12)", color: "#a78bfa",
                          }}>
                            {f.type || "blocklist"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px", color: "#64748b", fontSize: 9 }}>
                          {f.updated_at || soarStats.loaded_at || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#475569", fontSize: 11, padding: "10px 0" }}>
            Threat intel engine not loaded — soar/ module may be missing.
          </div>
        )}

        <button
          disabled={!wsReady}
          onClick={onRefreshFeeds}
          style={{
            padding: "8px 20px", borderRadius: 7, border: "none",
            cursor: wsReady ? "pointer" : "not-allowed",
            background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)",
            color: "#38bdf8", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
            opacity: wsReady ? 1 : 0.5,
          }}
        >
          🔄 Update Feeds Now
        </button>
      </SettingsSection>

      {/* ── About ────────────────────────────────────────────────── */}
      <SettingsSection title="ABOUT FLOWSTATE">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "linear-gradient(135deg,#0ea5e9,#06b6d4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: "#0a0e17", fontWeight: 900,
            }}>⚡</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#38bdf8", letterSpacing: 1 }}>FLOWSTATE</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.5 }}>
                v{FLOWSTATE_VERSION} · LOCAL NETWORK MONITOR
              </div>
            </div>
          </div>

          <div style={{
            padding: "12px 16px", borderRadius: 8,
            background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.12)",
            fontSize: 11, color: "#94a3b8", lineHeight: 1.8,
          }}>
            Made for the community — add your own API keys to enable live threat lookups.
            All monitoring is local. No data leaves your machine. Alert-only SOAR:
            nothing is blocked without your explicit confirmation.
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "⭐ GitHub", color: "#fbbf24" },
              { label: "📄 MIT License", color: "#4ade80" },
              { label: "🛡️ Alert-Only Mode", color: "#38bdf8" },
            ].map((b) => (
              <span key={b.label} style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                background: `${b.color}12`, border: `1px solid ${b.color}30`, color: b.color,
              }}>
                {b.label}
              </span>
            ))}
          </div>

          <div style={{ fontSize: 9, color: "#334155", marginTop: 4 }}>
            Stack: Python 3.10+ · psutil · websockets · React 18 · Vite · d3
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

// Small inline save row used inside threshold/display sections
function SaveRow({ onSave, wsReady, saving }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
      <button
        disabled={!wsReady || saving}
        onClick={onSave}
        style={{
          padding: "7px 18px", borderRadius: 7, border: "none",
          cursor: wsReady ? "pointer" : "not-allowed",
          background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff",
          fontSize: 11, fontWeight: 700, fontFamily: "inherit",
          opacity: wsReady ? 1 : 0.5,
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
