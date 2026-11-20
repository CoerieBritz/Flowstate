import { T, withAlpha } from "../lib/theme";

export function GlobalStyles() {
  return (
    <style>{`
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
        @keyframes toastIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${withAlpha(T.accent, 0.2)}; border-radius: 3px; }

        /* Data tables (className="fs-table"): 12px rows, hover highlight, sticky headers.
           Wrappers use overflow: clip, which rounds corners without trapping sticky. */
        .fs-table td { font-size: 12px !important; }
        .fs-table thead th {
          position: sticky; top: 0; z-index: 2;
          background: ${T.panel};
          box-shadow: inset 0 -1px 0 ${T.panelBorder};
        }
        .fs-table tbody tr { transition: background 0.12s; }
        .fs-table tbody tr:hover { background: ${withAlpha(T.accent, 0.07)} !important; }
      `}</style>
  );
}
