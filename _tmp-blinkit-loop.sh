#!/bin/bash
# Scrape a slice of every Blinkit category, then turn the backlog into reports.
# Survives internet drops: when the network is down it waits 5 minutes and
# tries again (up to 288 times in a row -- a full 24h -- instead of giving
# up quickly) so an overnight outage or the laptop sleeping doesn't need a
# human to notice and restart it. Stops for real only when the network is
# fine but nothing new is being scraped/generated (e.g. Gemini quota used
# up), or after that full 24h with no network at all.
cd "$(dirname "$0")"

SUPABASE_URL=$(grep -E '^VITE_SUPABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"\r ')

# The scraper shells out to curl. Git Bash's own curl (7.83, OpenSSL) gets a
# 403 from Blinkit's Cloudflare even with fresh cookies, while Windows' own
# curl (System32, Schannel) passes -- so node runs with System32 first.
NODE_PATH_FIRST="/c/Windows/System32:$PATH"
NET_RETRY_WAIT=300
NET_MAX_RETRIES=288

net_ok() { curl -s -m 15 -o /dev/null "$SUPABASE_URL/rest/v1/" ; }

# Blocks until the internet (Supabase) is reachable; returns 1 after too many tries.
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

TOTAL_SCRAPED=0; TOTAL_REPORTS=0; ROUND=0
while true; do
  wait_for_net || break
  ROUND=$((ROUND+1))
  echo "########## ROUND $ROUND -- scraping Blinkit ##########"
  # A round is normally well under an hour. After the laptop sleeps, a request
  # can hang on a dead connection for ever (seen: 4h stuck, no CPU) -- so a
  # round gets at most 90m. Each category is saved as it finishes, so a
  # killed round loses at most the category it was in.
  OUT=$(PATH="$NODE_PATH_FIRST" /usr/bin/timeout 90m node --env-file=.env scripts/scrape-blinkit.js --all --no-ai --image-fallback 2>&1)
  [ $? -eq 124 ] && echo "$(date '+%H:%M:%S') scrape round stopped after 90m (stuck -- laptop slept?); the next round resumes where it got to"
  echo "$OUT" | tail -8
  N=$(echo "$OUT" | grep -oE "Saved [0-9]+ products" | grep -oE "[0-9]+" | head -1); N=${N:-0}
  # A scrape that failed only because the network dropped mid-round is not "nothing new".
  if [ "$N" -eq 0 ] && ! net_ok; then
    echo "network dropped during the scrape -- retrying the round"
    ROUND=$((ROUND-1)); continue
  fi
  TOTAL_SCRAPED=$((TOTAL_SCRAPED+N))
  echo "ROUND $ROUND: scraped $N new products (total $TOTAL_SCRAPED)"

  STOP=0
  for PASS in 1 2 3; do
    wait_for_net || { STOP=1; break; }
    GEN_OUT=$(PATH="$NODE_PATH_FIRST" /usr/bin/timeout 30m node --env-file=.env scripts/generate-reports.js 2>&1)
    echo "$GEN_OUT" | tail -4
    G=$(echo "$GEN_OUT" | grep -oE "Generated [0-9]+" | grep -oE "[0-9]+" | tail -1); G=${G:-0}
    if echo "$GEN_OUT" | grep -q "fetch failed" && [ "$G" -eq 0 ]; then
      echo "  reports pass $PASS: network hiccup -- retrying"
      sleep 60; continue
    fi
    TOTAL_REPORTS=$((TOTAL_REPORTS+G))
    echo "  reports pass $PASS: +$G (total $TOTAL_REPORTS)"
    [ "$G" -eq 0 ] && { STOP=1; break; }
  done
  [ "$STOP" -eq 1 ] && { echo "STOPPED: no more reports being generated (Gemini quota?) or network gone"; break; }
  [ "$N" -eq 0 ] && { echo "STOPPED: nothing new scraped"; break; }
done
echo "Total scraped: $TOTAL_SCRAPED, reports: $TOTAL_REPORTS"
echo "LOOP DONE"
