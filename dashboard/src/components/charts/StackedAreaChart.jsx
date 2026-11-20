import { useEffect, useRef, useMemo } from "react";
import { PALETTE } from "../../lib/colors";
import { formatRate } from "../../lib/format";

// ════════════════════════════════════════════════════════════════════
// STACKED AREA CHART — top-5 apps over last 5 min (canvas)
// ════════════════════════════════════════════════════════════════════
export function StackedAreaChart({ appHistory, apps, width, height }) {
  const canvasRef = useRef(null);

  const top5 = useMemo(
    () => [...apps].sort((a, b) => (b.recv + b.sent) - (a.recv + a.sent)).slice(0, 5),
    [apps]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 10) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, width, height);

    if (top5.length === 0) {
      ctx.fillStyle = "#475569"; ctx.font = "11px monospace"; ctx.textAlign = "center";
      ctx.fillText("Waiting for app data…", width / 2, height / 2);
      return;
    }

    const histories = top5.map((a) => appHistory[a.name] || []);
    const maxLen = Math.max(...histories.map((h) => h.length), 2);
    if (maxLen < 2) return;

    // Build stacked cumulative values per sample slot
    const stackedPts = []; // stackedPts[i] = [baseline0, val0top, val1top, ...]
    for (let i = 0; i < maxLen; i++) {
      const row = [0];
      for (let j = 0; j < top5.length; j++) {
        const h = histories[j];
        const idx = h.length - maxLen + i;
        const v = idx >= 0 ? (h[idx] || 0) : 0;
        row.push(row[row.length - 1] + v);
      }
      stackedPts.push(row);
    }

    const maxTotal = Math.max(...stackedPts.map((r) => r[r.length - 1]), 1);
    const padL = 58, padT = 16, padB = 28;
    const gW = width - padL - 10;
    const gH = height - padT - padB;

    const xOf = (i) => padL + (i / (maxLen - 1)) * gW;
    const yOf = (v) => padT + gH - (v / maxTotal) * gH;

    // Draw each layer top-down (last app = bottom)
    for (let j = top5.length - 1; j >= 0; j--) {
      const color = PALETTE[j % PALETTE.length];
      ctx.beginPath();
      // Lower boundary
      for (let i = 0; i < maxLen; i++) {
        const x = xOf(i), y = yOf(stackedPts[i][j]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      // Upper boundary (reversed)
      for (let i = maxLen - 1; i >= 0; i--) {
        ctx.lineTo(xOf(i), yOf(stackedPts[i][j + 1]));
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(0, padT, 0, padT + gH);
      g.addColorStop(0, `${color}aa`); g.addColorStop(1, `${color}33`);
      ctx.fillStyle = g; ctx.fill();

      // Top stroke
      ctx.beginPath();
      for (let i = 0; i < maxLen; i++) {
        const x = xOf(i), y = yOf(stackedPts[i][j + 1]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `${color}dd`; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = "rgba(148,163,184,0.55)"; ctx.font = "9px monospace"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      ctx.fillText(formatRate((maxTotal / 4) * (4 - i)), padL - 4, padT + (gH / 4) * i + 3);
    }
    // Time axis
    ctx.textAlign = "left";
    ctx.fillText(`-${Math.round(maxLen / 60)}m`, padL, height - 8);
    ctx.textAlign = "right";
    ctx.fillText("now", padL + gW, height - 8);

    // Legend
    const legY = height - 10;
    let legX = padL + 20;
    top5.forEach((app, j) => {
      ctx.fillStyle = PALETTE[j % PALETTE.length];
      ctx.fillRect(legX - 16, legY - 7, 10, 7);
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText(app.name.slice(0, 14), legX - 4, legY - 1);
      legX += Math.min(app.name.length, 14) * 5 + 24;
    });
  }, [appHistory, top5, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 8 }} />;
}
