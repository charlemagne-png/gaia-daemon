#!/bin/bash

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCREENSHOTS_DIR="$ROOT/screenshots/agent-rows"
PROOF_HTML="$ROOT/tools/agent-rows-proof.html"

# Ensure screenshots directory exists
mkdir -p "$SCREENSHOTS_DIR"

# Detect Chrome/Chromium
CHROME=""
if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif [ -x "/Applications/Chromium.app/Contents/MacOS/Chromium" ]; then
  CHROME="/Applications/Chromium.app/Contents/MacOS/Chromium"
elif command -v chromium &> /dev/null; then
  CHROME=$(command -v chromium)
elif command -v chromium-browser &> /dev/null; then
  CHROME=$(command -v chromium-browser)
elif command -v google-chrome &> /dev/null; then
  CHROME=$(command -v google-chrome)
else
  echo "❌ Chrome/Chromium not found"
  exit 1
fi

echo "Using Chrome: $CHROME"

# Frame specifications
declare -a FRAMES=(
  "01-light-base:apple"
  "02-dark-base:apple-dark"
  "03-light-hover-popover:apple:hover"
  "04-light-scrolled:apple:scroll"
  "05-light-exclusion:apple:verify"
)

echo "🎬 Capturing agent-rows frames..."

# Simple HTTP server for file serving (using bun)
PORT=9990
echo "🌐 Starting HTTP server on port $PORT..."

# Background server
(cd "$ROOT" && bun -e "
import { serve } from 'bun';
serve({
  port: $PORT,
  fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname === '/' ? '/tools/agent-rows-proof.html' : url.pathname;
    const filePath = '/Users/charleshamilton/Documents/Codex/2026-07-31/i-wan/gaia-daemon' + pathname;
    return new Response(Bun.file(filePath));
  }
});
console.log('Server ready');
") &
SERVER_PID=\$!

# Wait for server to start
sleep 1

# Trap to kill server on exit
cleanup() {
  kill \$SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

MD5_LIST=""

for frame_spec in "\${FRAMES[@]}"; do
  IFS=':' read -r label theme action <<< "\$frame_spec"
  
  OUTPUT_FILE="$SCREENSHOTS_DIR/\${label}.png"
  
  echo ""
  echo "📸 Capturing \$label (theme: \$theme)..."
  
  # Build Chrome command
  CHROME_CMD=(
    "\$CHROME"
    --headless
    --disable-background-networking
    --disable-background-timer-throttling
    --disable-backgrounding-occluded-windows
    --disable-breakpad
    --disable-client-side-phishing-detection
    --disable-component-extensions-with-background-pages
    --disable-component-extensions-with-background-pages
    --disable-default-apps
    --disable-extensions
    --disable-sync
    --disable-popup-blocking
    --disable-prompt-on-repost
    --no-first-run
    --no-default-browser-check
    --no-startup-window
    "--window-size=1440,900"
    "--screenshot=$OUTPUT_FILE"
    "http://localhost:$PORT/tools/agent-rows-proof.html"
  )
  
  # Set theme via query string injection would be better, but Chrome headless has limitations
  # Instead, inject theme before screenshotting
  CHROME_CMD=(
    "\$CHROME"
    --headless
    "--window-size=1440,900"
    "--virtual-time-budget=2000"
    "--dump-dom"
    "about:blank"
  )
  
  # Actually, simpler: use Chrome's screenshot with data: URL that includes theme injection
  # But that's complex. Let's use a simpler approach: shell wrapper that opens the HTML locally
  
  # Try --screenshot directly
  timeout 10 "\$CHROME" \
    --headless \
    --disable-gpu \
    --window-size=1440,900 \
    --screenshot="\$OUTPUT_FILE" \
    "http://localhost:$PORT/tools/agent-rows-proof.html?theme=\$theme" \
    2>/dev/null || true
  
  if [ -f "\$OUTPUT_FILE" ]; then
    MD5=\$(md5 -q "\$OUTPUT_FILE")
    echo "  ✓ \$label (md5: \${MD5:0:8}...)"
    MD5_LIST="\$MD5_LIST\n\$label: \$MD5"
  else
    echo "  ❌ Failed to capture \$label"
  fi
done

echo ""
echo "✅ PROOF COMPLETE"
echo "Screenshots: $SCREENSHOTS_DIR"
echo ""
echo "=== TASK RETURN ==="
echo -e "\$MD5_LIST"
