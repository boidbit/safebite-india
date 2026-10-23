#!/bin/bash
# Starts _tmp-blinkit-loop.sh (unless one is already running -- see
# below) and restarts it whenever it exits for ANY reason -- a graceful
# stop (Gemini quota, "nothing new scraped") or a real crash (e.g. a
# transient read of the script file mid-edit) -- for a fixed window.
#
# A real bug this fixes: an earlier version always started a fresh loop
# on launch with no check, so running this script again while a
# previous supervisor's loop was STILL genuinely active (e.g. "keep
# running" issued again before the old window expired) spawned a
# second, concurrent loop racing the first one on the same category
# progress cursors. A PID file (not a process-list text search -- see
# the second bug below) makes "is one already running" a real check.
#
# The other bug this avoids: a WMI/tasklist text search for THIS
# script's own filename matches the CHECKING command's own process too
# (its command line literally contains that filename), so it never
# reads as "gone" -- confirmed live. A PID file has no such
# self-matching problem.
cd "$(dirname "$0")"

RUN_MINUTES=${1:-150}
DEADLINE=$(( $(date +%s) + RUN_MINUTES * 60 ))
LOG=_tmp-loop-output-14.log
PIDFILE=_tmp-blinkit-loop.pid
touch "$LOG"

loop_already_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null
}

# A loop that stops within 10 minutes stopped for a reason that won't fix
# itself in a minute (Blinkit blocking, Gemini quota, network) -- wait 30
# minutes before retrying instead of hitting the site every minute, which
# is the kind of pattern that got us blocked before.
QUICK_EXIT_SECS=600
BACKOFF_SECS=1800

start_loop() {
  LOOP_STARTED=$(date +%s)
  bash _tmp-blinkit-loop.sh >> "$LOG" 2>&1 &
  LOOP_PID=$!
  echo "$LOOP_PID" > "$PIDFILE"
  echo "$(date '+%H:%M:%S') supervisor: (re)started loop, pid $LOOP_PID" >> "$LOG"
}

echo "$(date '+%H:%M:%S') supervisor: watching for ${RUN_MINUTES}m (until $(date -d @"$DEADLINE" '+%H:%M:%S'))" >> "$LOG"

if loop_already_running; then
  LOOP_PID=$(cat "$PIDFILE")
  LOOP_STARTED=$(date +%s)
  echo "$(date '+%H:%M:%S') supervisor: loop already running (pid $LOOP_PID) -- not starting a second one" >> "$LOG"
else
  start_loop
fi

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  sleep 60
  if ! kill -0 "$LOOP_PID" 2>/dev/null; then
    RAN=$(( $(date +%s) - LOOP_STARTED ))
    if [ "$RAN" -lt "$QUICK_EXIT_SECS" ]; then
      echo "$(date '+%H:%M:%S') supervisor: loop stopped after only ${RAN}s -- waiting $((BACKOFF_SECS / 60))m before retrying" >> "$LOG"
      sleep "$BACKOFF_SECS"
    fi
    if [ "$(date +%s)" -lt "$DEADLINE" ]; then
      echo "$(date '+%H:%M:%S') supervisor: loop process gone -- restarting" >> "$LOG"
      start_loop
    fi
  fi
done

echo "$(date '+%H:%M:%S') supervisor: ${RUN_MINUTES}m window elapsed -- no longer auto-restarting (whatever's running now will finish on its own)" >> "$LOG"
