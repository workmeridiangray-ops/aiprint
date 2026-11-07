# Artwork SaaS

Next.js 15 + TypeScript + PostgreSQL. Spec: MG-ARTWORK-2026-1107-R3. Read `IMPLEMENTATION_STATUS.md` and `REQUIREMENTS_MATRIX.md` first for what is and is not built; `REMAINING_EXTERNAL.md` for what is waiting on others.

## Local setup
```
service postgresql start        # or any Postgres 16
cp .env.example .env            # defaults work for local dev
npm ci
npm run migrate
npm run seed:dev                # explicit dev-only sample data
npm run dev                     # web
npm run worker                  # jobs (separate terminal)
npm run scheduler; npm run mailer   # optional locally
```
Local S3-protocol server: `npm run dev:s3` then set `STORAGE_DRIVER=s3` (see `.env.example`). Redis optional (`REDIS_URL`).

## Checks
`npm run typecheck`, `npm test` (real Postgres, local SMTP/S3/Redis servers; needs `TEST_DATABASE_URL`), `npm run build`.
Regenerate docs: `npx tsx scripts/docs/gen.ts` (routes, data model, dependencies) and `npx tsx scripts/docs/acceptance.ts` (output acceptance).
Browser flows in `tests/e2e/` are manual scripts, not part of `npm test`.

## Backup and restore
`npm run backup -- <dir>` and `npm run restore -- <dir>`; procedure and limits in `docs/runbooks/incident.md`.

## Staging / production
See `docs/runbooks/operator.md`. Staging and production fail closed: no local storage, no mail without a driver, no payment success without a provider.

## Documentation
- `docs/flowcharts/` 14 diagrams with built / NOT BUILT marked
- `docs/runbooks/` operator, finance, support, retention, incident
- `docs/ROUTES.md`, `docs/DATA_MODEL.md`, `docs/DEPENDENCIES.md`, `docs/OUTPUT_ACCEPTANCE.md` (generated)
