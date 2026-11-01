#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to the existing restore target database}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?Set BACKUP_ENCRYPTION_PASSPHRASE}"
: "${CONFIRM_RESTORE:?Set CONFIRM_RESTORE=YES only after verifying the target database}"

if [[ "$CONFIRM_RESTORE" != "YES" ]]; then
  echo "Restore refused. Set CONFIRM_RESTORE=YES after verifying the target." >&2
  exit 1
fi
if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: $0 path/to/cloudroute-backup.dump.gpg" >&2
  exit 1
fi

command -v pg_restore >/dev/null || { echo "pg_restore is required" >&2; exit 1; }
command -v gpg >/dev/null || { echo "gpg is required" >&2; exit 1; }

archive_file="$(mktemp)"
cleanup() { rm -f "$archive_file"; }
trap cleanup EXIT

printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" |
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --decrypt --output "$archive_file" "$1"
pg_restore --list "$archive_file" >/dev/null

echo "Restoring into the explicitly configured target database. Existing objects may be dropped."
pg_restore --no-password --exit-on-error --single-transaction --clean --if-exists \
  --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" "$archive_file"
echo "Restore completed. Run application health checks and tenant-integrity checks before use."
