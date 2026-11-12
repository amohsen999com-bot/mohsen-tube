# محسن تيوب على Render (خطة مجانية، Docker). Render بيبني الصورة دي بنفسه مع كل تحديث للكود (render.yaml).
FROM node:22-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    MOHSEN_LIVE_FRESH=on \
    NODE_ENV=production \
    HOSTNAME=0.0.0.0
# The site's address (Render passes it in from render.yaml at build time)
ARG NEXT_PUBLIC_SITE_URL=https://mohsen-tube.onrender.com
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
# Open the catalog, add the videos that came in since the last full rebuild, then build
RUN gunzip -c data/mohsen.db.gz > data/mohsen.db && rm data/mohsen.db.gz \
 && node --experimental-strip-types scripts/import-channels.ts data/fresh.jsonl \
 && npx next build \
 && chown -R node:node /app

# Run as the unprivileged "node" user; it owns /app, so the database stays writable (rooms, labels)
USER node
EXPOSE 10000
# Render tells the app which port to use in $PORT
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p ${PORT:-10000} -H 0.0.0.0"]
