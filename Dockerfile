# syntax=docker/dockerfile:1
# --- stage 1: build the web UI
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build

# --- stage 2: runtime (server + native Stockfish)
FROM node:24-bookworm-slim
# Official Stockfish release; the checksum is the digest GitHub publishes for this asset.
ARG STOCKFISH_URL=https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz
ARG STOCKFISH_SHA256=9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "$STOCKFISH_URL" -o /tmp/sf.tgz \
 && echo "$STOCKFISH_SHA256  /tmp/sf.tgz" | sha256sum -c - \
 && tar xzf /tmp/sf.tgz -C /tmp \
 && cp /tmp/stockfish/stockfish-linux-x86-64-universal /usr/local/bin/stockfish \
 && chmod +x /usr/local/bin/stockfish \
 && rm -rf /tmp/sf.tgz /tmp/stockfish
WORKDIR /app
COPY --from=build /app /app
COPY data/openings /app/openings
COPY data/counters.json /app/data/counters.json
ENV NODE_ENV=production DATA_DIR=/data OPENINGS_DIR=/app/openings STOCKFISH_PATH=/usr/local/bin/stockfish PORT=3000
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "apps/server/src/main.ts"]
