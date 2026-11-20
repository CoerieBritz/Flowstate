import { useEffect, useRef } from "react";
import { T, withAlpha } from "../../lib/theme";

// ════════════════════════════════════════════════════════════════════
// TRAFFIC GRAPH (canvas — rolling 2-min area chart)
// Smooth curves use monotone cubic interpolation (Fritsch–Carlson), which
// never overshoots between samples, so a curve can't dip below zero.
// ════════════════════════════════════════════════════════════════════

const PAD = { left: 74, right: 16, top: 14, bottom: 30 };
const X_TICK_MS = 20_000;   // time label every 20 s

/** Fritsch–Carlson tangents for points with strictly increasing x. */
function monotoneTangents(xs, ys) {
  const n = xs.length;
  const d = new Array(n - 1);   // secant slopes
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    if (a < 0) m[i] = 0;
    if (b < 0) m[i + 1] = 0;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
}

/** Trace a monotone cubic through (xs, ys) on ctx (path must be begun). */
function traceMonotone(ctx, xs, ys, moveFirst) {
  const m = monotoneTangents(xs, ys);
  if (moveFirst) ctx.moveTo(xs[0], ys[0]); else ctx.lineTo(xs[0], ys[0]);
  for (let i = 0; i < xs.length - 1; i++) {
    const h = (xs[i + 1] - xs[i]) / 3;
    ctx.bezierCurveTo(xs[i] + h, ys[i] + m[i] * h, xs[i + 1] - h, ys[i + 1] - m[i + 1] * h, xs[i + 1], ys[i + 1]);
  }
}

/** Y scale: unit (B/KB/MB per s), a nice step, and the rounded-up max. */
function niceScale(maxVal, ticks = 4) {
  const unit = maxVal < 1024 ? 1 : maxVal < 1048576 ? 1024 : 1048576;
  const suffix = unit === 1 ? "B/s" : unit === 1024 ? "KB/s" : "MB/s";
  const raw = maxVal / unit / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag * unit;
  const top = Math.ceil(maxVal / step) * step;
  const label = (v) => `${Number((v / unit).toFixed(2))} ${suffix}`;
  return { step, top, label };
}

const two = (n) => String(n).padStart(2, "0");
const hhmmss = (ms) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };

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

    const x0 = PAD.left, x1 = width - PAD.right;
    const y0 = PAD.top, y1 = height - PAD.bottom;   // y1 = baseline (zero)
    const gW = Math.max(1, x1 - x0), gH = Math.max(1, y1 - y0);
    const font = `11px ${T.fontMono}`;

    if (history.length < 1) {
      ctx.strokeStyle = withAlpha(T.textSecondary, 0.08);
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = Math.round(y0 + (gH / 4) * i) + 0.5;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      }
      ctx.fillStyle = T.textMuted;
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.fillText("Waiting for data…", x0 + gW / 2, y0 + gH / 2);
      return;
    }

    const pts = history.length >= 2 ? history : [history[0], history[0]];
    const maxVal = Math.max(...pts.map((h) => Math.max(h.sent || 0, h.recv || 0)), 1024);
    const { step, top, label } = niceScale(maxVal);
    const xs = pts.map((_, i) => x0 + (i / (pts.length - 1)) * gW);
    const yOf = (v) => y1 - (Math.max(0, v || 0) / top) * gH;

    // ── Horizontal gridlines + Y labels ──────────────────────────────
    ctx.font = font;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    for (let v = 0; v <= top + step / 2; v += step) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? withAlpha(T.textSecondary, 0.22) : withAlpha(T.textSecondary, 0.09);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.fillStyle = T.textSecondary;
      ctx.fillText(label(v), x0 - 10, y);
    }

    // ── X labels: exact 20 s boundaries, HH:MM:SS ────────────────────
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 1; i < pts.length; i++) {
      const ta = pts[i - 1].time, tb = pts[i].time;
      if (!ta || !tb || tb <= ta) continue;
      const boundary = Math.ceil(ta / X_TICK_MS) * X_TICK_MS;
      if (boundary > tb || boundary === ta && i > 1) continue;
      const x = xs[i - 1] + ((boundary - ta) / (tb - ta)) * (xs[i] - xs[i - 1]);
      if (x < x0 + 30 || x > x1 - 30) continue;
      ctx.strokeStyle = withAlpha(T.textSecondary, 0.06);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, y1); ctx.stroke();
      ctx.strokeStyle = withAlpha(T.textSecondary, 0.35);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y1); ctx.lineTo(Math.round(x) + 0.5, y1 + 4); ctx.stroke();
      ctx.fillStyle = T.textSecondary;
      ctx.fillText(hhmmss(boundary), x, y1 + 8);
    }

    // ── Series: gradient area + glowing monotone curve ───────────────
    const drawSeries = (field, color, fillTop) => {
      const ys = pts.map((h) => yOf(h[field]));

      ctx.beginPath();
      ctx.moveTo(xs[0], y1);
      traceMonotone(ctx, xs, ys, false);
      ctx.lineTo(xs[xs.length - 1], y1);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, withAlpha(color, fillTop));
      g.addColorStop(1, withAlpha(color, 0.01));
      ctx.fillStyle = g;
      ctx.fill();

      ctx.beginPath();
      traceMonotone(ctx, xs, ys, true);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round";
      ctx.shadowColor = color; ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const lx = xs[xs.length - 1], ly = ys[ys.length - 1];
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
      ctx.fill(); ctx.shadowBlur = 0;
    };

    drawSeries("recv", T.download, 0.38);
    drawSeries("sent", T.upload, 0.30);
  }, [history, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 8, display: "block" }} />;
}
