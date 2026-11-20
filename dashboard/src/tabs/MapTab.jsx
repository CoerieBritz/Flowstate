import { T, withAlpha } from "../lib/theme";
import { NetworkMap } from "../components/charts/NetworkMap";

export function MapTab({ apps, connections, gateway, localIp, lanDevices }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontFamily: T.fontLabel, fontSize: 11, color: T.textSecondary, letterSpacing: 1 }}>
          NETWORK TOPOLOGY <span style={{ color: T.textMuted, fontWeight: 400 }}>— LAN · Router/Gateway · Internet</span>
        </div>
        {gateway && (
          <div style={{ fontSize: 11, color: T.textMuted }}>
            GW: <span style={{ color: "#f59e0b" }}>{gateway}</span>
            {localIp && <> · PC: <span style={{ color: T.accent }}>{localIp}</span></>}
            {lanDevices.length > 0 && <> · {lanDevices.length} ARP device{lanDevices.length !== 1 ? "s" : ""}</>}
          </div>
        )}
      </div>
      <div style={{ borderRadius: 10, border: `1px solid ${withAlpha(T.accent, 0.08)}`, background: T.panel, padding: 16 }}>
        <NetworkMap gateway={gateway} localIp={localIp} lanDevices={lanDevices} connections={connections} apps={apps} />
      </div>
    </div>
  );
}
