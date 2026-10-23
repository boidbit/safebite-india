#!/bin/bash
# Report-generation only -- no scraping. Repeatedly runs
# scripts/generate-reports.js (which pulls from BOTH the OFF and
# Blinkit pending backlogs already) until the backlog is empty or
# nothing new gets generated for a few passes in a row (Gemini quota).
# Survives network drops the same way _tmp-blinkit-loop.sh does.
cd "$(dirname "$0")"

SUPABASE_URL=$(grep -E '^VITE_SUPABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"\r ')
NET_RETRY_WAIT=300
NET_MAX_RETRIES=288

net_ok() { curl -s -m 15 -o /dev/null "$SUPABASE_URL/rest/v1/" ; }

wait_for_net() {
  local tries=0
  until net_ok; do
    tries=$((tries+1))
    [ "$tries" -ge "$NET_MAX_RETRIES" ] && { echo "NETWORK DOWN for $((tries*NET_RETRY_WAIT/60)) min -- giving up"; return 1; }
    echo "$(date '+%H:%M:%S') network unreachable -- waiting ${NET_RETRY_WAIT}s (try $tries/$NET_MAX_RETRIES)"
    sleep "$NET_RETRY_WAIT"
  done
  return 0
}

TOTAL=0
PASS=0
while true; do
  wait_for_net || break
  PASS=$((PASS+1))
  OUT=$(node --env-file=.env scripts/generate-reports.js 2>&1)
  echo "$OUT" | tail -6
  G=$(echo "$OUT" | grep -oE "Generated [0-9]+" | grep -oE "[0-9]+" | tail -1); G=${G:-0}
  if echo "$OUT" | grep -q "fetch failed" && [ "$G" -eq 0 ]; then
    echo "pass $PASS: network hiccup -- retrying"
    sleep 60
    continue
  fi
  TOTAL=$((TOTAL+G))
  echo "pass $PASS: +$G (total $TOTAL)"
  if [ "$G" -eq 0 ]; then
    echo "STOPPED: nothing new generated (backlog empty, or Gemini quota) -- total this run: $TOTAL"
    break
  fi
done
echo "REPORT LOOP DONE"
