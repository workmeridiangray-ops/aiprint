# Incident runbook

Severity guide (assumption, confirm with client): S1 = data exposure or money wrong; S2 = jobs not processing; S3 = degraded or single-tenant issue.

1. Contain: there is no suspend-tenant or revoke-all-sessions screen yet. Available today: reset a user's MFA (ends their sign-in proof), close an account (access stops at once), and a direct database change by an engineer, recorded in the incident notes. Treat the missing tools as a gap to raise with the client.
2. Assess with `/admin` (jobs, storage, Redis, scheduler runs) and the audit log tables. Cross-tenant access should return not-found; any case where it does not is an S1.
3. Preserve: place retention holds on affected outputs before purge dates.
4. Communicate using the support tickets and the outbox email templates; no status page exists.
5. Review: write what happened, cause, fix, and add a test.

## Backup and restore
- Backup: `npm run backup -- <new empty directory>` with the live DATABASE_URL and STORAGE_* environment. It runs pg_dump first, then copies every live stored file (any storage driver), and writes MANIFEST.json (checksums, record counts, migration list). Exit code 3 means some files were missing or corrupt at backup time: investigate before trusting that backup.
- The backup directory holds customer artwork and personal data and is NOT encrypted by the script: store it only on encrypted media, with access limited to named people.
- Restore: create an EMPTY database, set DATABASE_URL and STORAGE_* to the target, run `npm run restore -- <backup directory>`. It refuses a non-empty database, checks the dump and every file against the manifest, restores, signs every user out (use `--keep-sessions` only if you know why), then reconciles record counts, ledger totals and every stored file checksum. Exit 3 lists the problems; do not reopen with any problems unexplained.
- After restore: run migrations (`npm run migrate`) if the code is newer than the backup; start workers (the reaper requeues jobs that were running); the outbox may re-send emails that were already sent after the backup (at-least-once delivery); anything that happened after the backup time (uploads, jobs, support tickets) is lost: tell affected customers through support.
- A payment provider does not exist yet, so there are no external payment events to replay or reconcile. When one is added, restore must reconcile provider events since the backup before reopening (not built).
- Proven: a local drill (tests/restore.test.ts: real job and ledger data, backup, restore into an empty database and empty storage, same checksums, original password signs in, download returns the same bytes; corrupt dump, corrupt file, non-empty target and missing file all detected). NOT proven: the drill on the real hosting, on S3 storage, at production data size, timing against any recovery target, scheduled automatic backups, off-site copies, or point-in-time recovery.

Not built: exceptional-access flow, incident reopening workflow, scheduled backups.
