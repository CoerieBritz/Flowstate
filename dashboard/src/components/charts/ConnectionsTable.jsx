import { useState, useEffect, useRef, useMemo } from "react";
import { formatRate } from "../../lib/format";
import { T, withAlpha } from "../../lib/theme";

// Top connections — aggregated by (app, host, protocol), sortable
export function ConnectionsTable({ connections, apps }) {
  const [sortField, setSortField] = useState("bw");
  const [sortDir, setSortDir] = useState("desc");
  const startTimesRef = useRef(new Map());

  // Record first-seen time for each (app, host, protocol) triple
  useEffect(() => {
    const now = Date.now();
    connections.forEach((c) => {
      const key = `${c.app}||${c.host}||${c.protocol}`;
      if (!startTimesRef.current.has(key)) startTimesRef.current.set(key, now);
    });
  }, [connections]);

  const rows = useMemo(() => {
    // Aggregate by (app, host, protocol)
    const agg = new Map();
    connections.forEach((c) => {
      const key = `${c.app}||${c.host}||${c.protocol}`;
      if (!agg.has(key)) agg.set(key, { app: c.app, host: c.host, protocol: c.protocol, count: 0 });
      agg.get(key).count++;
    });

    // Proportional bandwidth per aggregated row
    const appTotals = new Map(
      apps.map((a) => [a.name, { recv: a.recv, sent: a.sent, n: connections.filter((c) => c.app === a.name).length || 1 }])
    );

    return [...agg.entries()].map(([key, row]) => {
      const ab = appTotals.get(row.app);
      const frac = ab ? row.count / ab.n : 0;
      const recv = ab ? ab.recv * frac : 0;
      const sent = ab ? ab.sent * frac : 0;
      const startTs = startTimesRef.current.get(key);
      const duration = startTs ? Math.floor((Date.now() - startTs) / 1000) : 0;
      return { key, ...row, recv, sent, bw: recv + sent, duration };
    });
  }, [connections, apps]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    }).slice(0, 10);
  }, [rows, sortField, sortDir]);

  const toggle = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const fmtDur = (s) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  const Th = ({ field, children, align = "left" }) => (
    <th onClick={() => toggle(field)} style={{
      padding: "10px 12px", textAlign: align, cursor: "pointer", userSelect: "none",
      fontSize: 11, letterSpacing: 1.2, fontWeight: 600, whiteSpace: "nowrap",
      color: sortField === field ? T.accent : T.textSecondary,
      borderBottom: `1px solid ${withAlpha(T.accent, 0.08)}`,
      background: withAlpha(T.accent, 0.04),
      transition: "color 0.15s",
    }}>
      {children}{sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  if (sorted.length === 0) {
    return <div style={{ color: T.textMuted, fontSize: 12, padding: "20px 0" }}>Waiting for connection data…</div>;
  }

  return (
    <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${withAlpha(T.accent, 0.08)}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <Th field="app">App</Th>
            <Th field="host">Destination</Th>
            <Th field="protocol">Protocol</Th>
            <Th field="recv" align="right">↓ Download</Th>
            <Th field="sent" align="right">↑ Upload</Th>
            <Th field="duration" align="right">Duration</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.key} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <td style={{ padding: "8px 12px", fontWeight: 600 }}>{row.app}</td>
              <td style={{ padding: "8px 12px", color: T.accent, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.host}>{row.host}</td>
              <td style={{ padding: "8px 12px" }}>
                <span style={{ fontFamily: T.fontLabel, padding: "2px 7px", borderRadius: 4, fontSize: 11, background: "rgba(139,92,246,0.12)", color: "#a78bfa", letterSpacing: 0.5 }}>{row.protocol}</span>
              </td>
              <td style={{ padding: "8px 12px", textAlign: "right", color: T.download, fontVariantNumeric: "tabular-nums" }}>{formatRate(row.recv)}</td>
              <td style={{ padding: "8px 12px", textAlign: "right", color: T.upload, fontVariantNumeric: "tabular-nums" }}>{formatRate(row.sent)}</td>
              <td style={{ padding: "8px 12px", textAlign: "right", color: T.textSecondary, fontVariantNumeric: "tabular-nums" }}>{fmtDur(row.duration)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
