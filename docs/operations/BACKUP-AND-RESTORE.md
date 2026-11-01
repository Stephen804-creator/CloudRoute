# CloudRoute PostgreSQL Backup and Recovery

**Status:** Operational procedure drafted; production recovery is not yet environment-verified.

## Scope

These scripts create encrypted PostgreSQL custom-format backups and restore them into an explicitly selected existing database. They do not provision storage, schedule backups, rotate encryption keys, or upload files off-site.

## Backup

Required tools: PostgreSQL client utilities (pg_dump, pg_restore) and GnuPG.

Required environment:
- DATABASE_URL: source PostgreSQL connection string.
- BACKUP_ENCRYPTION_PASSPHRASE: strong secret obtained from the deployment secret manager.
- Optional BACKUP_DIR: output directory (defaults to ./backups).

Run the backup-postgres.sh script with those variables set. The script uses a custom-format dump, encrypts it with AES-256 via GnuPG, decrypts it into a temporary file, and verifies the archive directory before reporting success. Temporary plaintext files are removed on exit. The backup file is created with restrictive permissions.

## Restore

**Destructive operation:** pg_restore --clean --if-exists can drop existing objects in the target database. Restore only into an isolated, explicitly verified recovery database unless a separately approved production recovery procedure authorizes otherwise.

Required environment:
- RESTORE_DATABASE_URL: target PostgreSQL database.
- BACKUP_ENCRYPTION_PASSPHRASE: matching decryption secret.
- CONFIRM_RESTORE=YES: explicit acknowledgement that the target has been checked.

Run restore-postgres.sh with those variables and the encrypted backup file path. The script decrypts and validates the archive before restoring in a single transaction.

After restoration:
1. Run pnpm db:migrate and confirm migrations are current.
2. Run the complete CI test suite against the restored database.
3. Verify organization membership, RLS boundaries, cloud-account ownership, resource counts, cost records, findings and audit records.
4. Start API and worker in an isolated environment and verify /health and /ready.
5. Record restore start/end time, backup identifier, operator, target, validation results and any data-loss window.

## Production requirements not yet evidenced

Before production acceptance, the operator must:
- Store encrypted backups in a separate, access-restricted off-site location with object versioning/immutability where supported.
- Schedule backups and alert on missing or failed backups.
- Define retention and deletion schedules.
- Store the encryption secret separately from backup files; define rotation and recovery access.
- Perform and record a restore drill from the off-site copy.
- Set approved RPO/RTO targets and measure them during the drill.

A successful local archive check is not proof that an off-site backup can be restored. Do not mark the recovery validation gate accepted until a real restore drill is recorded.
