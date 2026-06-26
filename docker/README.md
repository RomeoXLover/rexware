# Antecore Docker System

End-to-end containerized stack for the site, database and the bot script.

## Components

| Piece | Path | Role |
| ----- | ---- | ---- |
| Web server | `Dockerfile` (root) | Site + admin + API + Discord bot. Listens on `127.0.0.1:3000`. Orchestrates bot containers via the Docker socket. |
| Bot runner | `docker/bot/` | Ban-safe, **headless** version of the desktop controller. One container per run. |
| Compose | `docker-compose.yml` | Runs `web` + builds the `bot` image, shared volumes, env. |
| Host nginx | `nginx/skyutils.conf` | Sample server block for the nginx **already on your VPS** to reverse-proxy to the app + terminate TLS. |

## How a run flows (site ↔ DB ↔ Docker)

1. A user configures the plugin in the dashboard and clicks **Run**.
2. `runPlugin` validates the config, writes a `plugin_runs` row (`pending`), then
   calls `startPluginContainer` which creates a container from `antecore/bot:latest`,
   labelled with `antecore.project`, `antecore.run_id`, `antecore.user_id`,
   `antecore.plugin_id`.
3. The container starts the bot (`bot_runner.py`) with the config injected via
   `BOT_CONFIG_JSON`. It POSTs lifecycle status (`starting → running → stopped/error`)
   and heartbeats to `/api/runner/callback`, which updates the `plugin_runs` row.
4. The dashboard console and the **admin → Docker** tab read that live state.
   Admins can start/stop/restart/remove any project container and tail its logs.

If the web server can't reach a Docker engine, runs stay `pending` and the UI
shows a clear "engine offline" notice instead of failing.

## Ban-safety (built into `bot_runner.py`)

- **No captcha solving anywhere.** Challenges are logged and skipped — never sent
  to a third-party solver (the fastest route to a flagged account).
- Human-like jitter on every action, with hard floors (`MIN_INTERVAL_SECONDS`,
  `MIN_DM_DELAY_SECONDS`) that config cannot undercut.
- Randomized startup splay so many containers don't act in lockstep.
- Typing simulation before sending messages/DMs.
- Proper `429` rate-limit back-off honoring `Retry-After`.
- No repeated identical channel messages back-to-back.
- Token rotation with a 10-minute cool-down on fatal close codes.
- Runs as a non-root user with `cap-drop ALL` + `no-new-privileges`, capped
  memory/CPU/PIDs.

## First deploy

This stack runs **behind the nginx already on your VPS** — it does not run its
own nginx and does not manage TLS. The single Ubuntu setup script at the project
root installs Docker if needed, creates `.env`, generates all cryptographic
secrets, builds the images, and starts the app on `127.0.0.1:3000`. It only ever
writes inside this project directory and never touches the host's system nginx.

```bash
cd <project root>
sudo ./setup.sh                    # full setup on a fresh Ubuntu server
# variants:
./setup.sh --yes                   # non-interactive (assume yes)
./setup.sh --no-docker-install     # don't try to apt-install Docker
./setup.sh --no-build              # only prepare .env
./setup.sh nginx                   # print a host-nginx server block to paste
./setup.sh --help
```

What it generates automatically (only when empty): `RUNNER_TOKEN`,
`AUTH_SECRET`, `CRYPTAPI_CALLBACK_SECRET`. Fill in the Discord + payment values
in `.env` afterwards.

### Wiring your host nginx + TLS

The app listens on `127.0.0.1:${APP_PORT:-3000}`. Point your existing nginx at
it with a reverse-proxy server block — a ready one is at `nginx/skyutils.conf`
(or run `./setup.sh nginx` to print it pre-filled), then terminate TLS on the
host with the certbot nginx plugin:

```bash
sudo cp nginx/skyutils.conf /etc/nginx/sites-available/skyutils.xyz
sudo ln -s /etc/nginx/sites-available/skyutils.xyz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d skyutils.xyz -d www.skyutils.xyz
```

Behind Cloudflare's orange cloud, uncomment the `set_real_ip_from` /
`real_ip_header CF-Connecting-IP` lines in the server block so the app sees the
real visitor IP, and use SSL/TLS mode *Full (Strict)*.

### Manual deploy (without the script)

```bash
cd <project root>
cp docker/.env.example .env                  # fill in secrets, set RUNNER_TOKEN
docker compose --profile build-only build    # builds web + the bot image
docker compose up -d                          # starts web on 127.0.0.1:3000
```

## Docker socket access

The site needs the Docker socket (mounted in `docker-compose.yml`) to launch
bot containers. On hosts where the `docker` group gid differs, add to the `web`
service:

```yaml
    group_add:
      - "<docker gid>"   # run: getent group docker | cut -d: -f3
```

## Environment variables (orchestration)

| Var | Default | Meaning |
| --- | ------- | ------- |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Engine socket path. |
| `DOCKER_HOST` | – | Alternative remote engine (tcp://…). |
| `DOCKER_PROJECT_LABEL` | `beam-bot-hub` | Label scoping which containers the panel manages. |
| `BOT_IMAGE` | `antecore/bot:latest` | Image launched per run. |
| `BOT_STATE_VOLUME` | `antecore_bot_state` | Volume mounted at `/app/state` in bot containers. |
| `RUNNER_CALLBACK_URL` | `${APP_BASE_URL}/api/runner/callback` | Where containers report status. |
| `RUNNER_TOKEN` | – | Shared secret validating those callbacks. |
