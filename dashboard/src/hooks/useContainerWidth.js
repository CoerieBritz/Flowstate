import { useState, useEffect, useRef } from "react";

// ── Responsive-width hook ─────────────────────────────────────────────
export function useContainerWidth(ref, fallback = 800) {
  const [width, setWidth] = useState(fallback);
  const nodeRef = useRef(null);
  const roRef = useRef(null);

  // Runs after every render, but only does work when the container
  // element has actually changed (e.g. after switching tabs and back).
  useEffect(() => {
    const node = ref.current;
    if (node === nodeRef.current) return;

    if (roRef.current) roRef.current.disconnect();
    roRef.current = null;
    nodeRef.current = node;
    if (!node) return;

    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) setWidth(w); // ignore 0 when hidden/minimized/unmounting
    });
    ro.observe(node);
    roRef.current = ro;
  });

  // Clean up when the component goes away
  useEffect(() => () => roRef.current?.disconnect(), []);

  return width;
}
