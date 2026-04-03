#!/usr/bin/env bash
# NETWATCH — Start backend + dashboard together
# Usage: bash start.sh   (or: chmod +x start.sh && ./start.sh)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$SCRIPT_DIR/netwatch_backend.py"
DASHBOARD="$SCRIPT_DIR/dashboard"

# Verify dependencies exist
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found in PATH"
  exit 1
fi
if ! command -v npm &>/dev/null; then
  echo "ERROR: npm not found in PATH"
  exit 1
fi
if [ ! -d "$DASHBOARD/node_modules" ]; then
  echo "Installing dashboard dependencies..."
  (cd "$DASHBOARD" && npm install)
fi

echo "============================================"
echo "  ⚡ NETWATCH — Local Network Monitor"
echo "============================================"
echo "  Backend  : ws://localhost:8765"
echo "  Dashboard: http://localhost:5173"
echo "  Press Ctrl+C to stop both processes"
echo "============================================"
echo ""

# Cache sudo credentials so the background process doesn't prompt
sudo -v

# Start Python backend with sudo in background
sudo python3 "$BACKEND" &
BACKEND_PID=$!
echo "[✓] Backend started (PID $BACKEND_PID)"

# Small delay so the WebSocket is ready before the browser opens
sleep 1

# Start Vite dev server in background
(cd "$DASHBOARD" && npm run dev) &
VITE_PID=$!
echo "[✓] Vite dev server started (PID $VITE_PID)"

# Cleanup on exit
cleanup() {
  echo ""
  echo "[NETWATCH] Shutting down..."
  sudo kill $BACKEND_PID 2>/dev/null || true
  kill $VITE_PID 2>/dev/null || true
  wait 2>/dev/null
  echo "[NETWATCH] Done."
}
trap cleanup INT TERM

# Keep the script alive and forward Ctrl+C
wait
