# One image for the web app and the three background processes; Render chooses the command per service.
FROM node:22-bookworm-slim
WORKDIR /app
# postgresql-client provides pg_dump / pg_restore for `npm run backup` and `npm run restore`.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
