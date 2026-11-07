# IMPLEMENTATION_STATUS

Updated: 2026-11-07. Spec baseline: R3 (MG-ARTWORK-2026-1107-R3), ₹12.5 lakh base. **Not production-ready.** This is the first vertical slice of a much larger build.

## Baseline
- No repository was supplied, so this one was created empty at `artwork-saas/` (local, git, single branch). No prior code, dependencies or tests existed.
- Stack: Next.js 15 (App Router) + TypeScript 5.9, PostgreSQL 16, `sharp` for image inspection, `zod`, `vitest`. Modular monolith under `src/server/`.
- Decisions: scrypt password hashing; opaque session tokens stored hashed; tenant context resolved from an unrevoked membership, never trusted from the client; ledgers are integer paise, append-only (DB trigger), idempotent by key.
- The separate physical-printing Framer project was never accessed. The 75-surface Framer design for this product lives in a different (Framer) project and was not used as a source here.

## Implemented and tested (90 automated tests, real PostgreSQL)
- Sign-in/out, session expiry, revoked membership, duplicate/weak credentials. Origin check on mutating API calls.
- Deny-by-default policy; tenant + owner isolation for projects, files, quotes; not-found instead of forbidden to prevent ID probing.
- Upload inspection: JPG/PNG only, 25 MB, 40 MP, truncated/corrupt rejected, embedded vs untagged profile reported.
- Settings validation: 500 mm per side, 80 MP including bleed.
- Projects with revision-checked, server-confirmed saves; concurrent same-revision saves: one wins.
- Quote (15 min expiry, stale-on-change), atomic reservation of customer credit and vendor processing credit, idempotent reserve, cancel-before-dispatch release, running job keeps hold; 20-way concurrency tests for both ledgers.
- Identity: registration with email verification (login blocked until verified), password reset (1 h, single-use, newer request voids older, ends sessions), staff invites (7 days, single-use, cannot take over an existing account), last-admin protection under concurrency, audit rows for these actions. Emails go to `email_outbox`; **no sender is wired**, so nothing is actually delivered yet.
- Processing: worker with SKIP LOCKED leases, heartbeats, attempt records, expiry reaper (bounded requeue, then fail + release), server export engine (mirror-edge bleed, RGB PNG with dpi metadata, independent output validation incl. dimensions), output + entitlement + credit consumption committed in one transaction gated on lease ownership (zombie workers cannot double-charge), failure releases holds, cancellation-during-run resolved against outcome, owner-only 90-day checksum-verified download with free re-download. Run with `npm run worker` is not wired; use `npx tsx scripts/worker.ts`.
- Editor and formats: shared geometry module (preview and export place the image identically), position/rotation/scale/fit/fill honoured by the real export, effective-dpi warning, exports to PNG, JPG, TIFF (LZW) and single-page PDF with trim and bleed boxes (no PDF/X claim), each independently validated. RGB/sRGB only; CMYK deliberately not offered until a licensed or client-supplied profile exists.
- Browser check (Playwright against real server + worker; `tests/e2e/editor-flow.cjs`, manual run, needs dev DB seeded): login, upload, canvas paints, rotate swaps halves, undo restores, dpi warning, arrow-key nudge autosaves, price, hold, worker output, PDF download; no horizontal overflow at 390 px.
- Vendor side: vendor registration (pending until activated), branding, public portal lookup (branding only, active vendors only), immutable plan versions, subscription state machine (pending/active/grace/expired; 7-day grace; reminders at 7 and 1 day deduplicated per period; renewal extends from period end or restarts after expiry; scheduled plan change at next renewal, no proration), staff seats enforced at invite and acceptance, role changes with last-admin protection, configured prices (vendor retail + platform processing; **no hidden defaults**; direct channel has no vendor charge), counter workflow (customer record, external payment record with receipt number, admin override with reason, vendor-credit-only reservation, no ledger entry for cash), vendor overview. Expired vendors cannot start paid work but can still download.
- `activateSubscription` has no HTTP route on purpose: only a verified provider payment event may call it. Nothing in the app can mark a subscription paid today.
- Public website: 12 pages (home, software, services, how it works, plans, pricing, FAQ, contact, terms, privacy, refund, acceptable use) under `src/app/(public)`, one h1 and a unique title each, sitemap.xml and robots.txt, skip link, mobile-checked (no horizontal overflow at 390 px). Content comes from real records (plans, direct-store price) or an honest empty state. **Legal pages never contain application-written text**: they show "not published yet" until the platform owner publishes approver-supplied versions (immutable, versioned). Enquiry form: field errors, consent record, honeypot, per-source/per-email limits (concurrency-safe), reference number, staff queue API with close-needs-note. Store landing pages (`/store/[slug]`) and customer registration resolve the store from the slug server-side. Vendor signup records the chosen plan, applied at first activation.
- UI: /vendor (overview, prices, branding, staff), /counter (4-step flow), login, forgot/reset/verify pages, project list, editor (numeric settings, upload, autosave status, conflict banner, quote, reserve).
- Explicit dev seed (`npm run seed:dev`) refuses staging/production.

## Verified by running
- `npm test` → 2 files, 29 tests pass. `npm run typecheck` clean. `next build` succeeds.
- Live HTTP smoke against `next start`: no cookie 401, bad origin 403, wrong password 401, login → create project → upload → save → stale save conflict → quote → reserve all returned expected results. The browser UI was **not** driven in a real browser yet.

## Not built (see REQUIREMENTS_MATRIX.md for per-ID status)
Public website (SC-001–012), registration/verification/reset/MFA/invites, vendor onboarding/branding/subscriptions/staff/pricing/counter flows, business workspaces and member limits, canvas editor and transforms, export engine and worker, queue/outbox/leases, payments, refunds, settlements, reconciliation, tickets, retention/closure/backup, audit search UI, admin screens, notifications, flowcharts (14), runbooks, S3 storage driver, Redis queue, malware scanning, accessibility and mobile verification, load test.

## Genuine blockers (external)
- Payment provider not selected/credentialed; no collection, top-up, refund or settlement can be built to a live standard. Production must fail closed (nothing simulates success).
- CMYK/RGB profiles, representative sample files, enhancement adapter choice, approved infrastructure for restore and performance tests.
- Signed optional-module selection sheet.

## Known deviations / caveats
- Pricing is a labelled development placeholder (`PRICING_VERSION = dev-placeholder-v0`), not versioned configuration.
- Storage is local disk (refused when `APP_ENV=production`).
- R3 PDF and markdown not diffed in this pass. DEV/PM/FE/BE groups and Annexes C–K not yet mapped.

## Next steps (in order)
0. Staff screens for the enquiry queue and platform admin (plans, processing prices, policies, direct store are API-only); email sender; client review of public copy; approved policy text; vendor onboarding page and pre-activation access to branding/pricing; printable counter receipt; platform admin UI for plans and processing prices; claim walk-in project (SC-030, not started); vendor processing-credit top-up (blocked on provider).
1. Email sender adapter (fails closed in production), register/invite pages, MFA + recovery, login rate limiting.
2. Audit log writes on the remaining state changes (projects, quotes, reservations).
3. Drag-to-move/crop handles, back-side image, wire browser tests into `npm test`, transactional outbox for dispatch events, JPG/TIFF/PDF export, canvas editor with transforms, ICC/CMYK profile handling, enhancement adapter, needs_review path for paid upstream adapters. Redis queue is NOT used: Postgres SKIP LOCKED is the queue for now (deviation, to revisit at scale).
4. Versioned pricing and plans; vendor credit top-up UI once provider is chosen.
5. Real-browser tests; Mermaid diagrams; runbooks.

## Commands
`cp .env.example .env`; create DBs per `.env.example`; `npm run migrate`; `npm run seed:dev`; `npm run dev`; `npm run worker` and `npm run scheduler` in separate processes; `npm test` (uses `TEST_DATABASE_URL`, drops and recreates its schema).
