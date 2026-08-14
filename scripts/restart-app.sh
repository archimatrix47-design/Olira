#!/bin/sh
# Reliable restart for the CloudLinux/LiteSpeed Node app.
#
# On this host, none of the "normal" restarts actually cycle the running process:
# cPanel Restart, Stop/Start, `cloudlinux-selector restart`, and touching
# tmp/restart.txt all report success while a worker keeps running old code/env
# (we found one with 20+ days uptime that ignored every restart — that caused a
# multi-hour outage and a password that would never update).
#
# The process actually serving requests is a LiteSpeed worker whose command line
# is "lsnode:/home/<user>/<approot>/" (NOT "server.js" — which is why
# `pkill -f server.js` matched nothing). Killing those workers forces LiteSpeed
# to spawn a fresh one that reloads code AND env vars on the next request.
#
# Usage:  sh scripts/restart-app.sh [app-root]     (default: $HOME/olira)
set -eu

APP_ROOT="${1:-$HOME/olira}"
USER_NAME="$(id -un)"

pids="$(ps -u "$USER_NAME" -o pid=,cmd= | grep "lsnode:${APP_ROOT}" | grep -v grep | awk '{print $1}' || true)"

if [ -n "$pids" ]; then
  echo "Killing lsnode worker(s) for ${APP_ROOT}: $pids"
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
else
  echo "No lsnode worker found for ${APP_ROOT} (already stopped)."
fi

# Belt-and-suspenders: refresh the Passenger restart trigger too.
mkdir -p "${APP_ROOT}/tmp" && touch "${APP_ROOT}/tmp/restart.txt"

echo "Done. Load the site once (or: curl -s -o /dev/null https://oliraagroindustry.com/)"
echo "to trigger a fresh spawn, then verify: curl -s https://oliraagroindustry.com/api/health"
