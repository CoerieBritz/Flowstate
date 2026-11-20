import { useEffect, useRef } from "react";

// ════════════════════════════════════════════════════════════════════
// SPARKLINE — 80 px tall with gradient area fill
// ════════════════════════════════════════════════════════════════════
export function Sparkline({ data, color, w = 80, h = 80 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || data.length < 2) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const max = Math.max(...data, 1);
    const step = (w - 2) / (data.length - 1);
    const xOf = (i) => 1 + i * step;
    const yOf = (v) => h - 2 - (v / max) * (h - 6);

    // Area fill
    ctx.beginPath();
    ctx.moveTo(xOf(0), h - 2);
    data.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
    ctx.lineTo(xOf(data.length - 1), h - 2);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `${color}66`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad; ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => { i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)); });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  }, [data, color, w, h]);
  return <canvas ref={canvasRef} style={{ width: w, height: h }} />;
}
