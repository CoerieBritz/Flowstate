import { useState } from "react";
import { INPUT_STYLE } from "../lib/styles";
import { T, withAlpha } from "../lib/theme";

function generatePlaybookYaml(f) {
  const slug = f.name || (f.display_name || "playbook").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const lines = [
    `name: ${slug}`,
    `display_name: ${f.display_name || slug}`,
    `description: >`,
    `  ${(f.description || "").trim() || "No description."}`,
    `enabled: ${f.enabled !== false ? "true" : "false"}`,
    ``,
    `trigger:`,
    `  type: ${f.trigger_type || "threat_flagged"}`,
  ];
  if (f.trigger_type === "threat_flagged" && f.min_severity)
    lines.push(`  min_severity: ${f.min_severity}`);
  if (f.trigger_type === "port_scan")
    lines.push(`  min_port_count: ${f.min_port_count || 5}`);
  lines.push(
    ``, `enrichment:`,
    `  virustotal: ${f.enrich_vt ? "true" : "false"}`,
    `  abuseipdb: ${f.enrich_ab ? "true" : "false"}`,
    ``, `incident:`,
    `  severity: ${(f.severity || "MEDIUM").toUpperCase()}`,
    `  recommended_actions:`,
  );
  (f.recommended_actions || []).filter((a) => a.trim()).forEach((a) => {
    lines.push(`    - ${a.trim()}`);
  });
  if (!(f.recommended_actions || []).filter((a) => a.trim()).length)
    lines.push(`    - Review and investigate the flagged event`);
  return lines.join("\n") + "\n";
}

export function PlaybookEditor({ playbook, onSave, onCancel, wsReady }) {
  const isNew = !playbook;
  const [form, setForm] = useState(() => isNew ? {
    name: "", display_name: "", description: "", trigger_type: "threat_flagged",
    min_severity: "medium", min_port_count: 5,
    severity: "HIGH", enrich_vt: true, enrich_ab: false,
    enabled: true, recommended_actions: [""],
  } : {
    name:               playbook.name,
    display_name:       playbook.display_name,
    description:        playbook.description || "",
    trigger_type:       playbook.trigger_type || "threat_flagged",
    min_severity:       playbook.min_severity || "medium",
    min_port_count:     playbook.min_port_count || 5,
    severity:           playbook.severity || "HIGH",
    enrich_vt:          playbook.enrich_vt || false,
    enrich_ab:          playbook.enrich_ab || false,
    enabled:            playbook.enabled !== false,
    recommended_actions: playbook.recommended_actions?.length ? [...playbook.recommended_actions] : [""],
  });

  const slug = form.name || (form.display_name || "playbook").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const filename = slug + ".yml";

  const setF = (key, val) => setForm((p) => ({ ...p, [key]: val }));
  const setAction = (i, val) => setF("recommended_actions", form.recommended_actions.map((a, j) => j === i ? val : a));
  const addAction = () => setF("recommended_actions", [...form.recommended_actions, ""]);
  const removeAction = (i) => setF("recommended_actions", form.recommended_actions.filter((_, j) => j !== i));

  const FIELD = { ...INPUT_STYLE, marginBottom: 0 };
  const SELECT = { ...FIELD, cursor: "pointer" };

  return (
    <div style={{
      marginBottom: 20, padding: "20px 24px", borderRadius: 12,
      background: withAlpha(T.accent, 0.03), border: `1px solid ${withAlpha(T.accent, 0.15)}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ fontFamily: T.fontLabel, fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: 1.5 }}>
          {isNew ? "CREATE NEW PLAYBOOK" : `EDIT: ${playbook.display_name}`}
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: T.textSecondary, fontSize: 16, cursor: "pointer", padding: "0 4px" }}>✕</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, marginBottom: 5, letterSpacing: 1 }}>DISPLAY NAME</div>
          <input value={form.display_name} onChange={(e) => setF("display_name", e.target.value)} placeholder="e.g. Suspicious Outbound Traffic" style={FIELD} />
          <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>Filename: {filename}</div>
        </div>
        <div>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, marginBottom: 5, letterSpacing: 1 }}>TRIGGER TYPE</div>
          <select value={form.trigger_type} onChange={(e) => setF("trigger_type", e.target.value)} style={SELECT}>
            <option value="threat_flagged">Threat Flagged</option>
            <option value="bandwidth_spike">Bandwidth Spike</option>
            <option value="new_process">New Process</option>
            <option value="port_scan">Port Scan</option>
          </select>
        </div>
      </div>

      {form.trigger_type === "threat_flagged" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, marginBottom: 5, letterSpacing: 1 }}>MIN THREAT SEVERITY</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["low", "medium", "high"].map((s) => (
              <button key={s} onClick={() => setF("min_severity", s)} style={{
                padding: "5px 14px", borderRadius: 5, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                background: form.min_severity === s ? withAlpha(T.accent, 0.2) : "rgba(255,255,255,0.04)",
                color: form.min_severity === s ? T.accent : T.textSecondary,
              }}>{s.toUpperCase()}</button>
            ))}
          </div>
        </div>
      )}

      {form.trigger_type === "port_scan" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, marginBottom: 5, letterSpacing: 1 }}>MIN PORTS TO TRIGGER</div>
          <input type="number" min={2} max={100} value={form.min_port_count}
            onChange={(e) => setF("min_port_count", Number(e.target.value))} style={{ ...FIELD, width: 120 }} />
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, marginBottom: 5, letterSpacing: 1 }}>DESCRIPTION</div>
        <textarea value={form.description} onChange={(e) => setF("description", e.target.value)}
          placeholder="What does this playbook detect and why…"
          rows={2} style={{ ...FIELD, resize: "vertical", lineHeight: 1.6 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, marginBottom: 5, letterSpacing: 1 }}>INCIDENT SEVERITY</div>
          <select value={form.severity} onChange={(e) => setF("severity", e.target.value)} style={SELECT}>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, marginBottom: 8, letterSpacing: 1 }}>ENRICHMENT</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              { key: "enrich_vt", label: "VirusTotal" },
              { key: "enrich_ab", label: "AbuseIPDB" },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, color: form[key] ? T.text : T.textSecondary }}>
                <input type="checkbox" checked={form[key]} onChange={(e) => setF(key, e.target.checked)}
                  style={{ accentColor: T.accent }} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, marginBottom: 8, letterSpacing: 1 }}>STATUS</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, color: form.enabled ? T.success : T.textSecondary }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => setF("enabled", e.target.checked)}
              style={{ accentColor: T.success }} />
            Enabled
          </label>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, marginBottom: 8, letterSpacing: 1 }}>RECOMMENDED ACTIONS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {form.recommended_actions.map((action, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ color: "#334155", fontSize: 12, marginTop: 7, flexShrink: 0 }}>—</span>
              <textarea value={action} onChange={(e) => setAction(i, e.target.value)}
                placeholder={`Action ${i + 1}…`} rows={1}
                style={{ ...FIELD, flex: 1, resize: "vertical", lineHeight: 1.5 }} />
              <button onClick={() => removeAction(i)} disabled={form.recommended_actions.length <= 1}
                style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 14, padding: "6px 4px", flexShrink: 0 }}>✕</button>
            </div>
          ))}
          <button onClick={addAction} style={{
            alignSelf: "flex-start", padding: "4px 12px", borderRadius: 5,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: T.textSecondary, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
          }}>+ Add Action</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          disabled={!wsReady || !form.display_name.trim()}
          onClick={() => onSave(generatePlaybookYaml({ ...form, name: slug }), filename)}
          style={{
            padding: "8px 20px", borderRadius: 7, border: "none",
            background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff",
            fontSize: 11, fontWeight: 700, fontFamily: "inherit",
            cursor: wsReady && form.display_name.trim() ? "pointer" : "not-allowed",
            opacity: wsReady && form.display_name.trim() ? 1 : 0.5,
          }}
        >
          💾 {isNew ? "Create Playbook" : "Save Changes"}
        </button>
        <button onClick={onCancel} style={{
          padding: "8px 16px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)",
          background: "transparent", color: T.textSecondary, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
        }}>Cancel</button>
        <span style={{ fontSize: 11, color: "#334155", marginLeft: 4 }}>
          Will write to <code style={{ color: T.accent }}>playbooks/{filename}</code>
        </span>
      </div>
    </div>
  );
}
