# محسن تيوب على Hugging Face Spaces (Docker، مجاني: 2 أنوية و16 جيجا رام).
# البناء بيحصل على سيرفرات Hugging Face نفسها كل ما الكود يتحدّث (.github/workflows/deploy-hf.yml).
FROM node:22-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    MOHSEN_LIVE_FRESH=on \
    NODE_ENV=production \
    PORT=7860 \
    HOSTNAME=0.0.0.0
# (the deploy workflow writes the Space's real address here)
ENV NEXT_PUBLIC_SITE_URL=__SITE_URL__

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
# Open the catalog, add the videos that came in since the last full rebuild, then build
RUN gunzip -c data/mohsen.db.gz > data/mohsen.db && rm data/mohsen.db.gz \
 && node --experimental-strip-types scripts/import-channels.ts data/fresh.jsonl \
 && npx next build \
 && chown -R node:node /app

# Hugging Face runs the container as user 1000 (= "node"); the database file must be writable (rooms, labels)
USER node
EXPOSE 7860
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "7860", "-H", "0.0.0.0"]
