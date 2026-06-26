"""
Antecore — Headless Bot Runner (Dockerized)
© Antecore Team

This is the GUI-less, container-native counterpart of the desktop controller
(main.py). It contains ONLY the bot engine — no tkinter / customtkinter — so it
can run unattended inside a Docker container and be orchestrated by the website.

Design goals (in priority order):
  1. BAN SAFETY. Every action is paced with human-like jitter, there is a hard
     floor on intervals, a random startup splay, typing simulation before DMs,
     proper 429 (rate-limit) back-off, and absolutely NO captcha-solving calls.
     If Discord ever throws a captcha challenge we log and skip — never feed a
     third-party solver, which is the fastest way to flag an account.
  2. OBSERVABILITY. Structured JSON log lines on stdout (picked up by
     `docker logs` and streamed into the website console) plus optional
     heartbeats/status POSTs back to the site so the DB always reflects reality.
  3. RESILIENCE. Token rotation on fatal close codes, graceful SIGTERM/SIGINT
     shutdown so the site can stop a run cleanly.

Config is read from (first match wins):
  • $BOT_CONFIG_JSON      — raw JSON string (preferred, injected by the site)
  • $BOT_CONFIG_FILE      — path to a JSON file
  • /app/config/bot_config.json
Both camelCase (website) and snake_case (desktop) keys are accepted.
"""

import asyncio
import json
import os
import random
import signal
import sys
import time
from collections import deque
from datetime import datetime, timezone
from typing import Optional

import discord

try:
    # urllib is stdlib; used only for the best-effort status callback.
    import urllib.request
    import urllib.error
except Exception:  # pragma: no cover
    urllib = None


# ─────────────────────────────────────────────────────────────
#  Runtime identity / integration env
# ─────────────────────────────────────────────────────────────
RUN_ID = os.environ.get("RUN_ID", "local")
USER_ID = os.environ.get("USER_ID", "")
PLUGIN_ID = os.environ.get("PLUGIN_ID", "discord-spam")
# Auto-Reply plugin: reply-only runner. NO channel spam loop ever runs; the bot
# only auto-replies to incoming DMs (and, in friend mode, accepts requests first).
REPLY_ONLY = PLUGIN_ID == "discord-autoreply"
# Discord Webhook Chat: uses the user's OAuth webhooks to send/receive messages as the user.
WEBHOOK_CHAT_MODE = PLUGIN_ID == "discord-webhook-chat"
CALLBACK_URL = os.environ.get("RUNNER_CALLBACK_URL", "").strip()
CALLBACK_TOKEN = os.environ.get("RUNNER_TOKEN", "").strip()
HEARTBEAT_SECONDS = int(os.environ.get("RUNNER_HEARTBEAT_SECONDS", "20") or "20")

# Live-console log shipping endpoint. Derived from the status callback URL
# (.../api/runner/callback -> .../api/runner/logs) unless given explicitly.
LOGS_URL = os.environ.get("RUNNER_LOGS_URL", "").strip()
if not LOGS_URL and CALLBACK_URL:
    LOGS_URL = CALLBACK_URL.rsplit("/", 1)[0] + "/logs"

# Discord-style live panel: structured DM/relationship events are shipped here.
EVENTS_URL = os.environ.get("RUNNER_EVENTS_URL", "").strip()
if not EVENTS_URL and CALLBACK_URL:
    EVENTS_URL = CALLBACK_URL.rsplit("/", 1)[0] + "/events"

# Manual captcha solve: the container registers a challenge and polls for the
# user-provided token instead of auto-solving (ban-safe by default).
CAPTCHA_URL = os.environ.get("RUNNER_CAPTCHA_URL", "").strip()
if not CAPTCHA_URL and CALLBACK_URL:
    CAPTCHA_URL = CALLBACK_URL.rsplit("/", 1)[0] + "/captcha"

# Manual replies queued from the dashboard are pulled from here.
OUTBOX_URL = os.environ.get("RUNNER_OUTBOX_URL", "").strip()
if not OUTBOX_URL and CALLBACK_URL:
    OUTBOX_URL = CALLBACK_URL.rsplit("/", 1)[0] + "/outbox"

# Webhook chat: fetch per-run webhook URLs from the website.
WEBHOOKS_URL = os.environ.get("RUNNER_WEBHOOKS_URL", "").strip()
if not WEBHOOKS_URL and CALLBACK_URL:
    WEBHOOKS_URL = CALLBACK_URL.rsplit("/", 1)[0] + "/discord-webhooks"

DEFAULT_CONFIG = {
    "tokens": [],
    "channel_id": 0,
    "channels": [],
    "interval_minutes": 0.5,
    "messages": [],
    "auto_reply": "",
    "auto_reply_enabled": False,
    "replied_users_file": "/app/state/noflyzone.json",
    "dm_delay_seconds": 20,
    "max_concurrent_replies": 10,
    "max_send_failures": 3,
    "replace_mode": False,
    "auto_delete": False,
    "auto_delete_seconds": 20,
    "mode": "dm",
    "friend_accept_delay": 12,
    "proxy": "",
    # AI reply (Groq) — optional. Falls back to the static template on error.
    "ai_enabled": False,
    "ai_api_key": "",
    "ai_model": "llama-3.3-70b-versatile",
    "ai_prompt": "You are a friendly Discord user. Reply casually and briefly to the message.",
    # Safety / notifications.
    "blocked_words": [],
    "blacklist_user_ids": [],
    "first_message": "",
    "webhook_url": "",
    "notify_on_ban": False,
    "log_dms": False,
    "custom_status": "",
    # Smart-send: only post when >= min_online members are online.
    "smart_send": False,
    "min_online": 5,
    # Scheduled one-off messages: [{ "time": "HH:MM" (UTC), "message": "..." }].
    "schedule": [],
    # One-time mass DM blast at startup.
    "mass_dm_enabled": False,
    "mass_dm_user_ids": [],
    "mass_dm_message": "",
    # Discord Webhook Chat: channel IDs the bot should listen to via webhooks.
    "webhook_channel_ids": [],
    # ── Account groups ──────────────────────────────────────────────
    # Tokens with index < group1_count belong to Group 1 (Single Reply pool).
    # Group 2 tokens are independent and can handle the same users.
    "group1_count": 0,
    # Enable Single Reply across all Group-1 accounts: once any Group-1 account
    # handles a user (DM or friend request), the others skip that user.
    "single_reply": False,
    # ── Friend request pacing ───────────────────────────────────────
    # Process friend requests one-at-a-time across all Group-1 accounts.
    "friend_one_at_a_time": False,
    # ── Cross-token friend deduplication ────────────────────────────
    # When multiple Group-1 tokens are used: if one token has already accepted
    # a friend request from a user, no other token will accept that same user's
    # request. Prevents the "multiple tokens each sent a friend request → all
    # race to accept → Discord detects it" ban scenario.
    "friend_cross_token": False,
}

# Hard safety floors. These cannot be lowered by config — they are the line
# between "looks human" and "looks like a bot that gets banned".
MIN_INTERVAL_SECONDS = 8.0          # never spam a channel faster than this
MIN_DM_DELAY_SECONDS = 6.0          # never reply to a DM faster than this
MAX_STARTUP_SPLAY_SECONDS = 12.0    # randomise first action across containers

FATAL_CLOSE_CODES = {
    4004: "Unauthenticated token", 4010: "Invalid sharding",
    4011: "Sharding required", 4012: "Invalid API version",
    4013: "Invalid intents", 4014: "Disallowed intents",
    1002: "Invalid protocol",
}
FATAL_HTTP_CODES = {401: "Unauthorized token"}

stats = {
    "messages_sent": 0,
    "dms_replied": 0,
    "friends_accepted": 0,
    "start_time": None,
    "last_message": None,
}

bot_running = True
current_client = None
current_token_index = 0
restart_event = None
_shutdown = False

# ── Single Reply: shared across all Group-1 accounts in this run ──────────────
_single_reply_set: set = set()
_single_reply_lock = asyncio.Lock()
_SINGLE_REPLY_FILE = "/app/state/single_reply.json"


def _load_single_reply() -> set:
    try:
        with open(_SINGLE_REPLY_FILE, "r") as f:
            return set(json.load(f))
    except FileNotFoundError:
        return set()
    except Exception as e:
        log("WARNING", f"Error loading single-reply set: {e}")
        return set()


def _save_single_reply(uid: str):
    try:
        os.makedirs(os.path.dirname(_SINGLE_REPLY_FILE), exist_ok=True)
        with open(_SINGLE_REPLY_FILE, "w") as f:
            json.dump(list(_single_reply_set), f)
    except Exception as e:
        log("WARNING", f"Could not persist single-reply set: {e}")


async def check_single_reply(uid: str) -> bool:
    async with _single_reply_lock:
        return uid in _single_reply_set


async def mark_single_reply(uid: str):
    async with _single_reply_lock:
        _single_reply_set.add(uid)
    _save_single_reply(uid)


def init_single_reply():
    global _single_reply_set
    _single_reply_set = _load_single_reply()
    log("INFO", f"Single-Reply pool loaded: {len(_single_reply_set)} user(s)")


# ── Cross-token friend deduplication ─────────────────────────────────────────
# Tracks which user IDs have already been accepted as friends by ANY Group-1
# token. When friend_cross_token=True, new incoming requests for those users
# are silently dropped instead of triggering duplicate accept attempts.
_friend_cross_token_set: set = set()
_friend_cross_token_lock = asyncio.Lock()
_FRIEND_CROSS_TOKEN_FILE = "/app/state/friend_cross_token.json"


def _load_friend_cross_token() -> set:
    try:
        with open(_FRIEND_CROSS_TOKEN_FILE, "r") as f:
            return set(json.load(f))
    except FileNotFoundError:
        return set()
    except Exception as e:
        log("WARNING", f"Error loading friend_cross_token set: {e}")
        return set()


def _save_friend_cross_token():
    try:
        os.makedirs(os.path.dirname(_FRIEND_CROSS_TOKEN_FILE), exist_ok=True)
        with open(_FRIEND_CROSS_TOKEN_FILE, "w") as f:
            json.dump(list(_friend_cross_token_set), f)
    except Exception as e:
        log("WARNING", f"Could not persist friend_cross_token set: {e}")


async def check_friend_cross_token(uid: str) -> bool:
    async with _friend_cross_token_lock:
        return uid in _friend_cross_token_set


async def mark_friend_cross_token(uid: str):
    async with _friend_cross_token_lock:
        _friend_cross_token_set.add(uid)
    _save_friend_cross_token()


def init_friend_cross_token():
    global _friend_cross_token_set
    _friend_cross_token_set = _load_friend_cross_token()
    log("INFO", f"Cross-token friend pool loaded: {len(_friend_cross_token_set)} user(s)")


# ── Global friend request queue (one-at-a-time across Group-1 accounts) ──────────
_friend_queue: asyncio.Queue = asyncio.Queue()


# ── Token-index → active MultiTokenClient (filled in each client's on_ready) ─────
_token_clients: dict = {}


# ── Account status tracking ────────────────────────────────────────────────────
_account_statuses: dict = {}


def log_account_status(token_index: int, status: str, reason: str = ""):
    statuses = {"online", "rate_limited", "locked", "banned", "offline"}
    if status not in statuses:
        return
    now = time.time()
    prev = _account_statuses.get(token_index, {}).get("status", None)
    _account_statuses[token_index] = {"status": status, "since": now}
    if prev != status:
        suffix = f" — {reason}" if reason else ""
        log("STATUS", f"Account [{token_index + 1}] {status.upper()}{suffix}")
        push_event("account_status", f"Account {token_index + 1}", str(token_index),
                    f"{status.upper()}{suffix}")
# Set when the run cannot continue due to a CONFIGURATION problem (e.g. the
# target channel doesn't exist). This is distinct from a token failure: we stop
# the whole run cleanly with this exact message and do NOT rotate tokens.
fatal_config_error = None


# ─────────────────────────────────────────────────────────────
#  Structured logging (stdout → docker logs → website console)
# ─────────────────────────────────────────────────────────────
import threading  # noqa: E402  (kept next to its only use)

# Lines are buffered and shipped to the website's internal /api/runner/logs
# endpoint by a background thread, so the live console works without giving the
# web process access to the Docker socket.
_log_buffer = deque(maxlen=2000)
_log_lock = threading.Lock()
_log_stop = threading.Event()


def log(level, message):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    payload = {
        "ts": ts,
        "run": RUN_ID,
        "level": level,
        "msg": message,
    }
    # One JSON object per line — trivial to parse, still readable in raw logs.
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    # Queue for shipping to the website console (best-effort).
    if LOGS_URL:
        with _log_lock:
            _log_buffer.append({"ts": ts, "level": level, "msg": str(message)})


def _ship_logs_once():
    """Drain the buffer and POST it to the website. Never raises."""
    if not LOGS_URL or urllib is None:
        return
    with _log_lock:
        if not _log_buffer:
            return
        batch = list(_log_buffer)[:200]
        for _ in range(len(batch)):
            _log_buffer.popleft()
    try:
        body = json.dumps({"runId": RUN_ID, "lines": batch}).encode("utf-8")
        req = urllib.request.Request(
            LOGS_URL,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "x-runner-token": CALLBACK_TOKEN,
            },
        )
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        # Re-queue the batch so we don't lose lines on a transient failure.
        with _log_lock:
            for ln in reversed(batch):
                _log_buffer.appendleft(ln)


def _log_shipper_loop():
    while not _log_stop.is_set():
        _ship_logs_once()
        _log_stop.wait(1.5)
    _ship_logs_once()  # final flush on shutdown


def post_status(status, error=None):
    """Best-effort status/heartbeat POST back to the website. Never raises."""
    if not CALLBACK_URL or urllib is None:
        return
    try:
        body = json.dumps({
            "runId": RUN_ID,
            "userId": USER_ID,
            "pluginId": PLUGIN_ID,
            "status": status,
            "error": error,
            "stats": {
                "messagesSent": stats["messages_sent"],
                "dmsReplied": stats["dms_replied"],
                "friendsAccepted": stats["friends_accepted"],
            },
        }).encode("utf-8")
        req = urllib.request.Request(
            CALLBACK_URL,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "x-runner-token": CALLBACK_TOKEN,
            },
        )
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as e:  # pragma: no cover - telemetry must never crash the bot
        log("WARNING", f"status callback failed: {e}")


def _post_json(url, payload, timeout=6):
    """Best-effort JSON POST. Returns the decoded response or None. Never raises."""
    if not url or urllib is None:
        return None
    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "x-runner-token": CALLBACK_TOKEN,
            },
        )
        raw = urllib.request.urlopen(req, timeout=timeout).read()
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
    except Exception:
        return None


def _get_json(url, timeout=6):
    """Best-effort JSON GET. Returns the decoded response or None. Never raises."""
    if not url or urllib is None:
        return None
    try:
        req = urllib.request.Request(
            url,
            method="GET",
            headers={"x-runner-token": CALLBACK_TOKEN},
        )
        raw = urllib.request.urlopen(req, timeout=timeout).read()
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def push_event(kind, author, author_id, content):
    """Ship one DM/relationship event to the website's Discord-style panel."""
    if not EVENTS_URL:
        return
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    _post_json(
        EVENTS_URL,
        {
            "runId": RUN_ID,
            "events": [
                {
                    "kind": kind,
                    "author": str(author or "")[:100],
                    "authorId": str(author_id or "")[:32],
                    "content": str(content or "")[:2000],
                    "ts": ts,
                }
            ],
        },
    )


def request_manual_captcha(sitekey, rqdata=None, service="hcaptcha", wait_seconds=180):
    """Register a captcha challenge and poll for a user-supplied solution.

    Returns the solution token string, or None if it times out / is cancelled.
    The bot NEVER auto-solves — the user solves it from the dashboard.
    """
    if not CAPTCHA_URL:
        return None
    created = _post_json(
        CAPTCHA_URL,
        {"runId": RUN_ID, "sitekey": sitekey, "rqdata": rqdata, "service": service},
    )
    if not created or not created.get("id"):
        return None
    challenge_id = created["id"]
    log("WARNING", "Captcha challenge raised — waiting for a manual solve from the dashboard…")

    poll_url = f"{CAPTCHA_URL}?id={challenge_id}"
    deadline = time.time() + wait_seconds
    while time.time() < deadline and bot_running:
        time.sleep(3)
        state = _get_json(poll_url)
        if not state:
            continue
        status = state.get("status")
        if status == "solved" and state.get("solution"):
            log("OK", "Captcha solved from the dashboard — resuming.")
            return state["solution"]
        if status == "cancelled":
            log("WARNING", "Captcha challenge cancelled from the dashboard.")
            return None
    log("WARNING", "Captcha challenge timed out without a solution.")
    return None


def fetch_manual_replies():
    """Pull replies queued from the dashboard. Returns a list of
    {targetId, content} dicts (already claimed server-side). Never raises."""
    if not OUTBOX_URL:
        return []
    state = _get_json(f"{OUTBOX_URL}?runId={RUN_ID}")
    if not state:
        return []
    return state.get("messages", []) or []


# ──────────────────────────────────────────────────────────��──
#  Config loading + normalisation (accepts camelCase & snake_case)
# ─────────────────────────────────────────────────────────────
def _coerce_int(value, fallback):
    # NOTE: never route through float() — Discord snowflake IDs have 18-19
    # digits and float64 only holds ~15-16, silently corrupting the ID (and
    # producing bogus 404 "Unknown Channel"). Parse the integer directly.
    if value is None:
        return fallback
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        # Last-resort for genuine floats like "12.0".
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return fallback


def _coerce_float(value, fallback):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def normalize_config(raw):
    """Map website (camelCase) or desktop (snake_case) keys onto one shape."""
    def pick(*keys, default=None):
        for k in keys:
            if k in raw and raw[k] not in (None, ""):
                return raw[k]
        for k in keys:
            if k in raw:
                return raw[k]
        return default

    cfg = dict(DEFAULT_CONFIG)
    cfg["tokens"] = [t for t in (pick("tokens", default=[]) or []) if str(t).strip()]
    cfg["channel_id"] = _coerce_int(pick("channel_id", "channelId", default=0), 0)
    cfg["interval_minutes"] = _coerce_float(pick("interval_minutes", "intervalMinutes", default=0.5), 0.5)
    cfg["messages"] = [m for m in (pick("messages", default=[]) or []) if str(m).strip()]
    cfg["auto_reply"] = pick("auto_reply", "autoReply", default="") or ""
    cfg["auto_reply_lines"] = [
        m for m in (pick("auto_reply_lines", "autoReplyLines", default=[]) or [])
        if str(m).strip()
    ]
    cfg["auto_reply_random"] = bool(pick("auto_reply_random", "autoReplyLinesRandom", default=True))
    cfg["auto_reply_enabled"] = bool(pick("auto_reply_enabled", "autoReplyEnabled", default=False))
    cfg["replied_users_file"] = pick("replied_users_file", default="/app/state/noflyzone.json")
    cfg["dm_delay_seconds"] = _coerce_float(pick("dm_delay_seconds", "dmDelaySeconds", default=20), 20)
    cfg["max_concurrent_replies"] = _coerce_int(pick("max_concurrent_replies", "maxConcurrentReplies", default=10), 10)
    cfg["max_send_failures"] = _coerce_int(pick("max_send_failures", "maxSendFailures", default=3), 3)
    cfg["replace_mode"] = bool(pick("replace_mode", "replaceMode", default=False))
    cfg["auto_delete"] = bool(pick("auto_delete", "autoDelete", default=False))
    cfg["auto_delete_seconds"] = _coerce_float(pick("auto_delete_seconds", "autoDeleteSeconds", default=20), 20)
    cfg["mode"] = pick("mode", default="dm") or "dm"
    cfg["friend_accept_delay"] = _coerce_float(pick("friend_accept_delay", "friendAcceptDelay", default=12), 12)
    cfg["proxy"] = (pick("proxy", default="") or "").strip()

    # Multi-channel: normalise each entry to {channel_id:int, interval_seconds:float}.
    raw_channels = pick("channels", default=[]) or []
    channels = []
    for ch in raw_channels:
        if not isinstance(ch, dict):
            continue
        cid = _coerce_int(ch.get("channel_id", ch.get("channelId", 0)), 0)
        if not cid:
            continue
        ivl = _coerce_float(ch.get("interval_minutes", ch.get("intervalMinutes", 0.5)), 0.5)
        channels.append({"channel_id": cid, "interval_seconds": max(MIN_INTERVAL_SECONDS, ivl * 60)})
    cfg["channels"] = channels

    # AI reply (Groq).
    cfg["ai_enabled"] = bool(pick("ai_enabled", "aiEnabled", default=False))
    cfg["ai_api_key"] = (pick("ai_api_key", "aiApiKey", default="") or "").strip()
    cfg["ai_model"] = (pick("ai_model", "aiModel", default="llama-3.3-70b-versatile") or "llama-3.3-70b-versatile").strip()
    cfg["ai_prompt"] = pick("ai_prompt", "aiPrompt", default=DEFAULT_CONFIG["ai_prompt"]) or DEFAULT_CONFIG["ai_prompt"]

    # Safety / notifications.
    cfg["blocked_words"] = [str(w).strip().lower() for w in (pick("blocked_words", "blockedWords", default=[]) or []) if str(w).strip()]
    cfg["blacklist_user_ids"] = {str(u).strip() for u in (pick("blacklist_user_ids", "blacklistUserIds", default=[]) or []) if str(u).strip()}
    cfg["first_message"] = pick("first_message", "firstMessage", default="") or ""
    cfg["webhook_url"] = (pick("webhook_url", "webhookUrl", default="") or "").strip()
    cfg["notify_on_ban"] = bool(pick("notify_on_ban", "notifyOnBan", default=False))
    cfg["log_dms"] = bool(pick("log_dms", "logDms", default=False))
    cfg["custom_status"] = (pick("custom_status", "customStatus", default="") or "").strip()

    # Smart-send.
    cfg["smart_send"] = bool(pick("smart_send", "smartSend", default=False))
    cfg["min_online"] = _coerce_int(pick("min_online", "minOnline", default=5), 5)

    # Group management.
    cfg["group1_count"] = _coerce_int(pick("group1_count", "group1Count", default=0), 0)
    cfg["single_reply"] = bool(pick("single_reply", "singleReply", default=False))
    cfg["friend_one_at_a_time"] = bool(pick("friend_one_at_a_time", "friendOneAtATime", default=False))
    cfg["friend_cross_token"] = bool(pick("friend_cross_token", "friendCrossToken", default=False))

    # Scheduler.
    raw_schedule = pick("schedule", default=[]) or []
    schedule = []
    for it in raw_schedule:
        if not isinstance(it, dict):
            continue
        tm = str(it.get("time", "")).strip()
        msg = str(it.get("message", "")).strip()
        if tm and msg:
            schedule.append({"time": tm, "message": msg})
    cfg["schedule"] = schedule

    # Mass DM.
    cfg["mass_dm_enabled"] = bool(pick("mass_dm_enabled", "massDmEnabled", default=False))
    cfg["mass_dm_user_ids"] = [str(u).strip() for u in (pick("mass_dm_user_ids", "massDmUserIds", default=[]) or []) if str(u).strip()]
    cfg["mass_dm_message"] = pick("mass_dm_message", "massDmMessage", default="") or ""

    cfg["webhook_channel_ids"] = [
        str(ch).strip() for ch in (pick("webhook_channel_ids", default=[]) or []) if str(ch).strip()
    ]
    return cfg


def load_config():
    raw = None
    env_json = os.environ.get("BOT_CONFIG_JSON", "").strip()
    if env_json:
        raw = json.loads(env_json)
    else:
        path = os.environ.get("BOT_CONFIG_FILE", "/app/config/bot_config.json")
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    return normalize_config(raw)


# ─────────────────────────────────────────────────────────────
#  no-fly-zone (already-replied users) persistence
# ─────────────────────────────────────────────────────────────
def _ensure_parent(path):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    except Exception:
        pass


def load_replied_users(cfg):
    try:
        with open(cfg["replied_users_file"], "r") as f:
            return set(json.load(f))
    except FileNotFoundError:
        return set()
    except Exception as e:
        log("ERROR", f"Error loading replied users: {e}")
        return set()


def save_replied_user(uid, cfg):
    replied = load_replied_users(cfg)
    replied.add(uid)
    _ensure_parent(cfg["replied_users_file"])
    try:
        with open(cfg["replied_users_file"], "w") as f:
            json.dump(list(replied), f)
    except Exception as e:
        log("WARNING", f"Could not persist replied user: {e}")


def resolve_placeholders(text, user=None):
    if user:
        text = text.replace("@user", f"<@{user.id}>")
    return text


def humanized(base, spread=0.35, floor=0.0):
    """Base delay + random jitter so timing never looks robotic."""
    try:
        base = float(base)
    except (TypeError, ValueError):
        return floor
    if base <= 0:
        return floor
    delta = base * spread
    return max(floor, base + random.uniform(-delta, delta))


def parse_proxy(proxy):
    """Turn 'user:pass@host:port' or 'host:port' into (url, auth) for discord.py."""
    if not proxy:
        return None, None
    p = proxy.strip()
    if "://" in p:
        p = p.split("://", 1)[1]
    auth = None
    host = p
    if "@" in p:
        creds, host = p.rsplit("@", 1)
        if ":" in creds:
            u, pw = creds.split(":", 1)
            auth = (u, pw)
    return f"http://{host}", auth


def contains_blocked_word(text, cfg):
    """True if the incoming text contains any configured blocked word."""
    blocked = cfg.get("blocked_words") or []
    if not blocked:
        return False
    low = (text or "").lower()
    return any(w in low for w in blocked)


def is_blacklisted(user_id, cfg):
    return str(user_id) in (cfg.get("blacklist_user_ids") or set())


def generate_ai_reply(cfg, incoming_text, fallback):
    """Generate a reply via Groq's OpenAI-compatible API. Returns `fallback`
    on any error so a run never stalls. Uses stdlib urllib — no extra deps."""
    if not cfg.get("ai_enabled") or not cfg.get("ai_api_key") or urllib is None:
        return fallback
    try:
        body = json.dumps({
            "model": cfg.get("ai_model") or "llama-3.3-70b-versatile",
            "messages": [
                {"role": "system", "content": cfg.get("ai_prompt") or ""},
                {"role": "user", "content": incoming_text or ""},
            ],
            "max_tokens": 200,
            "temperature": 0.9,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {cfg['ai_api_key']}",
            },
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        reply = (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
        return reply or fallback
    except Exception as e:
        log("WARNING", f"AI reply failed ({e}) — using static reply")
        return fallback


async def _async_webhook_post(url: str, payload: dict, retries: int = 3) -> bool:
    """Send JSON to a Discord webhook URL with exponential-backoff retries."""
    import aiohttp
    for attempt in range(retries):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=8),
                ) as resp:
                    if resp.status in (200, 204, 429):
                        return True
                    body = await resp.text()
                    log("WARNING", f"webhook POST [{resp.status}] attempt {attempt + 1}: {body[:120]}")
        except asyncio.TimeoutError:
            log("WARNING", f"webhook timeout on attempt {attempt + 1}/{retries}")
        except Exception as e:
            log("WARNING", f"webhook POST error attempt {attempt + 1}/{retries}: {e}")
        if attempt < retries - 1:
            await asyncio.sleep(1.5 ** attempt)
    return False


async def notify_webhook(cfg, title, description, color=0xED4245, kind="ban"):
    """Best-effort Discord webhook embed (ban/timeout alerts, DM logs)."""
    url = cfg.get("webhook_url")
    if not url:
        return
    success = await _async_webhook_post(url, {
        "embeds": [{
            "title": title[:256],
            "description": description[:2048],
            "color": color,
            "footer": {"text": f"RexWare · run {RUN_ID}"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }]
    })
    if not success:
        log("WARNING", f"webhook notify failed after retries: {title[:40]}")
    # Also push structured event for rate_limit and error kinds.
    if kind in ("rate_limit", "error"):
        push_event(kind, "Bot", "", f"{title}: {description[:200]}")


# ─────────────────────────────────────────────────────────────
#  Discord client (ban-safe; NO captcha solving anywhere)
# ─────────────────────────────────────────────────────────────
class MultiTokenClient(discord.Client):
    def __init__(self, token_index, config, *args, **kwargs):
        proxy_url, proxy_auth = parse_proxy(config.get("proxy", ""))
        if proxy_url:
            kwargs["proxy"] = proxy_url
            if proxy_auth:
                import aiohttp
                kwargs["proxy_auth"] = aiohttp.BasicAuth(*proxy_auth)
        intents = discord.Intents.all()
        super().__init__(intents=intents, *args, **kwargs)
        self.token_index = token_index
        self.config = config
        self.dm_queue = deque()
        self.active_replies = 0
        self.queue_lock = asyncio.Lock()
        self.users_in_queue = set()
        self._force_switch = False
        self._consecutive_fails = 0
        self._last_message = None
        self._cached_channel = None
        self._channel_cache = {}
        self._mass_dm_done = False
        # Group membership: accounts with index < group1_count are Group 1 (Single Reply pool).
        n_tokens = len(config.get("tokens", []))
        group1_count = config.get("group1_count", 0)
        self._is_group1 = (0 <= token_index < min(group1_count, n_tokens)) if n_tokens else False
        self._single_reply_enabled = config.get("single_reply", False)
        self._friend_cross_token_enabled = config.get("friend_cross_token", False)
        log_account_status(token_index, "online")

    async def on_ready(self):
        mode = self.config.get("mode", "dm").upper()
        group_tag = " [G1]" if self._is_group1 else " [G2]"
        log("INFO", f"Token [{self.token_index + 1}/{len(self.config['tokens'])}] -> {self.user} [Mode: {mode}]{group_tag}")
        post_status("running")

        # Register this client in the global client map
        _token_clients[self.token_index] = self

        # Optional custom status on the account.
        await self._apply_custom_status()

        # Startup splay: stagger the first action so many containers launched
        # together don't all fire at the exact same instant.
        await asyncio.sleep(random.uniform(0, MAX_STARTUP_SPLAY_SECONDS))
        self.loop.create_task(self.dm_queue_processor())
        # Deliver replies queued from the dashboard's Discord-style DM panel.
        self.loop.create_task(self.manual_reply_loop())
        push_event("system", "system", "", f"{self.user} is online")

        # Scheduler + one-time mass DM run in every mode.
        if self.config.get("schedule"):
            self.loop.create_task(self.scheduler_loop())
        if self.config.get("mass_dm_enabled") and self.config.get("mass_dm_user_ids"):
            self.loop.create_task(self.mass_dm_blast())

        if REPLY_ONLY:
            # Auto-Reply plugin: no channel spam, ever. Just listen for DMs.
            if self.config.get("mode", "dm") == "friend":
                log("INFO", f"Auto-Reply (Friend mode) [{self.token_index + 1}][{'G1' if self._is_group1 else 'G2'}] — accepting friend requests, then auto-replying to their DMs…")
                self.loop.create_task(self._drain_pending_requests())
                self.loop.create_task(self._friend_request_poller())
            else:
                log("INFO", f"Auto-Reply (DM mode) [{self.token_index + 1}][{'G1' if self._is_group1 else 'G2'}] — auto-replying to anyone who DMs…")
            return

        if WEBHOOK_CHAT_MODE:
            # Discord Webhook Chat: polls webhooks created by the user's OAuth token
            # and delivers/receives messages via those webhooks (acting AS the user).
            log("INFO", f"Discord Webhook Chat [{self.token_index + 1}] — polling user webhooks…")
            self.loop.create_task(self._webhook_chat_loop())
            return

        # Spam plugin: the channel spammer ALWAYS runs, regardless of mode.
        # Friend mode is purely additive (it also accepts friend requests and
        # auto-replies to their first DM); it must not disable the spam loop.
        if self.config.get("mode", "dm") == "friend":
            log("INFO", "Friend mode — spamming + accepting friend requests and auto-replying to DMs…")
            self.loop.create_task(self._drain_pending_requests())
            self.loop.create_task(self._friend_request_poller())

        # Multi-channel: one independent loop per channel; otherwise a single
        # loop on the legacy channel_id.
        channels = self.config.get("channels") or []
        if channels:
            log("INFO", f"Multi-channel mode — spamming {len(channels)} channel(s)")
            for ch in channels:
                self.loop.create_task(self.channel_loop(ch["channel_id"], ch["interval_seconds"]))
        else:
            self.loop.create_task(self.message_loop())

    async def _apply_custom_status(self):
        status = self.config.get("custom_status")
        if not status:
            return
        try:
            await self.change_presence(activity=discord.CustomActivity(name=status))
            log("INFO", f"Custom status set: {status!r}")
        except Exception as e:
            log("WARNING", f"Could not set custom status: {e}")

    async def connect(self, *args, **kwargs):
        try:
            await super().connect(*args, **kwargs)
        except discord.errors.ConnectionClosed as e:
            if e.code in FATAL_CLOSE_CODES:
                log("CRITICAL", f"Token [{self.token_index + 1}] INVALIDATED: {FATAL_CLOSE_CODES[e.code]}")
                self._force_switch = True
                restart_event.set()
            raise

    def _switch(self, reason):
        log("CRITICAL", f"Token [{self.token_index + 1}] forced switch: {reason}")
        reason_lower = reason.lower()
        if any(k in reason_lower for k in ["ban", "locked", "rate", "429", "timeout"]):
            log_account_status(self.token_index, "rate_limited", reason)
        else:
            log_account_status(self.token_index, "offline", reason)
        if self.config.get("notify_on_ban"):
            acct = getattr(self.user, "name", f"token #{self.token_index + 1}")
            asyncio.create_task(notify_webhook(
                self.config,
                "Account ban / timeout detected",
                f"**{acct}** triggered a forced token rotation.\nReason: `{reason}`",
            ))
        self._force_switch = True
        restart_event.set()

    def _fatal_config(self, message):
        """Stop the entire run because of a config problem (NOT a token issue).

        Rotating tokens would be pointless — every token hits the same bad
        config — so we flag a clean stop with an accurate, user-facing message
        that the website surfaces in the console and as a banner.
        """
        global bot_running, fatal_config_error
        fatal_config_error = message
        log("CRITICAL", f"Stopping run — configuration error: {message}")
        bot_running = False
        if restart_event is not None:
            restart_event.set()

    # ── Incoming DMs → queue for auto-reply (both modes) ──────
    async def on_message(self, message):
        if message.author.id == self.user.id:
            log("DM", f"[DEBUG] Dropped — own message")
            return

        # ── DMs → auto-reply ───────────────────────────────────
        if not isinstance(message.channel, discord.DMChannel):
            return

        log("DM", f"[DEBUG] Incoming DM from {message.author.name} ({message.author.id}): {message.content[:80]!r}")

        # Mirror the incoming DM into the website's Discord-style live panel.
        push_event("incoming", message.author.name, message.author.id, message.content or "")

        # Optional inbound DM logging to the configured webhook.
        if self.config.get("log_dms"):
            asyncio.create_task(notify_webhook(
                self.config,
                f"DM from {message.author.name}",
                f"{message.content or '(no text)'}\n\n`{message.author.id}`",
                color=0x5865F2,
            ))

        log("DM", f"[DEBUG] REPLY_ONLY={REPLY_ONLY} auto_reply_enabled={self.config.get('auto_reply_enabled')} auto_reply={self.config.get('auto_reply')!r}")
        if not (REPLY_ONLY or self.config.get("auto_reply_enabled")):
            log("DM", f"[DEBUG] Dropped — reply not enabled")
            return
        # Blacklisted users are never engaged.
        if is_blacklisted(message.author.id, self.config):
            log("DM", f"[DEBUG] Dropped — blacklisted: {message.author.name}")
            push_event("blocked", message.author.name, message.author.id, "blocked (blacklist)")
            return
        # Skip if the message trips a blocked word.
        if contains_blocked_word(message.content, self.config):
            log("DM", f"[DEBUG] Dropped — blocked word in: {message.content[:40]!r}")
            push_event("blocked", message.author.name, message.author.id, "blocked (blocked word)")
            return

        # ── Single Reply: Group-1 accounts only ───────────────────
        # Group-2 accounts always reply; Group-1 accounts share a pool and skip handled users.
        uid_str = str(message.author.id)
        if self._single_reply_enabled and self._is_group1:
            if await check_single_reply(uid_str):
                log("DM", f"[SINGLE-REPLY][{self.token_index + 1}] IGNORED — {message.author.name} already handled by Group 1")
                return
            await mark_single_reply(uid_str)

        # Pick all messages to cycle through: prefer auto_reply_lines (multiple) over single auto_reply.
        # The queue processor cycles through them in order so each new DM gets the next message.
        first_msg = (self.config.get("first_message") or "").strip()
        if first_msg:
            all_messages = [first_msg]
        elif self.config.get("auto_reply_lines"):
            all_messages = self.config["auto_reply_lines"]
        else:
            auto = (self.config.get("auto_reply") or "").strip()
            if not auto:
                log("DM", f"[DEBUG] Dropped — no reply text configured")
                return
            all_messages = [auto]
        log("DM", f"[DEBUG] tmpl list={all_messages!r}")
        async with self.queue_lock:
            if message.author.id not in self.users_in_queue:
                self.users_in_queue.add(message.author.id)
                # Store the FULL list so we cycle through all messages for this user.
                self.dm_queue.append((message, list(all_messages)))
                log("DM", f"[DEBUG] Queued auto-reply ({len(all_messages)} msg(s)) for {message.author.name}")

    # ──     # ── Drain: accept all already-pending requests on startup ─────────────────────
    # Scans existing relationships immediately after login and processes any that
    # are already pending (incoming or outgoing). This ensures requests that arrived
    # while the bot was offline are handled without waiting for the next poll cycle.
    async def _drain_pending_requests(self):
        idx = self.token_index + 1
        log("INFO", f"[DRAIN][{idx}] Scanning existing relationships for pending requests…")
        try:
            rels = await self.http.get_relationships()
        except Exception as e:
            log("WARNING", f"[DRAIN][{idx}] get_relationships failed: {e}")
            return

        pending_incoming: list = []
        pending_outgoing: list = []

        for rel in rels:
            rtype = rel.get("type", 0)
            uid = str(rel.get("user", {}).get("id", ""))
            uname = rel.get("user", {}).get("username", str(uid))
            if rtype == 3:
                pending_incoming.append((uid, uname))
            elif rtype == 4:
                pending_outgoing.append((uid, uname))

        total = len(pending_incoming) + len(pending_outgoing)
        if not total:
            log("INFO", f"[DRAIN][{idx}] No pending friend requests found.")
            return

        log("INFO", f"[DRAIN][{idx}] Found {total} pending request(s): {len(pending_incoming)} incoming, {len(pending_outgoing)} outgoing")

        # Process incoming: through global queue (one-at-a-time) with account's delay setting.
        for i, (uid, uname) in enumerate(pending_incoming):
            uid_str = str(uid)
            push_event("friend", uname, uid_str, f"[{idx}] sent you a friend request [drained on startup]")
            log("INFO", f"[DRAIN][{idx}] Enqueuing incoming from {uname} ({uid_str})")
            # Cross-token friend dedup: skip if any other G1 token already accepted this user.
            if self._friend_cross_token_enabled and self._is_group1:
                if await check_friend_cross_token(uid_str):
                    log("DM", f"[CROSS-TOKEN][{idx}] SKIPPED — friend request from {uname} already accepted by another G1 token")
                    continue
            # Single Reply check
            if self._single_reply_enabled and self._is_group1:
                if await check_single_reply(uid_str):
                    log("DM", f"[SINGLE-REPLY][{idx}] IGNORED — friend request from {uname} already handled by Group 1")
                    continue
                await mark_single_reply(uid_str)
            # Through global queue if one-at-a-time is enabled
            if self.config.get("friend_one_at_a_time", False):
                await _friend_queue.put((uid_str, uname, self.token_index, self.config))
            else:
                await self._accept_incoming_request(uid_str, uname)
            # Stagger between each item using the web-configured delay
            if i < len(pending_incoming) - 1:
                stagger = humanized(self.config.get("friend_accept_delay", 12), floor=4.0)
                log("INFO", f"[DRAIN][{idx}] Staggering {stagger:.0f}s before next…")
                await asyncio.sleep(stagger)

        # Process outgoing: confirm mutual immediately (not queued — no rate-limit risk).
        for uid, uname in pending_outgoing:
            uid_str = str(uid)
            push_event("friend", uname, uid_str, f"[{idx}] outgoing — confirming mutual [drained on startup]")
            log("INFO", f"[DRAIN][{idx}] Confirming mutual with outgoing to {uname} ({uid_str})")
            await self._confirm_outgoing_request(uid_str, uname)

        log("INFO", "[DRAIN] Done draining pending requests.")

    # ── Relationship poller — handles ALL relationship types ──────────────────────
    # discord.py-self 2.1.0 does not fire on_relationship_add, so all detection is
    # via REST polling. Handles:
    #   type 3 (incoming_request) → accept it
    #   type 4 (outgoing_request) → confirm it (mutual) so both are friends
    #   type 1 (friend)          → skip (already friends)
    #   type 2 (blocked)         → skip
    #   type 5/6 (implicit/suggestion) → skip
    async def _friend_request_poller(self):
        await self.wait_until_ready()
        idx = self.token_index + 1
        interval = self.config.get("friend_poll_interval_seconds", 10)
        log("INFO", f"[Poller][{idx}] Relationship poller started (every {interval}s)")
        already_handled: set = set()
        RT_INCOMING = 3
        RT_OUTGOING = 4
        RT_FRIEND = 1
        RT_BLOCKED = 2
        while not self.is_closed():
            await asyncio.sleep(interval)
            try:
                rels = await self.http.get_relationships()
            except Exception as e:
                log("WARNING", f"[Poller][{idx}] get_relationships failed: {e}")
                continue
            for rel in rels:
                try:
                    rtype = rel.get("type", 0)
                    uid = rel.get("user", {}).get("id")
                    if uid in already_handled:
                        continue
                    uid_str = str(uid)
                    uname = rel.get("user", {}).get("username", str(uid))

                    if rtype == RT_BLOCKED:
                        continue
                    if rtype == RT_FRIEND:
                        continue
                    if rtype in (5, 6):
                        continue

                    if rtype == RT_INCOMING:
                        log("INFO", f"[Poller][{idx}] Incoming friend request from {uname} ({uid_str})")
                        push_event("friend", uname, uid_str, f"[{idx}] sent you a friend request")
                        already_handled.add(uid_str)
                        # Cross-token friend dedup: skip if any other G1 token already accepted this user.
                        if self._friend_cross_token_enabled and self._is_group1:
                            if await check_friend_cross_token(uid_str):
                                log("DM", f"[CROSS-TOKEN][{idx}] SKIPPED — friend request from {uname} already accepted by another G1 token")
                                continue
                        # Single Reply: Group-1 accounts skip already-handled users
                        if self._single_reply_enabled and self._is_group1:
                            if await check_single_reply(uid_str):
                                log("DM", f"[SINGLE-REPLY][{idx}] IGNORED — friend request from {uname} already handled by Group 1")
                                continue
                            await mark_single_reply(uid_str)
                        # Through global queue (one-at-a-time) or accept immediately
                        if self.config.get("friend_one_at_a_time", False):
                            await _friend_queue.put((uid_str, uname, self.token_index, self.config))
                            log("INFO", f"[Poller][{idx}] Enqueued friend request from {uname} (queue size: {_friend_queue.qsize() + 1})")
                        else:
                            await self._accept_incoming_request(uid_str, uname)
                    elif rtype == RT_OUTGOING:
                        log("INFO", f"[Poller][{idx}] Outgoing friend request to {uname} ({uid_str}) — confirming mutual")
                        push_event("friend", uname, uid_str, f"[{idx}] outgoing — confirming mutual")
                        already_handled.add(uid_str)
                        # Outgoing: confirm immediately (not queued — no rate-limit risk)
                        await self._confirm_outgoing_request(uid_str, uname)
                    else:
                        log("WARNING", f"[Poller][{idx}] Unknown relationship type {rtype} for {uname} ({uid_str})")
                except Exception as e:
                    log("WARNING", f"[Poller][{idx}] Error processing relationship: {e}")
            if len(already_handled) > 500:
                already_handled.clear()

    async def _accept_incoming_request(self, uid, name, tries=3):
        """Accept an incoming friend request (type 3 → type 1). Retries up to `tries`
        times (each attempt cycles through all methods). Uses the delay from web config."""
        idx = self.token_index + 1
        uid_str = str(uid)

        for attempt in range(1, tries + 1):
            delay = humanized(self.config.get("friend_accept_delay", 12), floor=4.0)
            if delay > 0:
                log("INFO", f"[Poller][{idx}] Attempt {attempt}/{tries}: waiting {delay:.0f}s before accepting {name}…")
                await asyncio.sleep(delay)
            if await self._try_accept_incoming(uid_str, name):
                log("INFO", f"[Poller][{idx}] ✓ Accepted friend request from {name} ({uid_str})")
                push_event("friend", name, uid_str, f"[{idx}] ✓ accepted friend request")
                stats["friends_accepted"] += 1
                log_account_status(self.token_index, "online")
                # Mark in cross-token pool so other G1 tokens skip this user.
                if self._friend_cross_token_enabled and self._is_group1:
                    await mark_friend_cross_token(uid_str)
                return
            if attempt < tries:
                backoff = humanized(5, spread=0.3, floor=3.0)
                log("WARNING", f"[Poller][{idx}] Attempt {attempt} failed — retrying in {backoff:.0f}s")
                await asyncio.sleep(backoff)

        log("WARNING", f"[Poller][{idx}] ✗ All {tries} accept attempts failed for {name}")

    async def _try_accept_incoming(self, uid, name):
        """Single attempt to accept. Returns True on success."""
        session = self.http._HTTPClient__session
        headers = {"Authorization": self.http.token, "Content-Type": "application/json"}
        url = f"https://discord.com/api/v10/users/@me/relationships/{uid}"

        # Method 1: Relationship.accept() via in-memory cache
        for rel in self.relationships:
            try:
                rel_id = str(getattr(getattr(rel, "user", None), "id", "") or getattr(rel, "id", ""))
                if rel_id == str(uid):
                    await rel.accept()
                    return True
            except Exception:
                pass

        # Methods 2-8: Raw HTTP
        http_methods = [
            ("PUT",    {"type": 1}),
            ("POST",   {"type": 1}),
            ("PUT",    {"type": 3}),
            ("POST",   {"type": 3}),
            ("PATCH",  {"type": 1}),
            ("PATCH",  {"type": 3}),
            ("DELETE", {"type": 1}),
        ]
        for method, payload in http_methods:
            try:
                resp = await session.request(method, url, json=payload, headers=headers)
                if resp.status_code in (200, 201, 204):
                    return True
            except Exception:
                pass

        # Method 9: http.add_relationship
        try:
            await self.http.add_relationship(uid, 1)
            return True
        except Exception:
            pass

        # Method 10: http.edit_relationship
        try:
            await self.http.edit_relationship(uid, 1)
            return True
        except Exception:
            pass

        return False

    async def _confirm_outgoing_request(self, uid, name):
        """Confirm an outgoing friend request (type 4) by sending a mutual back.
        When both sides have sent requests, Discord makes both friends."""
        idx = self.token_index + 1
        uid_str = str(uid)
        delay = humanized(self.config.get("friend_accept_delay", 12), floor=4.0)
        if delay > 0:
            log("INFO", f"[Poller][{idx}] Waiting {delay:.0f}s before confirming mutual with {name}…")
            await asyncio.sleep(delay)
        session = self.http._HTTPClient__session
        headers = {"Authorization": self.http.token, "Content-Type": "application/json"}
        url = f"https://discord.com/api/v10/users/@me/relationships/{uid_str}"

        # Method 1: Relationship.accept() via in-memory cache
        for rel in self.relationships:
            try:
                rel_id = str(getattr(getattr(rel, "user", None), "id", "") or getattr(rel, "id", ""))
                if rel_id == uid_str:
                    await rel.accept()
                    stats["friends_accepted"] += 1
                    log("INFO", f"[Poller][{idx}] ✓ Confirmed mutual with {name} via Relationship.accept()")
                    push_event("friend", name, uid_str, f"[{idx}] confirmed mutual")
                    return
            except Exception:
                pass

        # Method 2: send_friend_request — KEY for outgoing:
        # Sending a request back to someone who already sent you one creates mutual friendship.
        try:
            await self.send_friend_request(uid_str)
            stats["friends_accepted"] += 1
            log("INFO", f"[Poller][{idx}] ✓ Confirmed mutual with {name} via send_friend_request()")
            push_event("friend", name, uid_str, f"[{idx}] confirmed mutual")
            return
        except Exception as e:
            log("WARNING", f"[Poller][{idx}] send_friend_request({name}) error: {e}")

        # Methods 3-9: Raw HTTP
        http_methods = [
            ("PUT",    {"type": 1}),
            ("POST",   {"type": 1}),
            ("PUT",    {"type": 3}),
            ("POST",   {"type": 3}),
            ("PATCH",  {"type": 1}),
            ("PATCH",  {"type": 3}),
            ("DELETE", {"type": 1}),
        ]
        for method, payload in http_methods:
            try:
                resp = await session.request(method, url, json=payload, headers=headers)
                body = resp.text[:150]
                if resp.status_code in (200, 201, 204):
                    stats["friends_accepted"] += 1
                    log("INFO", f"[Poller][{idx}] ✓ Confirmed mutual {name} via HTTP {method} {payload}")
                    push_event("friend", name, uid_str, f"[{idx}] confirmed mutual")
                    return
                else:
                    log("WARNING", f"[Poller][{idx}] HTTP {method} {payload} -> {resp.status_code}: {body}")
            except Exception as e:
                log("WARNING", f"[Poller][{idx}] HTTP {method} {payload} error: {e}")

        # Method 10: http.add_relationship
        try:
            await self.http.add_relationship(uid_str, 1)
            stats["friends_accepted"] += 1
            log("INFO", f"[Poller][{idx}] ✓ Confirmed mutual {name} via http.add_relationship()")
            push_event("friend", name, uid_str, f"[{idx}] confirmed mutual")
            return
        except Exception as e:
            log("WARNING", f"[Poller][{idx}] add_relationship({name}) error: {e}")

        log("WARNING", f"[Poller][{idx}] ✗ All confirm methods failed for {name}")

# ── Process one queued auto-reply (with typing simulation) ──
    async def process_dm_reply(self, message, all_messages: list):
        uid = str(message.author.id)

        for i, template in enumerate(all_messages):
            try:
                reply = template
                reply = resolve_placeholders(reply, user=message.author)

                # Human-like typing indicator before the main reply.
                try:
                    async with message.channel.typing():
                        await asyncio.sleep(min(6.0, max(1.5, len(reply) / 18.0)))
                except Exception:
                    pass

                await message.channel.send(reply)
                log("DM", f"[{self.token_index + 1}][{'G1' if self._is_group1 else 'G2'}] Reply {i+1}/{len(all_messages)} sent -> {message.author.name}")
                push_event("outgoing", "Auto-Reply", message.author.id, reply)
                stats["dms_replied"] += 1

                # If there are more messages, put user back in queue with remaining messages.
                remaining = all_messages[i + 1:]
                if remaining:
                    async with self.queue_lock:
                        self.dm_queue.append((message, remaining))
                    log("DM", f"[DEBUG] Queued {len(remaining)} remaining msg(s) for {message.author.name} -> {remaining[0][:60]!r}")
                    await asyncio.sleep(humanized(self.config["dm_delay_seconds"], floor=MIN_DM_DELAY_SECONDS))
                else:
                    # All messages sent — remove user from active set.
                    async with self.queue_lock:
                        self.users_in_queue.discard(message.author.id)

            except discord.errors.HTTPException as e:
                await self._handle_rate_limit(e)
                code = getattr(e, "status", getattr(e, "code", "?"))
                log("WARNING", f"DM to {message.author.name} failed ({code}) — non-fatal, skipping")
                async with self.queue_lock:
                    self.users_in_queue.discard(message.author.id)
                break
            except discord.errors.Forbidden:
                log("WARNING", f"DM to {message.author.name} forbidden — skipping")
                async with self.queue_lock:
                    self.users_in_queue.discard(message.author.id)
                break
            except Exception as e:
                log("ERROR", f"DM error for {message.author.name}: {e} — skipping")
                async with self.queue_lock:
                    self.users_in_queue.discard(message.author.id)
                break

    async def dm_queue_processor(self):
        await self.wait_until_ready()
        while not self.is_closed():
            try:
                async with self.queue_lock:
                    if self.dm_queue and self.active_replies < self.config["max_concurrent_replies"]:
                        msg, messages = self.dm_queue.popleft()
                        self.active_replies += 1
                        self.loop.create_task(self.process_dm_reply(msg, messages))
                await asyncio.sleep(2)
            except Exception as e:
                log("ERROR", f"Queue processor: {e}")
                await asyncio.sleep(5)

    # ── Discord Chat: guild message handler ───────────────────
    async def _webhook_chat_loop(self):
        """Poll the website for per-run webhook URLs, then fetch new messages
        from each webhook's message history and mirror them into the live panel.
        User replies are delivered by the same webhook (acting AS the user)."""
        await self.wait_until_ready()
        _last_webhook_fetch = 0.0
        _webhooks_cache = []
        _webhook_user = None  # {"username": ..., "globalName": ..., "avatarUrl": ...}

        while not self.is_closed() and bot_running:
            try:
                now = time.time()
                # Refresh webhook list from website every 30 seconds.
                if now - _last_webhook_fetch > 30:
                    _last_webhook_fetch = now
                    wh_data = _get_json(f"{WEBHOOKS_URL}?runId={RUN_ID}")
                    if wh_data and isinstance(wh_data, dict):
                        _webhooks_cache = wh_data.get("webhooks", []) or []
                        _webhook_user = wh_data.get("user")

                # Process pending outgoing messages (user sending from dashboard → Discord).
                messages = await asyncio.to_thread(fetch_manual_replies)
                for m in messages:
                    content = str(m.get("content", "")).strip()
                    if not content:
                        continue
                    # targetId = channel_id to route to the right webhook
                    target_id = str(m.get("targetId", "")).strip()
                    wh = None
                    if target_id:
                        wh = next((w for w in _webhooks_cache if str(w.get("channelId", "")) == target_id), None)
                    if not wh:
                        # Fallback: use the first webhook
                        wh = _webhooks_cache[0] if _webhooks_cache else None
                    if wh:
                        await self._send_webhook_message(wh, content, _webhook_user)

                await asyncio.sleep(1)
            except Exception as e:
                log("ERROR", f"Webhook chat loop: {e}")
                await asyncio.sleep(3)

    async def _send_webhook_message(self, webhook: dict, content: str, user=None):
        """Send a message as the user via their incoming webhook."""
        url = str(webhook.get("webhookUrl", "")).strip()
        if not url:
            return
        if not urllib:
            return
        try:
            # Build the payload so the message appears AS the user in Discord
            # (their display name + avatar instead of the generic bot name).
            payload: dict = {"content": content}
            if user:
                uname = str(user.get("username", "") or "")
                global_name = str(user.get("globalName", "") or "")
                # Use the global display name if set, fall back to username.
                display_name = global_name or uname
                if display_name:
                    payload["username"] = display_name
                avatar_url = str(user.get("avatarUrl", "") or "").strip()
                if avatar_url:
                    payload["avatar_url"] = avatar_url

            body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=body,
                method="POST",
                headers={"content-type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                if resp.status in (200, 204):
                    log("CHAT", f"Sent webhook message: {content[:60]!r}")
                else:
                    log("WARNING", f"Webhook send status {resp.status}")
        except Exception as e:
            log("WARNING", f"Webhook send failed: {e}")

    async def manual_reply_loop(self):
        """Webhook chat mode handles its own outgoing messages via _webhook_chat_loop."""
        if WEBHOOK_CHAT_MODE:
            return
        await self.wait_until_ready()
        while not self.is_closed() and bot_running:
            try:
                messages = await asyncio.to_thread(fetch_manual_replies)
                for m in messages:
                    target_id = str(m.get("targetId", "")).strip()
                    content = str(m.get("content", "")).strip()
                    if not target_id or not content:
                        continue
                    try:
                        user = self.get_user(int(target_id)) or await self.fetch_user(int(target_id))
                        dm = user.dm_channel or await user.create_dm()
                        await asyncio.sleep(humanized(2, floor=1.0))
                        await dm.send(content)
                        log("DM", f"Manual reply sent -> {user.name}")
                    except discord.errors.HTTPException as e:
                        await self._handle_rate_limit(e)
                        log("WARNING", f"Manual reply to {target_id} failed ({getattr(e, 'status', '?')})")
                    except Exception as e:
                        log("WARNING", f"Manual reply to {target_id} error: {e}")
            except Exception as e:
                log("ERROR", f"Manual reply loop: {e}")
            await asyncio.sleep(4)

    async def _handle_rate_limit(self, e):
        """Honour Discord 429 retry-after with a humanised back-off."""
        status = getattr(e, "status", None)
        if status == 429:
            retry = 5.0
            resp = getattr(e, "response", None)
            try:
                if resp is not None:
                    retry = float(resp.headers.get("Retry-After", retry))
            except Exception:
                pass
            backoff = humanized(retry + 2, spread=0.2, floor=retry)
            log("WARNING", f"Rate limited (429) — backing off {backoff:.1f}s")
            await asyncio.sleep(backoff)

    # ── Channel spam (DM mode) ────────────────────────────────
    async def _resolve_channel_by_id(self, channel_id):
        """Resolve an explicit channel id (cached per id). Returns None and
        flags a fatal config stop for 404/403/wrong-type, retries transient."""
        cached = self._channel_cache.get(channel_id)
        if cached is not None:
            return cached
        channel = self.get_channel(channel_id)
        if channel is None:
            try:
                channel = await self.fetch_channel(channel_id)
            except discord.errors.NotFound:
                self._log_guild_diagnostics(channel_id)
                self._fatal_config(
                    f"Channel {channel_id} not found (404). This account cannot see "
                    f"that channel — it is not in the server, or the ID is not a "
                    f"text channel."
                )
                return None
            except discord.errors.Forbidden:
                self._fatal_config(
                    f"Access to channel {channel_id} is forbidden (403). The account "
                    f"is in the server but lacks permission to view/send there."
                )
                return None
            except Exception as e:
                log("WARNING", f"fetch_channel({channel_id}) failed, will retry: {e}")
                return None
        if not hasattr(channel, "send"):
            self._fatal_config(
                f"Target {channel_id} is a {type(channel).__name__}, not a text "
                f"channel you can post in. Use a text channel ID."
            )
            return None
        self._channel_cache[channel_id] = channel
        log("INFO", f"Target channel resolved: #{getattr(channel, 'name', channel_id)}")
        return channel

    async def _resolve_channel(self):
        """Resolve the legacy single target channel, falling back to a REST fetch.

        get_channel() only hits the local cache, and DM channels are very
        often NOT cached right after login — so we must fall back to the
        async fetch_channel() API call before declaring the channel missing.
        The resolved channel is cached on the instance to avoid refetching.
        """
        if getattr(self, "_cached_channel", None) is not None:
            return self._cached_channel
        channel_id = self.config["channel_id"]
        if not channel_id:
            self._fatal_config(
                "No target channel configured. Set the channel ID in the plugin config."
            )
            return None
        # First the local cache (instant), then a REST fetch (uncached channels
        # aren't in cache right after login).
        channel = self.get_channel(channel_id)
        if channel is None:
            try:
                channel = await self.fetch_channel(channel_id)
            except discord.errors.NotFound:
                # 404 = this account literally cannot see the channel. Almost
                # always: the account behind the token is NOT in that server,
                # the ID is wrong, or it's a different object type (e.g. a
                # server/guild ID pasted instead of a channel ID).
                self._log_guild_diagnostics(channel_id)
                self._fatal_config(
                    f"Channel {channel_id} not found (404). This account cannot see "
                    f"that channel — it is not in the server, or the ID is not a "
                    f"text channel. Right-click the channel in Discord -> Copy "
                    f"Channel ID, and make sure this account has joined the server."
                )
                return None
            except discord.errors.Forbidden:
                self._fatal_config(
                    f"Access to channel {channel_id} is forbidden (403). The account "
                    f"is in the server but lacks permission to view/send there."
                )
                return None
            except Exception as e:
                # Transient (network/proxy/rate-limit) — do NOT stop the run; the
                # message loop will simply retry on the next interval.
                log("WARNING", f"fetch_channel({channel_id}) failed, will retry: {e}")
                return None
        if not hasattr(channel, "send"):
            self._fatal_config(
                f"Target {channel_id} is a {type(channel).__name__}, not a text "
                f"channel you can post in. Use a text channel ID."
            )
            return None
        self._cached_channel = channel
        log("INFO", f"Target channel resolved: #{getattr(channel, 'name', channel_id)}")
        return channel

    def _log_guild_diagnostics(self, channel_id):
        """Help the user see WHY a channel 404s: list the servers this account
        is actually in, so a missing target server is obvious in the console."""
        try:
            guilds = list(getattr(self, "guilds", []) or [])
            if not guilds:
                log(
                    "WARNING",
                    "This account is not in any server (or the guild list hasn't "
                    f"loaded yet), so it cannot access channel {channel_id}.",
                )
                return
            names = ", ".join(f"{g.name} ({g.id})" for g in guilds[:20])
            log("INFO", f"Account is in {len(guilds)} server(s): {names}")
        except Exception:
            pass

    def _online_count(self, channel):
        """Best-effort count of online members who can see the channel."""
        try:
            guild = getattr(channel, "guild", None)
            members = getattr(guild, "members", None) if guild else None
            if not members:
                return None
            online = 0
            for m in members:
                st = getattr(m, "status", None)
                if st is not None and str(st) != "offline":
                    online += 1
            return online
        except Exception:
            return None

    async def send_message(self, channel=None):
        try:
            if channel is None:
                channel = await self._resolve_channel()
            if not channel:
                # _resolve_channel already logged the reason and, for config
                # errors, flagged a clean stop. Transient errors just fall
                # through and retry on the next loop iteration.
                return
            # Smart-send: skip this tick if too few members are online.
            if self.config.get("smart_send"):
                online = self._online_count(channel)
                min_online = self.config.get("min_online", 5)
                if online is not None and online < min_online:
                    log("INFO", f"Smart-send: only {online} online (< {min_online}) — skipping tick")
                    return
            msgs = self.config.get("messages", [])
            if not msgs:
                return
            # Avoid sending the exact same line twice in a row.
            text = random.choice(msgs)
            if len(msgs) > 1:
                attempts = 0
                while text == self._last_message and attempts < 5:
                    text = random.choice(msgs)
                    attempts += 1
            self._last_message = text

            auto_delete = self.config.get("auto_delete", False)
            delete_after = self.config.get("auto_delete_seconds", 10)
            preview = text[:60].replace("\n", " ") + ("…" if len(text) > 60 else "")
            del_suffix = f"  [del {delete_after}s]" if auto_delete else ""

            # Light typing simulation before posting to a channel.
            try:
                async with channel.typing():
                    await asyncio.sleep(min(4.0, max(0.8, len(text) / 22.0)))
            except Exception:
                pass

            if self.config.get("replace_mode"):
                # Send a dot, then edit it into the actual message.
                dot = await channel.send(".")
                await asyncio.sleep(humanized(1.2, floor=0.4))
                await dot.edit(content=text)
                sent = dot
                log("SENT", f"[REPLACE] {preview!r}{del_suffix}")
            else:
                sent = await channel.send(text)
                log("SENT", f"{preview}{del_suffix}")

            push_event("sent", "Bot", str(channel.id), text[:100])
            if auto_delete:
                self.loop.create_task(self._schedule_delete(sent, delete_after))
            stats["messages_sent"] += 1
            stats["last_message"] = datetime.now(timezone.utc)
            self._consecutive_fails = 0
        except discord.errors.Forbidden:
            self._consecutive_fails += 1
            log("ERROR", f"403 Forbidden ({self._consecutive_fails}x) — skipping")
            if self._consecutive_fails >= self.config["max_send_failures"]:
                self._switch(f"403 repeated {self._consecutive_fails}x")
        except discord.errors.HTTPException as e:
            await self._handle_rate_limit(e)
            self._consecutive_fails += 1
            log("ERROR", f"HTTP {e.status} ({self._consecutive_fails}x)")
            if e.status in FATAL_HTTP_CODES:
                self._switch(f"HTTP {e.status}")
            elif self._consecutive_fails >= self.config["max_send_failures"]:
                self._switch(f"HTTP {e.status} repeated")
        except Exception as e:
            self._consecutive_fails += 1
            log("ERROR", f"Send error ({self._consecutive_fails}x): {e}")
            if self._consecutive_fails >= self.config["max_send_failures"]:
                self._switch("repeated errors")

    async def _schedule_delete(self, message, delay):
        try:
            await asyncio.sleep(delay)
            await message.delete()
            log("INFO", f"Message auto-deleted after {delay}s")
        except discord.errors.NotFound:
            pass
        except discord.errors.Forbidden:
            log("WARNING", "Auto-delete: missing Delete Messages permission")
        except Exception as e:
            log("WARNING", f"Auto-delete failed: {e}")

    async def message_loop(self):
        await self.wait_until_ready()
        await self.send_message()
        while not self.is_closed() and bot_running:
            interval = humanized(
                self.config["interval_minutes"] * 60,
                floor=MIN_INTERVAL_SECONDS,
            )
            await asyncio.sleep(interval)
            if not bot_running:
                break
            await self.send_message()

    async def channel_loop(self, channel_id, interval_seconds):
        """Independent spam loop for one channel (multi-channel mode)."""
        await self.wait_until_ready()
        channel = await self._resolve_channel_by_id(channel_id)
        if not channel:
            return
        await self.send_message(channel=channel)
        while not self.is_closed() and bot_running:
            interval = humanized(interval_seconds, floor=MIN_INTERVAL_SECONDS)
            await asyncio.sleep(interval)
            if not bot_running:
                break
            channel = await self._resolve_channel_by_id(channel_id)
            if channel:
                await self.send_message(channel=channel)

    async def scheduler_loop(self):
        """Fire scheduled one-off messages at their UTC HH:MM times.

        Each entry sends once per day. We track the last date fired so the
        same slot never double-fires within a minute window.
        """
        await self.wait_until_ready()
        fired = {}  # index -> "YYYY-MM-DD"
        log("INFO", f"Scheduler armed with {len(self.config['schedule'])} entry(ies)")
        while not self.is_closed() and bot_running:
            now = datetime.now(timezone.utc)
            hhmm = now.strftime("%H:%M")
            today = now.strftime("%Y-%m-%d")
            for i, item in enumerate(self.config.get("schedule", [])):
                if item.get("time") == hhmm and fired.get(i) != today:
                    fired[i] = today
                    channel = await self._resolve_channel()
                    if channel:
                        try:
                            await channel.send(item["message"])
                            stats["messages_sent"] += 1
                            log("SENT", f"[SCHEDULED {hhmm}] {item['message'][:60]}")
                            push_event("scheduled", "Scheduler", "", "Scheduled message sent")
                        except Exception as e:
                            log("WARNING", f"Scheduled send failed: {e}")
            await asyncio.sleep(30)

    async def mass_dm_blast(self):
        """One-time mass DM to a list of user IDs, paced with ban-safe jitter."""
        await self.wait_until_ready()
        if self._mass_dm_done:
            return
        self._mass_dm_done = True
        ids = self.config.get("mass_dm_user_ids", [])
        text = self.config.get("mass_dm_message", "")
        if not ids or not text:
            return
        log("INFO", f"Mass DM blast → {len(ids)} user(s)")
        for raw_id in ids:
            if not bot_running:
                break
            if is_blacklisted(raw_id, self.config):
                continue
            try:
                uid = int(str(raw_id).strip())
            except (TypeError, ValueError):
                continue
            try:
                user = self.get_user(uid) or await self.fetch_user(uid)
                body = resolve_placeholders(text, user=user)
                await user.send(body)
                stats["dms_replied"] += 1
                log("DM", f"Mass DM sent -> {getattr(user, 'name', uid)}")
                push_event("mass_dm", "MassDM", str(uid), "Mass DM sent")
            except discord.errors.HTTPException as e:
                await self._handle_rate_limit(e)
                log("WARNING", f"Mass DM to {raw_id} failed ({getattr(e, 'status', '?')}) — skipping")
            except Exception as e:
                log("WARNING", f"Mass DM to {raw_id} error: {e} — skipping")
            # Heavy, humanised spacing between DMs to stay under the radar.
            await asyncio.sleep(humanized(self.config.get("dm_delay_seconds", 20), floor=MIN_DM_DELAY_SECONDS + 4))
        log("INFO", "Mass DM blast complete")


# ── Global friend-request coordinator (one-at-a-time across Group-1 accounts) ──────
# All Group-1 accounts share ONE queue of pending friend requests. This task processes
# the queue one at a time, respecting each account's configured delay setting.
async def _run_friend_coordinator():
    await asyncio.sleep(5)  # wait for accounts to come online
    log("INFO", "[FriendCoordinator] Started — processing friend requests one at a time")
    while True:
        try:
            item = await asyncio.wait_for(_friend_queue.get(), timeout=60.0)
        except asyncio.TimeoutError:
            continue
        except Exception:
            await asyncio.sleep(5)
            continue

        uid, uname, account_index, cfg = item
        friend_delay = max(
            6.0,  # minimum floor (keep safer than 0)
            float(cfg.get("friend_accept_delay", 12)),
        )

        log("INFO", f"[FriendCoordinator][{account_index + 1}] Waiting {friend_delay:.0f}s before accepting {uname}…")
        await asyncio.sleep(friend_delay)

        # Look up the client that enqueued this item
        client: Optional[MultiTokenClient] = _token_clients.get(account_index)
        if client is None or client.is_closed():
            log("WARNING", f"[FriendCoordinator][{account_index + 1}] Account offline — skipping accept for {uname}")
            try:
                _friend_queue.task_done()
            except ValueError:
                pass
            continue

        try:
            uid_str = str(uid)
            await client._accept_incoming_request(uid_str, uname, tries=3)
            log("INFO", f"[FriendCoordinator][{account_index + 1}] ✓ Accepted friend request from {uname} ({uid_str})")
            push_event("friend", uname, uid_str, f"[{account_index + 1}] ✓ accepted friend request")
        except Exception as e:
            log("WARNING", f"[FriendCoordinator][{account_index + 1}] Accept failed for {uname}: {e}")

        try:
            _friend_queue.task_done()
        except ValueError:
            pass


# ─────────────────────────────────────────────────────────────
#  Token rotation supervisor
# ─────────────────────────────────────────────────────────────
async def heartbeat_loop():
    while bot_running:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        post_status("running")


async def run_with_token_rotation(config):
    """Run all tokens simultaneously as parallel clients.
    No rotation — all accounts stay online and connected unless they are
    rate-limited, locked, or offline.
    """
    global current_token_index, current_client, restart_event
    if not config["tokens"]:
        log("CRITICAL", "No valid token configured")
        post_status("error", "No valid token configured")
        return

    restart_event = asyncio.Event()
    asyncio.create_task(heartbeat_loop())

    # Initialize single-reply state from disk
    init_single_reply()

    # Initialize cross-token friend dedup state from disk
    init_friend_cross_token()

    # Start the friend-request coordinator (one-at-a-time queue for Group-1 accounts)
    asyncio.create_task(_run_friend_coordinator())

    async def run_single_token(token_index: int, token: str):
        """Run one token as an independent client. Errors are isolated — one
        failing token does not affect the others."""
        idx = token_index + 1
        client: Optional[MultiTokenClient] = None
        try:
            client = MultiTokenClient(token_index=token_index, config=config)
            _token_clients[token_index] = client
            await client.start(token)
        except discord.errors.LoginFailure:
            log("CRITICAL", f"Token [{idx}] INVALID or EXPIRED")
            log_account_status(token_index, "offline", "invalid or expired token")
            if client:
                client._force_switch = True
        except discord.errors.ConnectionClosed as e:
            if e.code in FATAL_CLOSE_CODES:
                reason = FATAL_CLOSE_CODES.get(e.code, "fatal close")
                log("CRITICAL", f"Token [{idx}] rejected: {reason} (code {e.code})")
                log_account_status(token_index, "offline", reason)
                if client:
                    client._force_switch = True
        except Exception as e:
            msg = str(e)
            ready = getattr(client, "is_ready", lambda: False)() if client else False
            lib_payload_bug = "is not iterable" in msg or "NoneType" in msg
            if lib_payload_bug:
                log(
                    "CRITICAL",
                    f"Token [{idx}] authenticated but Discord library crashed "
                    f"parsing the account payload. Upgrade discord.py-self (>=2.1.0). "
                    f"(internal: {msg})",
                )
                log_account_status(token_index, "offline", "discord.py-self library crash")
            elif not ready:
                log(
                    "CRITICAL",
                    f"Token [{idx}] login failed — likely invalid/expired token "
                    f"or locked account. (internal: {msg})",
                )
                log_account_status(token_index, "locked", "login failed")
            else:
                log("ERROR", f"Token [{idx}] unexpected runtime error: {msg}")
                log_account_status(token_index, "offline", msg)
            if client:
                client._force_switch = True
        finally:
            if client and not client.is_closed():
                await client.close()
            log_account_status(token_index, "offline")

    # Launch all tokens in parallel — they all run simultaneously.
    tasks = [
        asyncio.create_task(run_single_token(i, config["tokens"][i].strip()))
        for i in range(len(config["tokens"]))
    ]

    log("INFO", f"Starting all {len(tasks)} accounts simultaneously…")
    await asyncio.gather(*tasks, return_exceptions=True)
    log("INFO", "All token tasks have exited.")


def _install_signal_handlers(loop):
    def _handle(*_):
        global bot_running, _shutdown
        if _shutdown:
            return
        _shutdown = True
        bot_running = False
        log("INFO", "Shutdown signal received — stopping cleanly…")
        post_status("stopped")
        if restart_event is not None:
            loop.call_soon_threadsafe(restart_event.set)

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _handle)
        except NotImplementedError:  # pragma: no cover (e.g. Windows)
            signal.signal(sig, lambda *_: _handle())


def main():
    log("INFO", f"Antecore bot runner starting (run={RUN_ID}, plugin={PLUGIN_ID})")
    try:
        config = load_config()
    except Exception as e:
        log("CRITICAL", f"Failed to load config: {e}")
        post_status("error", f"config load failed: {e}")
        sys.exit(1)

    # Fail fast on obviously-broken config so the website shows a clear error
    # instead of a bot that silently does nothing.
    if not config.get("tokens"):
        log("CRITICAL", "No tokens configured — add at least one account token.")
        post_status("error", "No tokens configured — add at least one account token.")
        sys.exit(1)
    if REPLY_ONLY and not (
        (config.get("auto_reply") or "").strip()
        or config.get("auto_reply_lines")
    ):
        log("CRITICAL", "No auto-reply message configured — set the reply text.")
        post_status("error", "No auto-reply message configured — set the reply text.")
        sys.exit(1)

    stats["start_time"] = time.time()
    post_status("starting")

    # Background log shipper → website live console (best-effort).
    log_shipper = None
    if LOGS_URL:
        log_shipper = threading.Thread(target=_log_shipper_loop, daemon=True)
        log_shipper.start()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _install_signal_handlers(loop)

    try:
        loop.run_until_complete(run_with_token_rotation(config))
    except Exception as e:
        log("ERROR", f"Fatal: {e}")
        post_status("error", str(e))
    finally:
        if not _shutdown:
            post_status("stopped")
        # Cancel every still-pending task (heartbeat_loop, message_loop,
        # dm_queue_processor, …) and let them unwind BEFORE closing the loop.
        # Without this the interpreter prints noisy "Task was destroyed but it
        # is pending!" warnings on exit.
        try:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
        except Exception:
            pass
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        try:
            loop.close()
        except Exception:
            pass
        log("INFO", "Bot runner exited")
        # Flush any remaining console lines before the process dies.
        _log_stop.set()
        if log_shipper is not None:
            log_shipper.join(timeout=5)


if __name__ == "__main__":
    main()
