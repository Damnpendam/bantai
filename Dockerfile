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
# gosu: lets the entrypoint start as root (to fix /data's ownership, which a
# freshly attached volume often has regardless of what built the image) and
# then drop to the unprivileged `node` user before the app itself runs.
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /data && chown -R node:node /data /app/.next \
    && chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
# No VOLUME instruction: Railway's builder refuses it outright ("use Railway
# Volumes" — attach one at /data through the dashboard or railway.json
# instead). A `docker run -v`/named-volume mount on another host still lands
# on /data without one.
ENTRYPOINT ["docker-entrypoint.sh"]
# next directly, not `npm start`, so SIGTERM from the host reaches the server
# (gosu execs it in place, so it stays PID 1 and still receives the signal).
CMD ["node_modules/.bin/next", "start"]
