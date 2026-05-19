FROM node:alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src
# Generate Prisma client, then compile TypeScript
RUN npx prisma generate && npm run build

FROM node:slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Install Python, pip, ffmpeg (required for Whisper audio transcription)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg && \
    pip3 install --no-cache-dir --break-system-packages faster-whisper && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
# Include Prisma schema, config and migrations for runtime migration
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
RUN mkdir -p /app/logs

# Run migrations then start the server
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/index.js"]
