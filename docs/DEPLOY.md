# Deploying: Render + Supabase + Cloudflare

Status: **prepared, not deployed, not tested on any of the three services.** The pieces below were checked locally only: the Docker build instructions and Blueprint were not run because there is no Docker or Render account in the build environment. Expect small fixes on first deploy.

## Why this split
| Part | Where | Reason |
|---|---|---|
| Web app, worker, scheduler, mailer | **Render** (Docker) | They are long-running Node processes; the image processing library (sharp) is a native module and the job worker loops forever. Cloudflare Workers cannot run either. |
| Database | **Supabase Postgres** | The app needs real PostgreSQL (row locking, advisory locks, triggers). |
| File storage | **Cloudflare R2** | S3-compatible; the app's S3 driver works with it. Free egress. |
| DNS, TLS, caching of static assets | **Cloudflare** | Point your domain at the Render web service. |
| Redis | Not needed | Optional wake-up signals only; workers poll every 5 seconds without it. |

Cloudflare Workers/Pages for the whole app is not recommended: it would mean rewriting the image and PDF export and the job worker. Cloudflare Containers is a possible later alternative; it is not verified here.

## One-time setup
1. **Supabase**: create a project. Use the *direct* connection string (port 5432) or the session pooler, not the transaction pooler (port 6543): the app takes advisory locks and runs multi-statement transactions. Keep `DATABASE_SSL=require`. If Node refuses the certificate, paste Supabase's CA certificate (Project Settings, Database) into `DATABASE_SSL_CA`; `DATABASE_SSL=no-verify` encrypts without checking the certificate and is a last resort. Use the same URL with `?sslmode=require` for `pg_dump` backups.
2. **Cloudflare R2**: create a bucket (private, no public access). Create an API token with Object Read & Write for that bucket only. Note the account endpoint `https://<account-id>.r2.cloudflarestorage.com`. Set `S3_ENDPOINT` to it, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=true`, and the token's key id and secret. Leave `S3_SSE` empty. Then run `npm run check:storage` with these variables (locally or in a Render shell) before going live: it writes, reads back and deletes a probe object.
3. **Secrets**: generate with `openssl rand -base64 32`: `MFA_ENC_KEY`, `DOWNLOAD_LINK_SECRET`, `AUTH_HASH_SALT`. Keep them in a password manager. Losing `MFA_ENC_KEY` forces every enrolled user to be reset by an owner.
4. **Email**: provider SMTP host, port, user, password, and `EMAIL_FROM` on a domain with SPF and DKIM set up. Until then the app sends nothing and says so on the admin page.
5. **Render**: New, Blueprint, pick this repository; Render reads `render.yaml`, creates four services and asks for each `sync: false` value. The web service's pre-deploy step runs `npm run migrate`. Keep the scheduler at exactly one instance.
6. **Domain**: add the domain to the Render web service, then a CNAME in Cloudflare DNS. Set `APP_URL` to `https://your-domain` (it is used in email links).
7. **First owner**: there is no public way to create a platform owner. Create the first one from a Render shell with a one-off script (see "First platform owner" below), with `npm run create-owner` (below), then sign in and enrol two-step sign-in (required for owners).

## First platform owner
In a Render shell on the web service: `OWNER_EMAIL=you@example.com OWNER_PASSWORD='a long passphrase' npm run create-owner`. It reads both from the environment (not arguments), refuses if an owner already exists, and records the event in the audit log. Sign in and enrol two-step sign-in when asked. Do not use `tests/e2e/mkplatform.mts`: it creates dev accounts with a known password.

## Checks after the first deploy
- `GET /api/health` returns `{"ok":true}`.
- Admin page (as owner): storage shows s3, jobs 0 waiting, scheduler runs appear within an hour, email not flagged.
- Upload a test image, run a job end to end, download the file (via the signed link), then delete it.
- `npm run backup -- <dir>` from a shell, and keep that backup somewhere encrypted.

## Not covered here
Payment provider, malware scanning, alerting, scheduled backups, a staging environment, and load testing. See `REMAINING_EXTERNAL.md`.
