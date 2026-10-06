#!/bin/sh
# Uptime alert for cPanel > Cron Jobs. Quiet while the site is healthy. When
# /api/health stops answering "ok" it prints one line, and cron mails any output
# to the address under Cron Jobs > Cron Email. One mail when it goes down, one
# when it is back (a marker file remembers), not one every run.
#
#   */10 * * * * /bin/sh /home/oliraagr/olira/scripts/uptime-check.sh
#
# It runs on the same server, so it catches the app failing (the usual case),
# not the whole server going away: pair it with a free outside monitor for that.
set -u
URL="${1:-https://oliraagroindustry.com/api/health}"
STATE="${UPTIME_STATE:-$HOME/.olira-uptime-down}"
now() { date '+%Y-%m-%d %H:%M'; }

body="$(curl -s -m 20 -A 'olira-uptime-check' "$URL" 2>&1)"
code=$?
case "$body" in
  *'"status":"ok"'*)
    if [ -f "$STATE" ]; then
      echo "$(now) Olira is back up ($URL). It was down from $(cat "$STATE")."
      rm -f "$STATE"
    fi
    ;;
  *)
    if [ ! -f "$STATE" ]; then
      now > "$STATE"
      echo "$(now) Olira is DOWN: $URL answered: $(printf '%s' "$body" | head -c 300) (curl exit $code)"
      echo "Check cPanel > Setup Node.js App, or run: sh ~/olira/scripts/restart-app.sh ~/olira"
    fi
    ;;
esac
exit 0
