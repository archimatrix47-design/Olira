#!/bin/sh
# F12: back up the live, admin-managed content that exists ONLY on the server.
#
# DATA_DIR (products, certs, contacts, branding, social, analytics) and
# UPLOADS_DIR (logos, product images) live outside git on purpose, so nothing
# else holds a copy. A single bad write or accidental delete is otherwise
# unrecoverable. This tars both into a dated archive and prunes old ones.
#
# Install as a daily cron job (cPanel > Cron Jobs), e.g. 03:15 every day:
#   15 3 * * *  /home/oliraagr/olira/scripts/backup-data.sh >> /home/oliraagr/olira-backups/backup.log 2>&1
#
# Override the defaults with env vars if your paths differ.

set -eu

DATA_DIR="${DATA_DIR:-$HOME/olira-data}"
UPLOADS_DIR="${UPLOADS_DIR:-$HOME/olira-uploads}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/olira-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

stamp="$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

archive="$BACKUP_DIR/olira-backup-$stamp.tar.gz"

# Build a list of paths that actually exist, so a missing dir doesn't abort.
set --
[ -d "$DATA_DIR" ] && set -- "$@" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
[ -d "$UPLOADS_DIR" ] && set -- "$@" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"

if [ "$#" -eq 0 ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: neither DATA_DIR ($DATA_DIR) nor UPLOADS_DIR ($UPLOADS_DIR) exists — nothing to back up." >&2
  exit 1
fi

tar -czf "$archive" "$@"
echo "$(date '+%Y-%m-%d %H:%M:%S') OK: wrote $archive ($(du -h "$archive" | cut -f1))"

# Prune archives older than RETENTION_DAYS.
find "$BACKUP_DIR" -name 'olira-backup-*.tar.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete \
  | while read -r old; do echo "$(date '+%Y-%m-%d %H:%M:%S') pruned $old"; done

# NOTE: this keeps backups on the SAME server. For real safety, periodically copy
# $BACKUP_DIR off-server (rclone to cloud storage, scp to another host, or
# download the newest archive). An on-server backup does not survive an account
# loss — the same lesson as the cPanel full-backup step during launch.
