#!/usr/bin/env bash
# Nightly backup: the database (pg_dump, custom format) and uploaded files (photos, exports).
# Keeps BACKUP_KEEP_DAYS days locally; copies off the server with rclone when BACKUP_RCLONE_TARGET is set.
#   crontab -e  →  15 2 * * * /opt/bos/deploy/backup.sh >> /var/log/bos-backup.log 2>&1
# Restore: see deploy/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
DIR="${BACKUP_DIR:-/var/backups/bos}"; KEEP="${BACKUP_KEEP_DAYS:-14}"
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
TS="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"; umask 077

$C exec -T db pg_dump -U bos -Fc bos > "$DIR/db-$TS.dump"
$C exec -T api tar czf - -C /data storage > "$DIR/storage-$TS.tgz"
# A dump that can't be listed is no backup: check it.
$C exec -T db pg_restore --list < "$DIR/db-$TS.dump" > /dev/null
echo "$(date -u +%FT%TZ) backup ok: $(du -h "$DIR/db-$TS.dump" | cut -f1) database, $(du -h "$DIR/storage-$TS.tgz" | cut -f1) files"

if [ -n "${BACKUP_RCLONE_TARGET:-}" ]; then
  rclone copy "$DIR/db-$TS.dump" "$BACKUP_RCLONE_TARGET/"
  rclone copy "$DIR/storage-$TS.tgz" "$BACKUP_RCLONE_TARGET/"
  echo "copied off-site to $BACKUP_RCLONE_TARGET"
fi
find "$DIR" -type f \( -name 'db-*.dump' -o -name 'storage-*.tgz' \) -mtime +"$KEEP" -delete
