# ---------------------------------------------------------------------------
# Antecore headless bot runner image.
# Built once and reused for every plugin run. The website launches one
# container per run from this image, injecting the per-run config via env.
#
#   docker build -t antecore/bot:latest docker/bot
# ---------------------------------------------------------------------------
FROM python:3.11-slim

# Keep Python lean and unbuffered so logs stream out immediately to `docker logs`.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application code.
COPY bot_runner.py ./

# Run as a non-root user — defence in depth, the bot never needs root.
RUN useradd --create-home --uid 10001 antecore \
    && mkdir -p /app/state /app/config \
    && chown -R antecore:antecore /app
USER antecore

# Persisted per-run state (already-replied users) lives here; the site mounts
# a named volume so it survives container restarts.
VOLUME ["/app/state"]

# No ports are exposed: the bot is an outbound-only Discord client.
ENTRYPOINT ["python", "-u", "bot_runner.py"]
