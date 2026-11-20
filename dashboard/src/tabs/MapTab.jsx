import { NetworkMap } from "../components/charts/NetworkMap";

export function MapTab({ apps, connections, gateway, localIp, lanDevices }) {
  return (
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
  );
}
