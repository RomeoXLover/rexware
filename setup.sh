#!/usr/bin/env bash
# ===========================================================================
# SkyUtils / skyutils.xyz — one-shot setup for Ubuntu
# ===========================================================================
# Provisions the app stack on a fresh Ubuntu server. This stack runs BEHIND the
# nginx already installed on the VPS: it does NOT run its own nginx and does NOT
# manage TLS. The app container listens on 127.0.0.1:${APP_PORT:-3000}; your
# host nginx reverse-proxies to it and terminates HTTPS via certbot.
# Everything this script creates stays INSIDE this project directory.
#
# What it does (all steps are idempotent and safe to re-run):
#   1. (optional) Installs Docker Engine + Compose plugin via Ubuntu's apt repo.
#   2. Creates .env from docker/.env.example and auto-generates the secrets
#      (RUNNER_TOKEN, AUTH_SECRET, CRYPTAPI_CALLBACK_SECRET). Never overwrites
#      values you already set.
#   3. Builds the images (web, bot) and starts the app on 127.0.0.1:3000.
#
# Usage:
#   sudo ./setup.sh                 # full setup
#   sudo ./setup.sh --yes           # full setup, assume "yes" to all prompts
#   ./setup.sh --no-docker-install  # don't try to install Docker
#   ./setup.sh --no-build           # only prepare .env
#   ./setup.sh rebuild              # rebuild images + recreate web & discord-bot
#                                   # (use after `git pull`; DB is preserved).
#   sudo ./setup.sh nginx           # install the server block into the host
#                                   # nginx (sites-available) + test + reload.
#   sudo ./setup.sh certbot         # install certbot + request SSL cert for
#                                   # skyutils.xyz (or re-run after nginx install).
#   ./setup.sh --help
#
# Config is read from .env (or the environment):
#   DOMAIN     default: skyutils.xyz
#   APP_PORT   loopback port the app is exposed on (default 3000)
#   SSL_CERT   default: /etc/letsencrypt/live/$DOMAIN/fullchain.pem
#   SSL_KEY    default: /etc/letsencrypt/live/$DOMAIN/privkey.pem
# ===========================================================================

# Re-exec under bash if started with sh/dash — this script uses bash features.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi

# Auto-re-exec with sudo for subcommands that need root (full setup, certbot, nginx).
# Passes through without sudo for: rebuild, --help, --no-docker-install, --no-build.
if [ "$(id -u)" -ne 0 ]; then
  case "${1:-}" in
    --help|rebuild|--no-docker-install|--no-build) ;;
    *) exec sudo bash "$0" "$@" ;;
  esac
fi

set -euo pipefail

# --- paths (resolved regardless of CWD) ------------------------------------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
ENV_EXAMPLE="${PROJECT_ROOT}/docker/.env.example"
NGINX_SAMPLE="${PROJECT_ROOT}/nginx/minefleet.conf"

# --- defaults --------------------------------------------------------------
DO_DOCKER_INSTALL=1
DO_BUILD=1
ASSUME_YES=0
SUBCOMMAND="setup"

# --- pretty logging --------------------------------------------------------
if [ -t 1 ]; then
  C_RESET="\033[0m"; C_BLUE="\033[34m"; C_GREEN="\033[32m"
  C_YELLOW="\033[33m"; C_RED="\033[31m"; C_BOLD="\033[1m"
else
  C_RESET=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BOLD=""
fi
info() { printf "${C_BLUE}==>${C_RESET} %s\n" "$*"; }
ok()   { printf "${C_GREEN}  ok${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}  ! ${C_RESET}%s\n" "$*"; }
err()  { printf "${C_RED}  x %s${C_RESET}\n" "$*" >&2; }
die()  { err "$*"; exit 1; }
hr()   { printf "${C_BOLD}%s${C_RESET}\n" "------------------------------------------------------------"; }

# ===========================================================================
# helpers
# ===========================================================================

# sudo wrapper — uses sudo only when not already root.
SUDO=""
need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || die "This step needs root. Re-run with sudo."
    SUDO="sudo"
  fi
}

gen_secret() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "${bytes}"
  else
    head -c "${bytes}" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# docker compose (v2) or docker-compose (v1) — whichever exists.
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "Neither 'docker compose' nor 'docker-compose' is available."
  fi
}

# Read a single value from .env (no sourcing → safe with quotes/specials).
env_get() {
  local key="$1"
  [ -f "${ENV_FILE}" ] || return 0
  sed -n "s/^${key}=//p" "${ENV_FILE}" | head -n1
}

# Set KEY=value in .env only when missing/empty (force=1 to overwrite).
env_set_if_empty() {
  local key="$1" value="$2" force="${3:-0}" current
  current="$(env_get "${key}")"
  if [ -n "${current}" ] && [ "${force}" != "1" ]; then return 0; fi
  if grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    local esc="${value//|/\\|}"
    sed -i.bak "s|^${key}=.*|${key}=${esc}|" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

confirm() {
  local prompt="$1" reply
  [ "${ASSUME_YES}" -eq 1 ] && return 0
  read -r -p "$(printf "${C_BOLD}%s [y/N] ${C_RESET}" "${prompt}")" reply || reply="n"
  case "${reply}" in [yY]*) return 0 ;; *) return 1 ;; esac
}

# ===========================================================================
# argument parsing
# ===========================================================================
for arg in "$@"; do
  case "${arg}" in
    setup|nginx|certbot|rebuild) SUBCOMMAND="${arg}" ;;
    --no-docker-install) DO_DOCKER_INSTALL=0 ;;
    --no-build)          DO_BUILD=0 ;;
    -y|--yes)            ASSUME_YES=1 ;;
    -h|--help)           sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown argument: ${arg} (try --help)" ;;
  esac
done

cd "${PROJECT_ROOT}"

# ===========================================================================
# step 1 — Docker on Ubuntu
# ===========================================================================
install_docker_ubuntu() {
  if docker info >/dev/null 2>&1; then
    ok "Docker is already installed and running"
    return 0
  fi
  if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
    warn "Docker is installed but the daemon isn't reachable."
    need_root; ${SUDO} systemctl enable --now docker 2>/dev/null || true
    docker info >/dev/null 2>&1 && { ok "Docker daemon started"; return 0; }
  fi

  if [ "${DO_DOCKER_INSTALL}" -ne 1 ]; then
    die "Docker is not available and --no-docker-install was given."
  fi
  if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
    die "Automatic install only supports Ubuntu. Install Docker manually, then re-run with --no-docker-install."
  fi

  info "Installing Docker Engine + Compose plugin (Ubuntu apt repository)"
  need_root
  export DEBIAN_FRONTEND=noninteractive
  ${SUDO} apt-get update -y
  ${SUDO} apt-get install -y ca-certificates curl gnupg
  ${SUDO} install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | ${SUDO} gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    ${SUDO} chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  local codename
  codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-${VERSION_CODENAME}}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" \
    | ${SUDO} tee /etc/apt/sources.list.d/docker.list >/dev/null
  ${SUDO} apt-get update -y
  ${SUDO} apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  ${SUDO} systemctl enable --now docker

  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
    ${SUDO} usermod -aG docker "${SUDO_USER}" || true
    warn "Added ${SUDO_USER} to the 'docker' group — log out/in for it to take effect."
  fi
  docker info >/dev/null 2>&1 || die "Docker installation finished but the daemon is not reachable."
  ok "Docker installed and running"
}

# ===========================================================================
# step 2 — .env + secrets
# ===========================================================================
prepare_env() {
  info "Preparing environment file (.env)"
  if [ ! -f "${ENV_FILE}" ]; then
    [ -f "${ENV_EXAMPLE}" ] || die "Missing template: ${ENV_EXAMPLE}"
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    ok "Created .env from docker/.env.example"
  else
    ok ".env already exists — your values are left untouched"
  fi

  local domain
  domain="$(env_get DOMAIN)"; domain="${DOMAIN:-${domain:-skyutils.xyz}}"
  env_set_if_empty "DOMAIN"               "${domain}"
  env_set_if_empty "APP_PORT"             "3000"
  env_set_if_empty "APP_BASE_URL"         "https://${domain}"
  env_set_if_empty "DISCORD_REDIRECT_URI" "https://${domain}/api/auth/discord/callback"

  local generated=()
  for key in RUNNER_TOKEN AUTH_SECRET CRYPTAPI_CALLBACK_SECRET; do
    if [ -z "$(env_get "${key}")" ]; then
      env_set_if_empty "${key}" "$(gen_secret 32)"
      generated+=("${key}")
    fi
  done
  if [ "${#generated[@]}" -gt 0 ]; then
    ok "Generated secrets: ${generated[*]}"
  else
    ok "All secrets already present — nothing generated"
  fi

  chmod 600 "${ENV_FILE}" 2>/dev/null || true

  for key in DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_BOT_TOKEN DISCORD_GUILD_ID; do
    if [ -z "$(env_get "${key}")" ]; then
      warn "${key} is empty in .env — fill it in before Discord login/bot works"
    fi
  done
  return 0
}

# ===========================================================================
# step 3 — build + start
# ===========================================================================
build_and_start() {
  if [ "${DO_BUILD}" -ne 1 ]; then
    warn "Skipping build/start (--no-build)"
    return 0
  fi
  info "Building images (web, bot)"
  compose --profile build-only build
  ok "Images built"
  info "Starting the app (web on 127.0.0.1:$(env_get APP_PORT) + discord-bot)"
  # web = the site/API; discord-bot = the long-running Discord gateway. Both
  # share the postgres + bot state volumes. The 'bot' image is build-only (per-run).
  compose up -d web discord-bot
  ok "App is up"
}

# ===========================================================================
# rebuild subcommand — pull/rebuild images and recreate the running stack
# ===========================================================================
# Rebuilds the web + bot images from the current source and recreates the
# running containers (web + discord-bot) with the new image. Use this after a
# `git pull` to ship an update. The postgres + bot state volumes are
# preserved across rebuilds — they are never touched here.
rebuild_stack() {
  command -v docker >/dev/null 2>&1 || die "Docker is not available."
  [ -f "${ENV_FILE}" ] || die "No .env found — run ./setup.sh first."
  info "Rebuilding images from current source (web, bot)"
  compose --profile build-only build
  ok "Images rebuilt"
  info "Recreating containers (web + discord-bot)"
  compose up -d web discord-bot
  ok "Stack updated and running"
  compose ps
}

# ===========================================================================
# nginx subcommand — install the server block into the HOST nginx
# ===========================================================================
# Renders nginx/skyutils.conf with DOMAIN/APP_PORT, copies it into
# /etc/nginx/sites-available/, enables it, validates and reloads nginx.
# TLS uses the certificates you already generated (default Let's Encrypt
# paths; override with SSL_CERT / SSL_KEY in .env or the environment).
install_nginx_config() {
  local domain port ssl_cert ssl_key rendered target
  domain="${DOMAIN:-$(env_get DOMAIN)}"; domain="${domain:-skyutils.xyz}"
  port="${APP_PORT:-$(env_get APP_PORT)}"; port="${port:-3000}"
  ssl_cert="${SSL_CERT:-$(env_get SSL_CERT)}"
  ssl_cert="${ssl_cert:-/etc/letsencrypt/live/${domain}/fullchain.pem}"
  ssl_key="${SSL_KEY:-$(env_get SSL_KEY)}"
  ssl_key="${ssl_key:-/etc/letsencrypt/live/${domain}/privkey.pem}"

  [ -f "${NGINX_SAMPLE}" ] || die "Sample not found: ${NGINX_SAMPLE}"

  # Render the template with the actual domain/port/cert paths.
  rendered="$(mktemp)"
  sed -e "s/skyutils\.lol/${domain}/g" \
      -e "s#http://127.0.0.1:3000#http://127.0.0.1:${port}#g" \
      -e "s#/etc/letsencrypt/live/${domain}/fullchain.pem#${ssl_cert}#" \
      -e "s#/etc/letsencrypt/live/${domain}/privkey.pem#${ssl_key}#" \
      "${NGINX_SAMPLE}" > "${rendered}"

  # Without a host nginx (or to just preview), print and exit.
  if [ ! -d /etc/nginx ]; then
    warn "/etc/nginx not found on this machine — printing the config instead."
    cat "${rendered}"; rm -f "${rendered}"
    return 0
  fi

  need_root
  info "Installing the server block into the host nginx"

  # Verify the certificates exist before touching nginx.
  if ${SUDO} test -f "${ssl_cert}" && ${SUDO} test -f "${ssl_key}"; then
    ok "Certificates found: ${ssl_cert}"
  else
    die "Certificates not found (${ssl_cert} / ${ssl_key}). Set SSL_CERT and SSL_KEY in .env to their real paths, then re-run: sudo ./setup.sh nginx"
  fi

  # sites-available/enabled layout (Ubuntu default) or conf.d fallback.
  if [ -d /etc/nginx/sites-available ]; then
    target="/etc/nginx/sites-available/${domain}"
    ${SUDO} cp "${rendered}" "${target}"
    ${SUDO} ln -sf "${target}" "/etc/nginx/sites-enabled/${domain}"
    ok "Installed ${target} (+ enabled symlink)"
  else
    target="/etc/nginx/conf.d/${domain}.conf"
    ${SUDO} cp "${rendered}" "${target}"
    ok "Installed ${target}"
  fi
  rm -f "${rendered}"

  # Validate; roll back the new site on failure so the host nginx stays sane.
  if ${SUDO} nginx -t; then
    ${SUDO} systemctl reload nginx 2>/dev/null || ${SUDO} nginx -s reload
    ok "nginx reloaded — https://${domain} now proxies to 127.0.0.1:${port}"
    ok "Cloudflare real-IP restoration is active (CF-Connecting-IP)"
    warn "Cloudflare SSL/TLS mode should be 'Full (strict)'"
  else
    ${SUDO} rm -f "/etc/nginx/sites-enabled/${domain}" "${target}"
    die "nginx -t failed — the new site was removed, existing config untouched. Fix and re-run."
  fi
}

# ===========================================================================
# certbot subcommand — install certbot + request a Let's Encrypt certificate
# ===========================================================================
install_certbot() {
  need_root

  local domain="${DOMAIN:-$(env_get DOMAIN)}"; domain="${domain:-skyutils.xyz}"

  info "Installing certbot..."
  ${SUDO} apt-get update -y
  ${SUDO} apt-get install -y certbot python3-certbot-nginx

  # Ensure nginx is installed and our site is linked before requesting.
  if ! command -v nginx >/dev/null 2>&1; then
    die "nginx is not installed. Run: sudo apt install nginx"
  fi

  # Verify the nginx config for this domain is installed and valid.
  if [ -f "/etc/nginx/sites-available/${domain}" ]; then
    ok "nginx site config found: /etc/nginx/sites-available/${domain}"
  elif [ -f "/etc/nginx/conf.d/${domain}.conf" ]; then
    ok "nginx site config found: /etc/nginx/conf.d/${domain}.conf"
  else
    warn "nginx site config not found for ${domain}."
    warn "Run 'sudo ./setup.sh nginx' first, then re-run this command."
    if ! confirm "Continue anyway and request the certificate?"; then
      exit 1
    fi
  fi

  if ! ${SUDO} nginx -t; then
    die "nginx -t failed. Fix the nginx config and re-run."
  fi

  info "Requesting Let's Encrypt certificate for ${domain}..."
  ${SUDO} certbot --nginx -d "${domain}" --non-interactive --agree-tos \
    --email "admin@${domain}" --redirect -q

  # Dry-run renewal to verify it works.
  info "Testing auto-renewal..."
  ${SUDO} certbot renew --dry-run

  ok "SSL certificate obtained and auto-renewal is active."
  info "Reload nginx to pick up the new certificates:"
  ${SUDO} systemctl reload nginx
}

# ===========================================================================
# main
# ===========================================================================
if [ "${SUBCOMMAND}" = "nginx" ]; then
  install_nginx_config
  exit 0
fi

if [ "${SUBCOMMAND}" = "certbot" ]; then
  install_certbot
  exit 0
fi

if [ "${SUBCOMMAND}" = "rebuild" ]; then
  hr
  info "SkyUtils rebuild — project root: ${PROJECT_ROOT}"
  hr
  rebuild_stack
  hr
  ok "Rebuild complete. Tip: 'docker compose logs -f discord-bot' to watch the bot."
  hr
  exit 0
fi

hr
info "SkyUtils setup — project root: ${PROJECT_ROOT}"
hr

install_docker_ubuntu
command -v openssl >/dev/null 2>&1 && ok "openssl is available" || warn "openssl missing — using /dev/urandom fallback for secrets"
prepare_env
build_and_start

hr
ok "Setup complete."
echo
echo "Next steps:"
echo "  - Edit .env to fill Discord + payment values (secrets were auto-generated)."
echo "  - Wire your host nginx to the app:  sudo ./setup.sh nginx"
echo "    (installs the server block, tests, and reloads nginx)."
echo "  - Get SSL certificate:               sudo ./setup.sh certbot"
echo "    (installs certbot + requests Let's Encrypt cert for skyutils.xyz)."
echo "  - Cloudflare: orange cloud ON, SSL/TLS mode 'Full (strict)'."
echo "  - To ship an update later:  git pull && ./setup.sh rebuild"
hr
