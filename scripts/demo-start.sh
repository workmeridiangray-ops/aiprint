#!/bin/sh
# DEMO ONLY (Render free plan, 512 MB): web app + one worker in one container. Sandbox payments, dev seed accounts.
# Scheduler and mailer are skipped to save memory: no expiry sweeps, no emails.
set -e
export APP_URL="${APP_URL:-$RENDER_EXTERNAL_URL}"
npm run migrate
npm run seed:dev
( while true; do LOW_MEMORY=1 VIPS_CONCURRENCY=1 MALLOC_ARENA_MAX=2 NODE_OPTIONS=--max-old-space-size=200 npm run worker; sleep 5; done ) &
MALLOC_ARENA_MAX=2 NODE_OPTIONS=--max-old-space-size=200 exec npm run start -- -p "${PORT:-3000}"
