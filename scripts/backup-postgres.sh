#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL database to back up}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?Set BACKUP_ENCRYPTION_PASSPHRASE; unencrypted backups are not supported}"

command -v pg_dump >/dev/null || { echo "pg_dump is required" >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "pg_restore is required" >&2; exit 1; }
command -v gpg >/dev/null || { echo "gpg is required" >&2; exit 1; }

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%S%NZ)"
output="$backup_dir/cloudroute-$timestamp.dump.gpg"
dump_file="$(mktemp)"
verify_file="$(mktemp)"
completed=false
cleanup() {
  rm -f "$dump_file" "$verify_file"
  if [[ "$completed" != "true" ]]; then rm -f "$output"; fi
}
trap cleanup EXIT

pg_dump --no-password --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" --file="$dump_file"
printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" |
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --symmetric --cipher-algo AES256 --output "$output" "$dump_file"

printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" |
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --decrypt --output "$verify_file" "$output"
pg_restore --list "$verify_file" >/dev/null
chmod 600 "$output"
completed=true

echo "Encrypted backup created and archive-verified: $output"
