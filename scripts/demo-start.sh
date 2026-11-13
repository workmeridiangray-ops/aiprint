#!/bin/sh
# DEMO ONLY: one container runs the web app, worker, scheduler and mailer. Sandbox payments, dev seed accounts.
set -e
export APP_URL="${APP_URL:-$RENDER_EXTERNAL_URL}"
npm run migrate
npm run seed:dev
for p in worker scheduler mailer; do ( while true; do npm run "$p"; sleep 5; done ) & done
exec npm run start -- -p "${PORT:-3000}"
