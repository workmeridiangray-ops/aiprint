# Operator runbook

Processes (all from the same build): `web` (next start), `worker`, `scheduler`, `mailer`. Postgres is required; object storage must be `s3` in staging/production; Redis is optional (wake-ups only).

## Start / deploy
1. Set environment (see `.env.example`). In staging/production the app fails closed rather than falling back: missing MFA_ENC_KEY, local storage, a non-https S3 endpoint, a missing email driver, missing DOWNLOAD_LINK_SECRET, or missing APP_URL each return an explicit error for the affected feature.
2. `npm ci && npm run build`
3. `npm run migrate` (forward-only; take a database backup first).
4. Start web, worker (one or more), scheduler (exactly one), mailer (one or more; rows are leased).
5. `npm run check:storage` must pass. Open `/admin` as platform owner: jobs queued/running/oldest, Redis, storage, last scheduler runs.

- Scheduler task `hold_expiry` (every 5 minutes) cancels jobs that sat queued with no attempt for HOLD_EXPIRY_MINUTES (default 30) and releases their hold. If it fires often, workers are down or too slow: check the worker first.

## Daily checks (from /admin)
- "Jobs needing attention": failed jobs (read last error; customers were not charged), running jobs with an expired lease (the worker's reaper requeues them; if they persist, no worker is running), oldest waiting job.
- Oldest queued job age growing: worker down or stuck. Restart worker; the reaper requeues expired leases and fails a job after 3 attempts, releasing the hold.
- Scheduler "last run" older than expected or errored: run `npm run scheduler` once manually and read the error; tasks are subscription_lifecycle, retention, account_maintenance.
- Mailer: failed or old pending outbox rows (see support runbook for the email checks).
- Redis down: nothing breaks; pickup falls back to a 5 second poll.

## Rollback
Redeploy the previous build. Migrations are forward-only: do not roll the schema back; if a migration is faulty, restore the database backup taken in step 3 (restore is NOT yet proven, see incident runbook) or ship a corrective migration.

## Secrets
MFA_ENC_KEY loss makes enrolled authenticator secrets unreadable: users must be reset by an owner. Keep it in the secret store, never in the repo. Rotating it is NOT built.

## Not built (do not promise)
Payment provider integration, malware scanning, backups/restore automation, per-tenant storage quota, secret rotation.
