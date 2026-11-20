import { useState, useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { ActionBtn } from "./components/ActionBtn";
import { ConfirmModal } from "./components/ConfirmModal";
import { LookupBtn } from "./components/LookupBtn";
import { StatusBanner } from "./components/StatusBanner";
import { ThreatBadge } from "./components/ThreatBadge";
import { ThreatIntelPanel } from "./components/ThreatIntelPanel";
import { ToastContainer } from "./components/ToastContainer";
import { useContainerWidth } from "./hooks/useContainerWidth";
import { riskColor } from "./lib/colors";
import { formatBytes, formatRate, getAppIcon } from "./lib/format";
import { WS_URL } from "./lib/ws";
import { AnalyticsTab } from "./tabs/AnalyticsTab";
import { AuditLogTab } from "./tabs/AuditTab";
import { IncidentsTab } from "./tabs/IncidentsTab";
import { PlaybooksTab } from "./tabs/PlaybooksTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { TrafficTab } from "./tabs/TrafficTab";
import { NetworkMap } from "./components/charts/NetworkMap";
import { Sparkline } from "./components/charts/Sparkline";

// ════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════
export default function NetMonitor() {
  const [tab, setTab] = useState("graph");
  const [history, setHistory] = useState([]);               // { sent, recv, time }
  const [apps, setApps] = useState([]);
  const [appHistory, setAppHistory] = useState({});         // 300 s per-app recv history
  const [totalSent, setTotalSent] = useState(0);
  const [totalRecv, setTotalRecv] = useState(0);
  const [blockedApps, setBlockedApps] = useState(new Set());
  const [alerts, setAlerts] = useState([]);
  const [connections, setConnections] = useState([]);
  const [threats, setThreats] = useState([]);               // [{ip,feed,category,severity,...}]
  const [soarStats, setSoarStats] = useState(null);         // engine metadata
  const [incidents, setIncidents] = useState([]);           // correlated incident list
  // Phase 3 — Response Engine
  const [pendingAction, setPendingAction] = useState(null); // confirmation modal
  const [auditLog, setAuditLog]           = useState([]);
  const [blocklist, setBlocklist]         = useState([]);
  const [blockedIps, setBlockedIps]       = useState([]);
  const [undoStack, setUndoStack]         = useState([]);
  const [toasts, setToasts]               = useState([]);
  // Phase 4 — Threat Intel API + Playbooks
  const [threatIntelCache, setThreatIntelCache] = useState({}); // ip → result dict
  const [lookupLoading, setLookupLoading]       = useState(new Set()); // IPs in-flight
  const [tiPanelIp, setTiPanelIp]               = useState(null);      // open TI panel
  const [playbooks, setPlaybooks]               = useState([]);         // loaded playbooks
  const [playbookActivity, setPlaybookActivity] = useState([]);         // execution log
  const [dryRunResults, setDryRunResults]       = useState({});         // name → {results, ts}
  const [dryRunLoading, setDryRunLoading]       = useState(null);       // pb name being tested
  const [settings, setSettings]           = useState({
    threat_intel: { virustotal_api_key: "", abuseipdb_api_key: "", auto_lookup_flagged: true, cache_ttl_hours: 24 },
    alerts:       { bandwidth_threshold_mb: 100, poll_interval_seconds: 1 },
    display:      { max_connections_shown: 100, max_apps_shown: 30 },
  });
  const [newBlocklistIp, setNewBlocklistIp] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedApp, setSelectedApp] = useState(null);
  const [askToConnect, setAskToConnect] = useState(false);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [gateway, setGateway] = useState("");
  const [localIp, setLocalIp] = useState("");
  const [lanDevices, setLanDevices] = useState([]);
  const wsRef = useRef(null);
  const graphContainerRef = useRef(null);
  const graphWidth = useContainerWidth(graphContainerRef, 760);

  // ── WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    let ws, reconnectTimer, dead = false;

    function connect() {
      if (dead) return;
      setWsStatus("connecting");
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = async () => {
        // Stay "connecting" until the backend replies with auth_ok.
        // Obtain auth token. Inside Tauri it always comes from the Rust side.
        // VITE_WS_TOKEN is only read in the Vite dev server outside Tauri;
        // the import.meta.env.DEV guard lets the production build drop it.
        let token = "";
        if (isTauri()) {
          try {
            token = await invoke("get_ws_token");
          } catch (err) {
            console.error("get_ws_token failed:", err);
          }
        } else if (import.meta.env.DEV) {
          token = import.meta.env.VITE_WS_TOKEN || "";
        }
        if (ws.readyState !== WebSocket.OPEN) return;   // closed during invoke
        ws.send(JSON.stringify({ action: "auth", token }));
        ws.send(JSON.stringify({ action: "get_settings" }));
      };

      ws.onmessage = ({ data: raw }) => {
        const data = JSON.parse(raw);

        // ── Auth confirmation ─────────────────────────────────────────
        if (data.type === "auth_ok") {
          setWsStatus("connected");
          return;
        }

        // ── Settings responses ────────────────────────────────────────
        if (data.type === "settings_response") {
          setSettings(data.settings || {});
          return;
        }

        // ── Action results (targeted responses, not poll broadcasts) ──
        if (data.type === "action_result") {
          if (data.success) {
            addToast("success", data.details || `${data.action} completed`);
          } else {
            addToast("error", data.error || `${data.action} failed`);
          }
          return;
        }

        // ── Phase 4: Playbook dry run result ─────────────────────────
        if (data.type === "dry_run_result") {
          setDryRunLoading(null);
          const byName = {};
          (data.results || []).forEach((r) => { byName[r.playbook_name] = r; });
          setDryRunResults((prev) => ({
            ...prev,
            ...Object.fromEntries(
              Object.entries(byName).map(([k, v]) => [k, { results: [v], ts: Date.now() }])
            ),
          }));
          if (data.error) addToast("error", data.error);
          return;
        }

        // ── Phase 4: Threat Intel lookup result ───────────────────────
        if (data.type === "threat_intel_result") {
          const ip = data.ip;
          setThreatIntelCache((prev) => ({ ...prev, [ip]: data.result }));
          setLookupLoading((prev) => { const n = new Set(prev); n.delete(ip); return n; });
          if (data.result?.error) {
            addToast("error", `Lookup failed for ${ip}: ${data.result.error}`);
          } else {
            addToast("success", `Threat intel ready for ${ip}`);
          }
          return;
        }

        const liveApps = data.apps.map((app) => ({ ...app, icon: getAppIcon(app.name) }));
        setApps(liveApps);
        setBlockedApps(new Set(liveApps.filter((a) => a.blocked).map((a) => a.name)));
        setTotalSent((p) => p + (data.total_sent || 0));
        setTotalRecv((p) => p + (data.total_recv || 0));

        // Rolling 2-min history for the graph
        setHistory(prev => [...prev.slice(-119), {recv: data.total_recv, sent: data.total_sent, time: Date.now()}]);

        // Per-app history: keep 300 samples (5 min at 1 Hz)
        setAppHistory((prev) => {
          const next = { ...prev };
          liveApps.forEach((app) => {
            const arr = next[app.name] ? [...next[app.name]] : [];
            arr.push(app.recv || 0);
            next[app.name] = arr.length > 300 ? arr.slice(-300) : arr;
          });
          return next;
        });

        setConnections(data.connections || []);
        setAlerts(data.alerts || []);
        setThreats(data.threats || []);
        if (data.soar_stats) setSoarStats(data.soar_stats);
        if (data.incidents !== undefined) setIncidents(data.incidents || []);
        if (data.audit_log  !== undefined) setAuditLog(data.audit_log   || []);
        if (data.blocklist  !== undefined) setBlocklist(data.blocklist   || []);
        if (data.blocked_ips !== undefined) setBlockedIps(data.blocked_ips || []);
        if (data.undo_stack !== undefined) setUndoStack(data.undo_stack  || []);
        if (data.gateway !== undefined) setGateway(data.gateway || "");
        if (data.local_ip !== undefined) setLocalIp(data.local_ip || "");
        if (data.lan_devices !== undefined) setLanDevices(data.lan_devices || []);
        if (data.playbooks          !== undefined) setPlaybooks(data.playbooks || []);
        if (data.playbook_activity  !== undefined) setPlaybookActivity(data.playbook_activity || []);
        // Merge any inline threat_intel results from connections into cache
        if (data.connections) {
          const incoming = {};
          data.connections.forEach((c) => {
            if (c.remote && c.threat_intel) incoming[c.remote] = c.threat_intel;
          });
          if (Object.keys(incoming).length > 0) {
            setThreatIntelCache((prev) => ({ ...prev, ...incoming }));
          }
        }
      };

      ws.onclose = (ev) => {
        if (dead) return;
        if (ev.code === 4401) {
          // Wrong/missing token: retrying cannot succeed, so stop reconnecting.
          dead = true;
          setWsStatus("auth_failed");
          return;
        }
        setWsStatus("disconnected");
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { dead = true; clearTimeout(reconnectTimer); if (ws) ws.close(); };
  }, []);

  const toggleBlock = (name) => {
    const isBlocked = blockedApps.has(name);
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ action: isBlocked ? "unblock" : "block", app: name }));
    setBlockedApps((prev) => { const n = new Set(prev); isBlocked ? n.delete(name) : n.add(name); return n; });
  };

  const acknowledgeIncident = (id) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ action: "acknowledge_incident", id }));
    setIncidents((prev) =>
      prev.map((i) => i.id === id && i.status === "OPEN" ? { ...i, status: "ACKNOWLEDGED" } : i)
    );
  };

  const resolveIncident = (id) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ action: "resolve_incident", id }));
    setIncidents((prev) =>
      prev.map((i) => i.id === id && i.status !== "RESOLVED" ? { ...i, status: "RESOLVED" } : i)
    );
  };

  // ── Response Engine action helpers ──────────────────────────────────
  // triggerAction opens the confirmation modal.
  // The 6th arg `dangerous` marks non-reversible actions (kill, etc.)
  const triggerAction = (action, params, title, description, command = "", dangerous = false) => {
    setPendingAction({ action, params, title, description, command, dangerous });
  };

  const confirmAction = () => {
    if (!pendingAction) return;
    const { action, params } = pendingAction;
    const cmd = { action, ...params, confirm: true };
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(cmd));
    setPendingAction(null);
  };

  const cancelAction = () => setPendingAction(null);

  const addToast = (type, message) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  };

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const saveSettings = (partialSettings) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "save_settings", settings: partialSettings, confirm: true }));
  };

  const refreshFeeds = () => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "refresh_feeds" }));
  };

  // Phase 4 — send a manual IP lookup request to the backend
  const sendLookup = (ip) => {
    if (!ip || wsRef.current?.readyState !== WebSocket.OPEN) return;
    setLookupLoading((prev) => new Set([...prev, ip]));
    wsRef.current.send(JSON.stringify({ action: "lookup_ip", ip }));
  };

  const toggleTiPanel = (ip) => {
    setTiPanelIp((prev) => (prev === ip ? null : ip));
  };

  const togglePlaybook = (name, enabled) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "toggle_playbook", name, enabled }));
    setPlaybooks((prev) => prev.map((pb) => pb.name === name ? { ...pb, enabled } : pb));
  };

  const dryRunPlaybook = (name) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    setDryRunLoading(name || "all");
    wsRef.current.send(JSON.stringify({ action: "dry_run_playbook", name: name || null }));
  };

  const savePlaybook = (yaml, filename) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "save_playbook", yaml, filename, confirm: true }));
  };

  const deletePlaybook = (name) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "delete_playbook", name, confirm: true }));
  };

  const reloadPlaybooks = () => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "reload_playbooks" }));
  };


  const filteredApps = apps.filter((a) => a.name.toLowerCase().includes(searchFilter.toLowerCase()));
  const filteredConns = selectedApp ? connections.filter((c) => c.app === selectedApp) : connections;
  const severityColor = { info: "#38bdf8", warning: "#fbbf24", danger: "#ef4444" };
  const severityBg = { info: "rgba(56,189,248,0.1)", warning: "rgba(251,191,36,0.1)", danger: "rgba(239,68,68,0.1)" };
  const wsStatusColor = { connecting: "#fbbf24", connected: "#22c55e", disconnected: "#ef4444", auth_failed: "#ef4444" }[wsStatus];

  const threatCount = threats.length;
  const openIncidentCount = incidents.filter((i) => i.status === "OPEN").length;


  const tabs = [
    { id: "graph",       label: "📈 TRAFFIC" },
    { id: "analytics",   label: "📊 ANALYTICS" },
    { id: "map",         label: "🗺️ MAP" },
    { id: "firewall",    label: "🛡️ FIREWALL" },
    { id: "connections", label: "🔗 CONNECTIONS" },
    { id: "alerts",      label: `🔔 ALERTS${alerts.filter((a) => a.severity !== "info").length ? ` (${alerts.filter((a) => a.severity !== "info").length})` : ""}` },
    { id: "incidents",   label: `🚨 INCIDENTS${openIncidentCount ? ` (${openIncidentCount})` : ""}` },
    { id: "playbooks",   label: `📋 PLAYBOOKS${playbooks.length ? ` (${playbooks.length})` : ""}` },
    { id: "audit",       label: `🗒️ AUDIT${auditLog.length ? ` (${auditLog.length})` : ""}` },
    { id: "settings",    label: "⚙️ SETTINGS" },
  ];

  return (
    <div style={{ fontFamily: "'JetBrains Mono','Fira Code','SF Mono',monospace", background: "#060a12", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── HEADER ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid rgba(56,189,248,0.1)", background: "linear-gradient(180deg,rgba(56,189,248,0.04) 0%,transparent 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#0ea5e9,#06b6d4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#0a0e17", boxShadow: "0 0 20px rgba(14,165,233,0.3)" }}>⚡</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.5, color: "#38bdf8" }}>FLOWSTATE</div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 2 }}>LOCAL NETWORK MONITOR</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>TOTAL SESSION</div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: "#38bdf8" }}>↓ {formatBytes(totalRecv)}</span>
              <span style={{ margin: "0 8px", color: "#334155" }}>|</span>
              <span style={{ color: "#fb923c" }}>↑ {formatBytes(totalSent)}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: wsStatusColor, boxShadow: `0 0 8px ${wsStatusColor}`, animation: wsStatus === "connected" ? "pulse 2s infinite" : "none" }} />
            <div style={{ fontSize: 8, color: "#475569", letterSpacing: 0.5 }}>{wsStatus.replace("_", " ").toUpperCase()}</div>
          </div>
        </div>
      </div>

      <StatusBanner status={wsStatus} />

      {/* ── TAB BAR ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(56,189,248,0.08)", background: "#080c16" }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "10px 18px", background: tab === t.id ? "rgba(56,189,248,0.08)" : "transparent",
            border: "none", borderBottom: tab === t.id ? "2px solid #38bdf8" : "2px solid transparent",
            color: tab === t.id ? "#38bdf8" : "#64748b", fontSize: 11, fontWeight: 600, letterSpacing: 1.2,
            cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, padding: 20, overflow: "auto" }}>

        {/* ══ TRAFFIC TAB ══════════════════════════════════════════ */}
        {tab === "graph" && (
          <TrafficTab
            history={history}
            apps={apps}
            blockedApps={blockedApps}
            connections={connections}
            soarStats={soarStats}
            incidents={incidents}
            graphContainerRef={graphContainerRef}
            graphWidth={graphWidth}
            toggleBlock={toggleBlock}
            triggerAction={triggerAction}
            threatCount={threatCount}
            openIncidentCount={openIncidentCount}
          />
        )}

        {/* ══ ANALYTICS TAB ════════════════════════════════════════ */}
        {tab === "analytics" && (
          <AnalyticsTab apps={apps} connections={connections} />
        )}

        {/* ══ NETWORK MAP TAB ══════════════════════════════════════ */}
        {tab === "map" && (
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>
                NETWORK TOPOLOGY <span style={{ color: "#475569", fontWeight: 400 }}>— LAN · Router/Gateway · Internet</span>
              </div>
              {gateway && (
                <div style={{ fontSize: 10, color: "#475569" }}>
                  GW: <span style={{ color: "#f59e0b" }}>{gateway}</span>
                  {localIp && <> · PC: <span style={{ color: "#38bdf8" }}>{localIp}</span></>}
                  {lanDevices.length > 0 && <> · {lanDevices.length} ARP device{lanDevices.length !== 1 ? "s" : ""}</>}
                </div>
              )}
            </div>
            <div style={{ borderRadius: 10, border: "1px solid rgba(56,189,248,0.08)", background: "#080d18", padding: 16 }}>
              <NetworkMap gateway={gateway} localIp={localIp} lanDevices={lanDevices} connections={connections} apps={apps} />
            </div>
          </div>
        )}

        {/* ══ FIREWALL TAB ═════════════════════════════════════════ */}
        {tab === "firewall" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: "linear-gradient(135deg,rgba(251,146,60,0.06),transparent)", border: "1px solid rgba(251,146,60,0.1)" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Ask to Connect Mode</div>
                <div style={{ fontSize: 10, color: "#64748b" }}>Prompt before new apps access the network</div>
              </div>
              <button onClick={() => setAskToConnect(!askToConnect)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: askToConnect ? "#22c55e" : "#334155", color: askToConnect ? "#0a0e17" : "#94a3b8", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: askToConnect ? "0 0 12px rgba(34,197,94,0.3)" : "none" }}>
                {askToConnect ? "ENABLED" : "DISABLED"}
              </button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <input type="text" placeholder="Search apps..." value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)}
                style={{ width: "100%", padding: "8px 14px", borderRadius: 8, background: "#0f1422", border: "1px solid rgba(56,189,248,0.1)", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            </div>
            {filteredApps.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>{apps.length === 0 ? "Waiting for data…" : "No apps match."}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filteredApps.map((app) => (
                  <div key={app.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ fontSize: 22 }}>{app.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{app.name}</div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>PID: {app.pid} · {app.connections} conns · ↓ {formatRate(app.recv)} · ↑ {formatRate(app.sent)}</div>
                    </div>
                    <Sparkline data={(appHistory[app.name] || []).slice(-60)} color={blockedApps.has(app.name) ? "#ef4444" : "#38bdf8"} w={60} h={40} />
                    {app.pid > 0 && (
                      <ActionBtn icon="☠️" label="Kill" color="#fb923c"
                        onClick={() => triggerAction(
                          "kill_process", { pid: app.pid, name: app.name },
                          `Kill Process: ${app.name}`,
                          `Terminate ${app.name} (PID ${app.pid}) immediately using taskkill /F.`,
                          `taskkill /PID ${app.pid} /F`,
                          true,
                        )}
                      />
                    )}
                    <button onClick={() => toggleBlock(app.name)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: blockedApps.has(app.name) ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", color: blockedApps.has(app.name) ? "#ef4444" : "#4ade80", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minWidth: 80 }}>
                      {blockedApps.has(app.name) ? "🚫 BLOCKED" : "✓ ALLOW"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Blocklist Manager ─────────────────────────────── */}
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: 1.5, marginBottom: 12 }}>BLOCKLIST MANAGER</div>

              {/* Session netsh blocks */}
              {blockedIps.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1, marginBottom: 8 }}>
                    ACTIVE IP BLOCKS (this session — Windows Firewall rules)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {blockedIps.map((ip) => (
                      <div key={ip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderRadius: 8, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                        <span style={{ color: "#ef4444", fontSize: 12 }}>🚫</span>
                        <span style={{ flex: 1, fontSize: 11, fontVariantNumeric: "tabular-nums", color: "#fca5a5" }}>{ip}</span>
                        <ActionBtn icon="✅" label="Unblock" color="#4ade80"
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
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1, marginBottom: 8 }}>
                  PERSISTENT BLOCKLIST (data/blocklist.txt — {blocklist.length} entries)
                </div>
                {blocklist.length === 0 ? (
                  <div style={{ color: "#334155", fontSize: 11, padding: "10px 0" }}>No IPs in blocklist.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
                    {blocklist.map((ip) => (
                      <div key={ip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 7, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <span style={{ flex: 1, fontSize: 11, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{ip}</span>
                        <ActionBtn icon="🚫" label="Block Now" color="#ef4444"
                          onClick={() => triggerAction(
                            "block_ip", { ip },
                            `Block IP ${ip}`,
                            `Add Windows Firewall rules to block all traffic to/from ${ip}.`,
                            `netsh advfirewall firewall add rule name="FlowState Block OUT ${ip}" dir=out action=block remoteip=${ip}`,
                            false,
                          )}
                        />
                        <ActionBtn icon="🗑️" label="Remove" color="#64748b"
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
                    style={{ flex: 1, padding: "7px 12px", borderRadius: 7, background: "#0f1422", border: "1px solid rgba(56,189,248,0.12)", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", outline: "none" }}
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
        )}

        {/* ══ CONNECTIONS TAB ══════════════════════════════════════ */}
        {tab === "connections" && (
          <div>
            {/* App filter buttons + threat summary banner */}
            <div style={{ display: "flex", gap: 8, marginBottom: threatCount > 0 ? 10 : 16, flexWrap: "wrap" }}>
              <button onClick={() => setSelectedApp(null)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: !selectedApp ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)", color: !selectedApp ? "#38bdf8" : "#94a3b8", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>ALL</button>
              {[...new Set(connections.map((c) => c.app))].map((app) => (
                <button key={app} onClick={() => setSelectedApp(app === selectedApp ? null : app)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: selectedApp === app ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.04)", color: selectedApp === app ? "#38bdf8" : "#94a3b8", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{app}</button>
              ))}
            </div>

            {/* Threat summary banner — only shown when threats are present */}
            {threatCount > 0 && (
              <div style={{
                marginBottom: 14, padding: "10px 14px", borderRadius: 8,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              }}>
                <span style={{ fontSize: 13 }}>⚠</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>
                  {threatCount} flagged connection{threatCount !== 1 ? "s" : ""}
                </span>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>
                  — matched against threat intelligence feeds. Alert-only mode: no traffic has been blocked.
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
                  {[...new Set(threats.map((t) => t.feed))].map((f) => (
                    <span key={f} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>{f}</span>
                  ))}
                </div>
              </div>
            )}

            {connections.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>Waiting for connection data…</div>
            ) : (
              <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(56,189,248,0.08)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "rgba(56,189,248,0.04)" }}>
                      {["App","Remote Host","IP Address","Port","Protocol","Status","Threat","Actions"].map((h) => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: h === "Threat" ? "#ef4444" : h === "Actions" ? "#a78bfa" : "#64748b", fontWeight: 600, borderBottom: "1px solid rgba(56,189,248,0.06)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredConns.map((c, i) => {
                      const isThreat = Boolean(c.threat);
                      const tiResult  = threatIntelCache[c.remote];
                      const tiScore   = tiResult?.risk_score ?? -1;
                      const tiActive  = tiPanelIp === c.remote;
                      // Row tint from TI score (overrides threat tint when higher confidence)
                      let rowBg = isThreat ? "rgba(239,68,68,0.06)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)";
                      let rowBorder = isThreat ? "1px solid rgba(239,68,68,0.15)" : "1px solid rgba(255,255,255,0.03)";
                      if (tiScore >= 70) { rowBg = "rgba(239,68,68,0.10)"; rowBorder = "1px solid rgba(239,68,68,0.25)"; }
                      else if (tiScore >= 40) { rowBg = "rgba(251,146,60,0.08)"; rowBorder = "1px solid rgba(251,146,60,0.2)"; }
                      else if (tiScore >= 15) { rowBg = "rgba(251,191,36,0.06)"; rowBorder = "1px solid rgba(251,191,36,0.15)"; }
                      return (
                        <tr key={i} style={{ background: rowBg, borderBottom: rowBorder }}>
                          <td style={{ padding: "8px 12px", fontWeight: 600, color: isThreat ? "#fca5a5" : undefined }}>{c.app}</td>
                          <td style={{ padding: "8px 12px", color: isThreat ? "#fca5a5" : "#38bdf8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.host}>{c.host}</td>
                          <td style={{ padding: "8px 12px", color: isThreat ? "#ef4444" : "#94a3b8", fontWeight: isThreat ? 700 : 400 }}>{c.remote}</td>
                          <td style={{ padding: "8px 12px" }}>{c.port}</td>
                          <td style={{ padding: "8px 12px" }}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>{c.protocol}</span></td>
                          <td style={{ padding: "8px 12px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.status === "ESTABLISHED" ? "#22c55e" : "#fbbf24" }} />
                              <span style={{ fontSize: 10, color: c.status === "ESTABLISHED" ? "#4ade80" : "#fbbf24" }}>{c.status}</span>
                            </span>
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            {isThreat
                              ? <ThreatBadge threat={c.threat} compact />
                              : tiScore >= 0
                                ? <span style={{ fontSize: 9, color: riskColor(tiScore).color, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: riskColor(tiScore).bg }}>{riskColor(tiScore).label}</span>
                                : <span style={{ color: "#1e293b", fontSize: 9 }}>—</span>
                            }
                          </td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", gap: 4 }}>
                              {c.remote && c.remote !== "N/A" && (
                                <ActionBtn icon="🚫" label="Block" color="#ef4444"
                                  title={`Block IP ${c.remote}`}
                                  onClick={() => triggerAction(
                                    "block_ip", { ip: c.remote },
                                    `Block IP ${c.remote}`,
                                    `Add Windows Firewall rules to block all inbound and outbound traffic to/from ${c.remote} (${c.app}).`,
                                    `netsh advfirewall firewall add rule name="FlowState Block ${c.remote}" dir=out action=block remoteip=${c.remote}`,
                                    true
                                  )}
                                />
                              )}
                              {c.pid && (
                                <ActionBtn icon="☠️" label="Kill" color="#fb923c"
                                  title={`Kill process ${c.app} (PID ${c.pid})`}
                                  onClick={() => triggerAction(
                                    "kill_process", { pid: c.pid, name: c.app },
                                    `Kill Process ${c.app}`,
                                    `Terminate process "${c.app}" (PID ${c.pid}) immediately with taskkill /F. All open connections from this process will be closed. This cannot be undone.`,
                                    `taskkill /PID ${c.pid} /F`,
                                    true
                                  )}
                                />
                              )}
                              <ActionBtn icon="📸" label="Snap" color="#38bdf8"
                                title="Capture network snapshot"
                                onClick={() => triggerAction(
                                  "capture_snapshot", {},
                                  "Capture Network Snapshot",
                                  "Save current connection state and process list to data/snapshots/{timestamp}.json for forensic review.",
                                  "Save snapshot to data/snapshots/",
                                  false
                                )}
                              />
                              {c.remote && c.remote !== "N/A" && (
                                <LookupBtn
                                  ip={c.remote}
                                  loading={lookupLoading.has(c.remote)}
                                  cached={Boolean(tiResult)}
                                  onClick={() => {
                                    if (!tiResult) sendLookup(c.remote);
                                    toggleTiPanel(c.remote);
                                  }}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ══ ALERTS TAB ═══════════════════════════════════════════ */}
        {tab === "alerts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 12, padding: "20px 0" }}>No alerts yet.</div>
            ) : (
              [...alerts].reverse().map((a, i) => (
                <div key={i} style={{ padding: "12px 16px", borderRadius: 10, background: severityBg[a.severity] || severityBg.info, border: `1px solid ${(severityColor[a.severity] || severityColor.info)}22`, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: severityColor[a.severity] || severityColor.info, boxShadow: `0 0 8px ${severityColor[a.severity] || severityColor.info}` }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{a.message}</div>
                    <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{a.type.toUpperCase()} · {a.time}</div>
                  </div>
                  <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: `${(severityColor[a.severity] || severityColor.info)}22`, color: severityColor[a.severity] || severityColor.info, letterSpacing: 0.5 }}>
                    {(a.severity || "info").toUpperCase()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* ══ INCIDENTS TAB ════════════════════════════════════════ */}
        {tab === "incidents" && (
          <IncidentsTab
            incidents={incidents}
            onAcknowledge={acknowledgeIncident}
            onResolve={resolveIncident}
            onAction={triggerAction}
            apps={apps}
          />
        )}

        {/* ══ PLAYBOOKS TAB ════════════════════════════════════════ */}
        {tab === "playbooks" && (
          <PlaybooksTab
            playbooks={playbooks}
            incidents={incidents}
            playbookActivity={playbookActivity}
            dryRunResults={dryRunResults}
            dryRunLoading={dryRunLoading}
            onToggle={togglePlaybook}
            onDryRun={dryRunPlaybook}
            onSave={savePlaybook}
            onDelete={deletePlaybook}
            onReload={reloadPlaybooks}
            wsReady={wsStatus === "connected"}
          />
        )}

        {/* ══ AUDIT TAB ════════════════════════════════════════════ */}
        {tab === "audit" && (
          <AuditLogTab auditLog={auditLog} undoStack={undoStack} onAction={triggerAction} />
        )}

        {/* ══ SETTINGS TAB ═════════════════════════════════════════ */}
        {tab === "settings" && (
          <SettingsTab
            settings={settings}
            soarStats={soarStats}
            onSave={saveSettings}
            onRefreshFeeds={refreshFeeds}
            wsReady={wsStatus === "connected"}
          />
        )}
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <div style={{ padding: "8px 24px", borderTop: "1px solid rgba(56,189,248,0.06)", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", background: "#080c16" }}>
        <span>FLOWSTATE v1.0 · Local Network Monitor</span>
        <span>Backend: ws://localhost:8765 · Status: {wsStatus.replace("_", " ").toUpperCase()}</span>
      </div>

      {/* ── CONFIRMATION MODAL + TOASTS ───────────────────────────── */}
      <ConfirmModal pending={pendingAction} onConfirm={confirmAction} onCancel={cancelAction} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Phase 4 — Threat Intel Panel */}
      {tiPanelIp && (
        <ThreatIntelPanel
          ip={tiPanelIp}
          result={threatIntelCache[tiPanelIp]}
          onClose={() => setTiPanelIp(null)}
        />
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
        @keyframes toastIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.2); border-radius: 3px; }
      `}</style>
    </div>
  );
}
