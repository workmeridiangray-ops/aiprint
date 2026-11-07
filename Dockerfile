# One image for the web app and the three background processes; Render chooses the command per service.
FROM node:22-bookworm-slim
WORKDIR /app
# postgresql-client provides pg_dump / pg_restore for `npm run backup` and `npm run restore`.
# python3 + OpenCV (dnn_superres) run the image-enhancement step; fonts-dejavu-core draws the preview watermark text.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates python3 python3-pip fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages opencv-contrib-python-headless==4.10.0.84 numpy
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Fail the image build if the enhancement library or the watermark does not work.
RUN python3 -c "import cv2; cv2.dnn_superres.DnnSuperResImpl_create()" && npx tsx scripts/check-runtime.ts
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
