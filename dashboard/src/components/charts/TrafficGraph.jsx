import { useEffect, useRef } from "react";
import { formatRate } from "../../lib/format";
import { T, withAlpha } from "../../lib/theme";

// ════════════════════════════════════════════════════════════════════
// TRAFFIC GRAPH (canvas — rolling 2-min area chart)
// ════════════════════════════════════════════════════════════════════
export function TrafficGraph({ history, width, height }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 10 || height < 10) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = T.panel;
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = withAlpha(T.accent, 0.06);
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = 20 + ((height - 50) / 5) * i;
      ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(width - 10, y); ctx.stroke();
    }

    if (history.length < 1) {
      ctx.fillStyle = T.textMuted;
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for data…", width / 2, height / 2);
      return;
    }

    const pts = history.length >= 2 ? history : [history[0], history[0]];
    const maxVal = Math.max(...pts.map((h) => Math.max(h.sent || 0, h.recv || 0)), 1024);
    const gH = height - 50, gW = width - 60;
    const step = gW / (pts.length - 1);
    const xOf = (i) => 50 + i * step;
    const yOf = (v) => 20 + gH - (v / maxVal) * gH;

    const drawArea = (field, gradTop, gradBot, lineColor) => {
      ctx.beginPath();
      ctx.moveTo(xOf(0), 20 + gH);
      pts.forEach((h, i) => ctx.lineTo(xOf(i), yOf(h[field] || 0)));
      ctx.lineTo(xOf(pts.length - 1), 20 + gH);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 20, 0, 20 + gH);
      g.addColorStop(0, gradTop); g.addColorStop(1, gradBot);
      ctx.fillStyle = g; ctx.fill();

      ctx.beginPath();
      pts.forEach((h, i) => {
        const x = xOf(i), y = yOf(h[field] || 0);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = lineColor; ctx.lineWidth = 2;
      ctx.shadowColor = lineColor; ctx.shadowBlur = 8;
      ctx.stroke(); ctx.shadowBlur = 0;

      const last = pts[pts.length - 1];
      const lx = xOf(pts.length - 1);
      const ly = yOf(last[field] || 0);
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fillStyle = lineColor; ctx.shadowColor = lineColor; ctx.shadowBlur = 12;
      ctx.fill(); ctx.shadowBlur = 0;
    };

    drawArea("recv", withAlpha(T.download, 0.40), withAlpha(T.download, 0.02), T.download);
    drawArea("sent", withAlpha(T.upload, 0.35), withAlpha(T.upload, 0.02), T.upload);

    ctx.fillStyle = "rgba(148,163,184,0.6)"; ctx.font = "11px monospace"; ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
      ctx.fillText(formatRate((maxVal / 5) * (5 - i)), 46, 24 + (gH / 5) * i);
    }
  }, [history, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 8 }} />;
}
