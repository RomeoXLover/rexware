# ---------------------------------------------------------------------------
# Antecore web server (TanStack Start + Nitro node-server) image.
# Multi-stage: build with Bun, run with Node. Database is PostgreSQL (pg).
#
#   docker build -t antecore/web:latest .
# ---------------------------------------------------------------------------

# ---- Build stage ----------------------------------------------------------
FROM node:22-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun (the project uses bun.lock).
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ---- Runtime stage --------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Bring over the built server + client assets (Nitro bundles its own
# node_modules into .output/server) and the root package.json.
COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# The Discord bot is NOT part of the Nitro build — it runs as its own process
# (the `discord-bot` service in docker-compose) via tsx. Ship its source +
# tsconfig so that container can execute `tsx src/bot/index.ts`.
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

# Nitro node-server entrypoint produced by `vite build`.
CMD ["node", ".output/server/index.mjs"]
