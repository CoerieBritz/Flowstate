import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { AppFooter } from "./components/AppFooter";
import { AppHeader } from "./components/AppHeader";
import { ConfirmModal } from "./components/ConfirmModal";
import { GlobalStyles } from "./components/GlobalStyles";
import { StatusBanner } from "./components/StatusBanner";
import { TabNav } from "./components/TabNav";
import { ThreatIntelPanel } from "./components/ThreatIntelPanel";
import { ToastContainer } from "./components/ToastContainer";
import { useContainerWidth } from "./hooks/useContainerWidth";
import { getAppIcon } from "./lib/format";
import { groupOfTab } from "./lib/nav";
import { T } from "./lib/theme";
import { getWsToken, WS_URL } from "./lib/ws";
import { AlertsTab } from "./tabs/AlertsTab";
import { AnalyticsTab } from "./tabs/AnalyticsTab";
import { AuditLogTab } from "./tabs/AuditTab";
import { ConnectionsTab } from "./tabs/ConnectionsTab";
import { FirewallTab } from "./tabs/FirewallTab";
import { IncidentsTab } from "./tabs/IncidentsTab";
import { MapTab } from "./tabs/MapTab";
import { PlaybooksTab } from "./tabs/PlaybooksTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { TrafficTab } from "./tabs/TrafficTab";

// ════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════
export default function NetMonitor() {
  const [tab, setTab] = useState("graph");
  // Last-opened sub-tab per nav group, so returning to a group restores it.
  const [lastTabByGroup, setLastTabByGroup] = useState({ monitor: "graph", network: "map", soar: "alerts" });
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
        const token = await getWsToken();
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



  const threatCount = threats.length;
  const openIncidentCount = incidents.filter((i) => i.status === "OPEN").length;


  // ── Navigation ──────────────────────────────────────────────────────
  const selectTab = (id) => {
    setTab(id);
    const g = groupOfTab(id);
    if (g) setLastTabByGroup((prev) => ({ ...prev, [g]: id }));
  };
  const selectGroup = (g) => setTab(lastTabByGroup[g]);
  const navCounts = {
    alerts:        alerts.filter((a) => a.severity !== "info").length,
    incidents:     openIncidentCount,
    playbooks:     playbooks.length,
    audit:         auditLog.length,
    openIncidents: openIncidentCount,
  };

  return (
    <div style={{ fontFamily: T.fontMono, background: T.bg, color: T.text, height: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── HEADER ────────────────────────────────────────────────── */}
      <AppHeader totalSent={totalSent} totalRecv={totalRecv} wsStatus={wsStatus} />

      <StatusBanner status={wsStatus} />

      {/* ── TAB BAR ───────────────────────────────────────────────── */}
      <TabNav tab={tab} onSelectTab={selectTab} onSelectGroup={selectGroup} counts={navCounts} />

      <div style={{ flex: 1, minHeight: 0, padding: 20, overflow: "auto" }}>  {/* the only scroller: header/nav stay put, table headers stick */}

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
          <MapTab
            apps={apps}
            connections={connections}
            gateway={gateway}
            localIp={localIp}
            lanDevices={lanDevices}
          />
        )}

        {/* ══ FIREWALL TAB ═════════════════════════════════════════ */}
        {tab === "firewall" && (
          <FirewallTab
            apps={apps}
            appHistory={appHistory}
            blockedApps={blockedApps}
            blocklist={blocklist}
            blockedIps={blockedIps}
            newBlocklistIp={newBlocklistIp}
            setNewBlocklistIp={setNewBlocklistIp}
            searchFilter={searchFilter}
            setSearchFilter={setSearchFilter}
            askToConnect={askToConnect}
            setAskToConnect={setAskToConnect}
            toggleBlock={toggleBlock}
            triggerAction={triggerAction}
          />
        )}

        {/* ══ CONNECTIONS TAB ══════════════════════════════════════ */}
        {tab === "connections" && (
          <ConnectionsTab
            connections={connections}
            threats={threats}
            threatIntelCache={threatIntelCache}
            lookupLoading={lookupLoading}
            tiPanelIp={tiPanelIp}
            selectedApp={selectedApp}
            setSelectedApp={setSelectedApp}
            triggerAction={triggerAction}
            sendLookup={sendLookup}
            toggleTiPanel={toggleTiPanel}
            threatCount={threatCount}
          />
        )}

        {/* ══ ALERTS TAB ═══════════════════════════════════════════ */}
        {tab === "alerts" && (
          <AlertsTab alerts={alerts} />
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
      <AppFooter wsStatus={wsStatus} />

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

      <GlobalStyles />
    </div>
  );
}
