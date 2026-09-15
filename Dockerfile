# One image for any container host (Railway, Fly.io, Render, a VPS).
# The database lives on a volume mounted at /data — never inside the image.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production dependencies only, installed clean rather than pruned.
FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    BANTAI_DATA_DIR=/data \
    PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig.json ./
RUN mkdir -p /data && chown -R node:node /data /app/.next
USER node
EXPOSE 3000
# No VOLUME instruction: Railway's builder refuses it outright ("use Railway
# Volumes" — attach one at /data through the dashboard or railway.json
# instead). The directory above already exists and is writable either way;
# on hosts that do read a Dockerfile VOLUME, a `docker run -v`/named-volume
# mount lands on /data without needing the declaration too.
# next directly, not `npm start`, so SIGTERM from the host reaches the server.
CMD ["node_modules/.bin/next", "start"]
