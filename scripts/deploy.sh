#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# SkyUtils build + deploy helper.
#
# Rebuilds the images and recreates the running containers so code changes
# (web UI, API, AND the per-run bot image used by both Discord plugins) always
# take effect. This exists because the #1 recurring issue is running a STALE
# bot image: `docker compose up` alone will NOT rebuild, so old code keeps
# running and fixes appear to "do nothing".
#
# Usage:
#   ./scripts/deploy.sh            # rebuild everything + restart the stack
#   ./scripts/deploy.sh bot        # rebuild ONLY the per-run bot image
#   ./scripts/deploy.sh web        # rebuild ONLY web + discord-bot
#   ./scripts/deploy.sh --no-cache # force a clean rebuild (no layer cache)
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

# Pick `docker compose` (v2) or legacy `docker-compose`.
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "ERROR: docker compose is not installed." >&2
  exit 1
fi

# Explicit project name so renames of the repo dir don't orphan containers.
export COMPOSE_PROJECT_NAME=beam-bot-hub

NO_CACHE=""
TARGET="all"
for arg in "$@"; do
  case "$arg" in
    --no-cache) NO_CACHE="--no-cache" ;;
    bot|web|all) TARGET="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

build_bot() {
  echo ">> Building per-run bot image (skyutils/bot:latest)…"
  # The bot image lives behind the build-only profile.
  $DC --profile build-only build $NO_CACHE bot
}

build_web() {
  echo ">> Building web image (skyutils/web:latest)…"
  $DC build $NO_CACHE web
}

case "$TARGET" in
  bot)
    build_bot
    echo ">> Bot image rebuilt. New runs will use the updated code immediately."
    ;;
  web)
    build_web
    echo ">> Recreating web + discord-bot…"
    $DC up -d --force-recreate web discord-bot
    ;;
  all)
    build_web
    build_bot
    echo ">> Recreating the full stack…"
    $DC up -d --force-recreate
    ;;
esac

echo ">> Done."
echo "   Tip: running bot containers keep the OLD image until their run ends."
echo "   Stop and start a plugin from the dashboard to pick up bot changes."
