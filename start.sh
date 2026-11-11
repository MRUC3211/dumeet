#!/bin/bash
# Starts DU Meet, creates a public https link with a Cloudflare tunnel and opens it.
#   ./start.sh           share with others over the internet
#   ./start.sh --local   only on this laptop (http://localhost:8000)
# Press Ctrl+C to stop everything.

cd "$(dirname "$0")"
PORT=${PORT:-8000}
TUNNEL_METRICS=127.0.0.1:20299
LOG="${TMPDIR:-/tmp}/du-meet-tunnel.log"

if lsof -ti tcp:"$PORT" -sTCP:LISTEN >/dev/null; then
  echo "Port $PORT is already in use: DU Meet is probably running in another terminal."
  echo "Stop it there with Ctrl+C (or close that terminal), then run this again."
  exit 1
fi

cleanup() {
  kill $SERVER $TUNNEL 2>/dev/null
  wait 2>/dev/null
  echo "DU Meet stopped."
}
trap cleanup EXIT
trap 'exit 0' INT TERM

PORT=$PORT python3 server.py &
SERVER=$!
sleep 1

if [ "$1" = "--local" ]; then
  open "http://localhost:$PORT"
  wait $SERVER
  exit
fi

CLOUDFLARED=$(command -v cloudflared || echo "$HOME/cloudflared")
if [ ! -x "$CLOUDFLARED" ]; then
  echo "cloudflared not found. Download it once (see README section 1b), or use ./start.sh --local"
  exit 1
fi

echo "Creating a public link (takes ~10 seconds)…"
"$CLOUDFLARED" tunnel --metrics "$TUNNEL_METRICS" --url "http://localhost:$PORT" >"$LOG" 2>&1 &
TUNNEL=$!

for _ in $(seq 60); do
  HOST=$(curl -s "$TUNNEL_METRICS/quicktunnel" | python3 -c 'import sys, json; print(json.load(sys.stdin).get("hostname", ""))' 2>/dev/null)
  [ -n "$HOST" ] && break
  sleep 1
done
if [ -z "$HOST" ]; then
  echo "Could not create the link. Details: $LOG"
  exit 1
fi

# The link works only after Cloudflare has published it.
for _ in $(seq 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/")" = "200" ] && break
  sleep 1
done

URL="https://$HOST"
echo
echo "========================================================================"
echo "  DU Meet is live:  $URL"
echo "  Open it, start a meeting, then share the meeting link (ⓘ button)."
echo "  Press Ctrl+C here to stop."
echo "========================================================================"
echo
open "$URL"
wait $SERVER
