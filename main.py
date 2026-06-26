import os
import sys
import time
import asyncio
import threading
import string
import random
import logging
import subprocess
import re
import json
import uuid
import requests as http_requests
from dotenv import load_dotenv
from flask import session

load_dotenv()

# Unique ID for this server boot to invalidate old sessions
BOOT_ID = str(uuid.uuid4())

try:
    from websocket import WebSocketApp as _WSApp
    class _ws_compat:
        WebSocketApp = _WSApp
    ws_client = _ws_compat()
except ImportError:
    try:
        from websocket._app import WebSocketApp as _WSApp
        class _ws_compat:
            WebSocketApp = _WSApp
        ws_client = _ws_compat()
    except ImportError:
        import websocket as ws_client
from datetime import datetime, timedelta, timezone; UTC = timezone.utc
from sqlalchemy import or_
from flask import Flask, render_template, redirect, url_for, request, flash, jsonify, abort
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from flask_wtf.csrf import CSRFProtect, CSRFError
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

discord = None
def _ensure_discord():
    global discord
    if discord is None:
        import discord as _discord
        discord = _discord

logging.basicConfig(stream=sys.stderr, level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

app = Flask(__name__)
app.logger.setLevel(logging.INFO)

# Make SECRET_KEY unique on every startup as requested ("pages restart after every restart")
# This forces all session cookies to be invalidated when the server process restarts.
app.config['SECRET_KEY'] = 'fixed-secret-for-signing' # Use a fixed key for consistency, but invalidate via BOOT_ID
# Actually, randomizing it IS better if we want TOTAL invalidation across all tabs.
app.config['SECRET_KEY'] = os.urandom(32).hex()

app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=2) # Shorter lifetime
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
# Disable Secure on localhost to ensure cookies are saved over HTTP
app.config['SESSION_COOKIE_SECURE'] = False 
app.config['WTF_CSRF_SSL_STRICT'] = False
app.config['WTF_CSRF_TIME_LIMIT'] = 3600
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_recycle': 280,
    'pool_pre_ping': True,
    'pool_size': 5,
    'max_overflow': 10,
}

DISCORD_CLIENT_ID = os.environ.get('DISCORD_CLIENT_ID', '').strip()
DISCORD_CLIENT_SECRET = os.environ.get('DISCORD_CLIENT_SECRET', '').strip()
DISCORD_BOT_TOKEN = os.environ.get('DISCORD_BOT_TOKEN', '')
DISCORD_REDIRECT_URI_PATH = '/auth/discord/callback'
DISCORD_API_BASE = 'https://discord.com/api/v10'
DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize'
DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token'
DISCORD_GUILD_ID = '1473459479189262453'
MOD_LOG_WEBHOOK_URL = os.environ.get('MOD_LOG_WEBHOOK_URL', '')

REQUIRE_LICENSE = os.environ.get('REQUIRE_LICENSE', 'False').lower() in ('true', '1', 't')

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.unauthorized_handler
def unauthorized():
    # If it's a JSON request or API call, return 401
    if request.is_json or \
       request.path.startswith('/api/') or \
       request.headers.get('X-Requested-With') == 'XMLHttpRequest' or \
       'application/json' in request.headers.get('Accept', ''):
        return jsonify({'error': 'Unauthorized', 'message': 'Session expired. Please login again.'}), 401
    
    # Otherwise redirect to login
    return redirect(url_for('login', next=request.url))

@app.route('/api/session-check')
def session_check():
    if current_user.is_authenticated:
        if session.get('boot_id') == BOOT_ID:
            return jsonify({'status': 'ok', 'user': current_user.username})
    return jsonify({'status': 'expired'}), 401

csrf = CSRFProtect(app)

@app.errorhandler(CSRFError)
def csrf_error(e):
    if request.path.startswith('/api/') or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return jsonify({'error': 'CSRF Error', 'message': 'Security token missing or invalid.'}), 403
    
    if current_user.is_authenticated:
        add_log(current_user.username, f'CSRF violation: {request.path}', 'warning', 'security')
    flash('Security token expired or invalid. Please try again.', 'error')
    return redirect(request.referrer or url_for('dashboard'))

@app.after_request
def add_header(response):
    """
    Add headers to both force latest IE rendering engine or Chrome Frame,
    and also to cache the rendered page for 10 minutes.
    """
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

limiter = Limiter(get_remote_address, app=app, default_limits=["2000 per hour"], storage_uri="memory://")

console_logs = []


@app.before_request
def verify_boot_session():
    # Force logout if session is from a previous server boot
    if current_user.is_authenticated:
        if session.get('boot_id') != BOOT_ID:
            app.logger.info(f"[Session] Invalid boot_id: {session.get('boot_id')} != {BOOT_ID}. Logging out.")
            session.clear()
            logout_user()
            # If not an AJAX request, redirect to login
            if not (request.path.startswith('/api/') or request.headers.get('X-Requested-With') == 'XMLHttpRequest'):
                flash('Your session has expired due to a server restart.', 'info')
                return redirect(url_for('login'))

@app.before_request
def check_license_and_plan():
    if not REQUIRE_LICENSE:
        return

    # Allow access to static files, auth routes, and health check
    if request.path.startswith('/static/') or \
       request.path.startswith('/auth/') or \
       request.path in ('/healthz', '/login', '/register', '/enter_license', '/logout'):
        return

    if current_user.is_authenticated:
        # RomeoXLover check (if they applied it manually or via key before)
        # But primarily we check if they have any active plan or are admin
        if current_user.role == 'admin' or (current_user.plan != 'none' and not current_user.is_plan_expired):
            return
        
        # If authenticated but no active plan/not admin, must enter license
        return redirect(url_for('enter_license'))

@app.before_request
def check_plan_expiry():
    if current_user.is_authenticated and current_user.is_plan_expired:
        old_plan = current_user.plan
        current_user.plan = 'none'
        current_user.plan_expires_at = None
        db.session.commit()
        add_log(current_user.discord_username or current_user.username, f'Plan expired: {old_plan} -> none', 'warning', 'system')
    if current_user.is_authenticated and current_user.is_donut_expired:
        current_user.has_donut = False
        current_user.donut_expires_at = None
        db.session.commit()
        add_log(current_user.discord_username or current_user.username, 'Donut add-on expired', 'warning', 'system')


@app.context_processor
def inject_user_settings():
    if current_user and current_user.is_authenticated:
        user_settings = UserSettings.query.filter_by(user_id=current_user.id).first()
        if not user_settings:
            user_settings = UserSettings(user_id=current_user.id)
            db.session.add(user_settings)
            db.session.commit()
        return dict(user_settings=user_settings, scheduler_running=scheduler_status.get('running', False))
    return dict(user_settings=None, scheduler_running=False)
def clean_channel_id(channel_id_str):
    if not channel_id_str:
        return ""
    channel_id_str = channel_id_str.strip()
    if 'discord.com/channels/' in channel_id_str:
        parts = channel_id_str.rstrip('/').split('/')
        if parts:
            channel_id_str = parts[-1]
    import re
    digits = re.findall(r'\d+', channel_id_str)
    if digits:
        return digits[0]
    return channel_id_str


def add_log(user, action, level='info', source='system'):
    entry = {
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "user": user,
        "action": action,
        "level": level,
        "source": source
    }
    console_logs.append(entry)
    if len(console_logs) > 500:
        console_logs.pop(0)
    print(f"[{entry['time']}] [{source.upper()}] {user}: {action}", flush=True)


def generate_referral_code():
    chars = string.ascii_lowercase + string.digits
    while True:
        code = ''.join(random.choices(chars, k=8))
        if not User.query.filter_by(referral_code=code).first():
            return code


def fetch_discord_user(token):
    def parse_data(data):
        avatar_hash = data.get('avatar')
        user_id = data.get('id')
        username = data.get('username', '')
        display_name = data.get('global_name') or username
        if avatar_hash:
            avatar_url = f"https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png?size=128"
        else:
            default_index = (int(user_id) >> 22) % 6
            avatar_url = f"https://cdn.discordapp.com/embed/avatars/{default_index}.png"
        return {
            'discord_id': user_id,
            'discord_username': display_name,
            'avatar_url': avatar_url
        }

    try:
        # Try 1: Token as-is
        resp = http_requests.get('https://discord.com/api/v10/users/@me', headers={'Authorization': token}, timeout=10)
        if resp.status_code == 200:
            return parse_data(resp.json())

        # Try 2: If token doesn't have "Bot " prefix, try adding it
        if not token.startswith('Bot '):
            resp = http_requests.get('https://discord.com/api/v10/users/@me', headers={'Authorization': f'Bot {token}'}, timeout=10)
            if resp.status_code == 200:
                return parse_data(resp.json())

        # Try 3: Try adding "Bearer " prefix (for OAuth tokens)
        if not token.startswith('Bearer '):
            resp = http_requests.get('https://discord.com/api/v10/users/@me', headers={'Authorization': f'Bearer {token}'}, timeout=10)
            if resp.status_code == 200:
                return parse_data(resp.json())

        # Try 4: If token contains "Bot ", strip it just in case
        if 'Bot ' in token:
            stripped = token.replace('Bot ', '')
            resp = http_requests.get('https://discord.com/api/v10/users/@me', headers={'Authorization': stripped}, timeout=10)
            if resp.status_code == 200:
                return parse_data(resp.json())

        return None
    except Exception:
        return None


active_bot_threads = {}
bot_stop_events = {}
active_bot_clients = {}
bot_threads_lock = threading.Lock()
rotation_locks = {}
rotation_locks_lock = threading.Lock()
donut_verifier_jobs = {}
donut_verifier_lock = threading.Lock()
scheduler_status = {'running': False, 'last_check': None, 'pending_messages': 0}


def check_blocked_words(text, blocked_words_str):
    if not blocked_words_str:
        return False
    words = [w.strip().lower() for w in blocked_words_str.replace('\n', ',').split(',') if w.strip()]
    text_lower = text.lower()
    for word in words:
        if word in text_lower:
            return True
    return False


def get_ai_reply(conversation_history, groq_api_key, system_prompt):
    if not groq_api_key:
        return None
    messages = [{"role": "system", "content": system_prompt or "You are a helpful assistant."}]
    for entry in conversation_history:
        messages.append({"role": entry["role"], "content": entry["content"]})
    try:
        resp = http_requests.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {groq_api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'llama-3.3-70b-versatile',
                'messages': messages,
                'max_tokens': 256,
                'temperature': 0.9
            },
            timeout=30
        )
        if resp.status_code == 200:
            data = resp.json()
            return data['choices'][0]['message']['content']
        return None
    except Exception:
        return None


def parse_channel_config(config_text, max_channels=1):
    channels = []
    if not config_text:
        return channels
    for line in config_text.strip().split('\n'):
        line = line.strip()
        if not line:
            continue
        parts = line.split(':', 2)
        if len(parts) >= 3:
            try:
                channel_id = parts[0].strip()
                delay = int(parts[1].strip())
                message = parts[2].strip()
                if channel_id and delay > 0 and message:
                    channels.append({
                        'channel_id': int(channel_id),
                        'delay': max(delay, 15),
                        'message': message
                    })
            except (ValueError, IndexError):
                continue
        if len(channels) >= max_channels:
            break
    return channels


def rotate_to_next_bot(current_bot_id, user_id, username):
    with rotation_locks_lock:
        if user_id not in rotation_locks:
            rotation_locks[user_id] = threading.Lock()
        user_lock = rotation_locks[user_id]

    if not user_lock.acquire(blocking=False):
        return False

    try:
        with app.app_context():
            next_bot = Bot.query.filter(
                Bot.user_id == user_id,
                Bot.id != current_bot_id,
                Bot.is_active == False
            ).order_by(Bot.id.asc()).first()

            if next_bot:
                current_bot = db.session.get(Bot, current_bot_id)
                current_name = current_bot.name if current_bot else str(current_bot_id)
                if current_bot:
                    current_bot.is_active = False
                next_bot.is_active = True
                db.session.commit()
                add_log(username, f'Token Switcher: Switching from {current_name} to {next_bot.name}', 'warning', 'system')
                start_bot_worker(next_bot.id, user_id)
                return True
            else:
                add_log(username, 'Token Switcher: No available inactive bots to switch to', 'warning', 'system')
                return False
    except Exception as e:
        add_log(username, f'Token Switcher: Error during switch — {str(e)}', 'error', 'system')
        return False
    finally:
        user_lock.release()


BAN_TIMEOUT_CHANNELS = {
    'donutsmp': '1474863252390412472',
    'roblox': '1474863375086391367',
    'universal': '1474863446745940029',
}

def _get_ban_timeout_channel(server_name):
    name_lower = (server_name or '').lower()
    if 'donutsmp' in name_lower or 'donut smp' in name_lower or 'donut' in name_lower:
        return BAN_TIMEOUT_CHANNELS['donutsmp']
    if 'roblox' in name_lower or 'blox' in name_lower or 'robux' in name_lower:
        return BAN_TIMEOUT_CHANNELS['roblox']
    return BAN_TIMEOUT_CHANNELS['universal']

def _send_ban_timeout_embed(event_type, server_name, bot_discord_name, bot_discord_id, hoster_name, hoster_id, timeout_until=None):
    bot_token = DISCORD_BOT_TOKEN
    if not bot_token:
        return
    channel_id = _get_ban_timeout_channel(server_name)
    color = 0xFF0000 if event_type == 'banned' else 0xFFA500
    title = "Bot Banned" if event_type == 'banned' else "Bot Timed Out"
    fields = [
        {"name": "Server", "value": server_name or 'Unknown', "inline": True},
        {"name": "Event", "value": event_type.capitalize(), "inline": True},
        {"name": "Bot Account", "value": bot_discord_name or 'Unknown', "inline": True},
        {"name": "Bot User ID", "value": f"`{bot_discord_id}`" if bot_discord_id else 'Unknown', "inline": True},
        {"name": "Hoster", "value": hoster_name or 'Unknown', "inline": True},
        {"name": "Hoster User ID", "value": f"`{hoster_id}`" if hoster_id else 'Unknown', "inline": True},
    ]
    if timeout_until and event_type == 'timed out':
        fields.append({"name": "Timeout Until", "value": timeout_until, "inline": True})
    embed = {
        "title": title,
        "color": color,
        "fields": fields,
        "timestamp": datetime.now(UTC).isoformat()
    }
    headers = {"Authorization": f"Bot {bot_token}", "Content-Type": "application/json"}
    try:
        http_requests.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            json={"embeds": [embed]},
            headers=headers,
            timeout=10
        )
    except Exception:
        pass


def _dm_webhook_log(webhook_url, direction, author_tag, content, bot_display):
    """Send a DM message log to a webhook."""
    if not webhook_url:
        return
    try:
        import requests as _req
        icon = '⬇️' if direction == 'incoming' else '⬆️'
        _req.post(webhook_url, json={
            'content': f"{icon} **[{author_tag}]**: {content}",
            'username': bot_display,
        }, timeout=8)
    except Exception:
        pass


def bot_worker(bot_id, user_id, stop_event):
    _ensure_discord()
    username = ''
    bot_name = ''
    loop = None
    client = None
    try:
        with app.app_context():
            bot_obj = db.session.get(Bot, bot_id)
            user_obj = db.session.get(User, user_id)
            if not bot_obj or not user_obj:
                return

            bot_name = bot_obj.name
            bot_token = bot_obj.token
            username = user_obj.username
            hoster_discord_id = user_obj.discord_id or str(user_id)
            hoster_display = user_obj.discord_username or user_obj.username
            max_ch = user_obj.max_channels
            can_ai = user_obj.can_use_ai
            can_blocked = user_obj.can_use_blocked_words

            effective = get_effective_settings(bot_id, user_id)
            settings = UserSettings.query.filter_by(user_id=user_id).first()
            channel_config = effective['channel_config'] or ''
            first_dm = effective['first_dm_message'] or ''
            blocked_words = effective['blocked_words'] if can_blocked else ''
            groq_api_key = effective['groq_api_key'] if can_ai else ''
            ai_system_prompt = effective['ai_system_prompt'] if can_ai else ''
            auto_token_rotation = settings.auto_token_rotation if settings else False
            smart_send = effective['smart_send'] if user_obj.plan == 'pro' else False
            smart_send_min_users = effective['smart_send_min_users'] if user_obj.plan == 'pro' else 3

            db.session.close()

        channels = parse_channel_config(channel_config, max_ch) if channel_config else []
        ai_enabled = bool(can_ai and groq_api_key)

        # Validate token before attempting to login
        add_log(username, f'Bot {bot_name}: Starting token validation...', 'info', 'selfbot')
        logging.info(f"[Bot {bot_id}] Starting token validation")
        
        token_validated = False
        is_bot_token = False
        
        for attempt in range(3):
            try:
                import requests
                # 1. Try as a selfbot/user token first (as-is)
                validate_resp = requests.get(
                    'https://discord.com/api/v10/users/@me',
                    headers={
                        'Authorization': bot_token, 
                        'User-Agent': 'DiscordBot (romeo-app, 1.0)'
                    },
                    timeout=15
                )
                if validate_resp.status_code == 200:
                    token_data = validate_resp.json()
                    add_log(username, f'Bot {bot_name}: Token validated for {token_data.get("username", "unknown")}', 'info', 'selfbot')
                    logging.info(f"[Bot {bot_id}] Token validated as user token: {validate_resp.text[:100]}")
                    token_validated = True
                    is_bot_token = False
                    break
                
                # 2. Try as a bot token if it failed as-is and does not already start with "Bot "
                if validate_resp.status_code == 401 and not bot_token.startswith('Bot '):
                    validate_resp_bot = requests.get(
                        'https://discord.com/api/v10/users/@me',
                        headers={
                            'Authorization': f'Bot {bot_token}', 
                            'User-Agent': 'DiscordBot (romeo-app, 1.0)'
                        },
                        timeout=15
                    )
                    if validate_resp_bot.status_code == 200:
                        token_data = validate_resp_bot.json()
                        add_log(username, f'Bot {bot_name}: Token validated for Bot {token_data.get("username", "unknown")}', 'info', 'selfbot')
                        logging.info(f"[Bot {bot_id}] Token validated as bot token: {validate_resp_bot.text[:100]}")
                        token_validated = True
                        is_bot_token = True
                        break

                if validate_resp.status_code == 401:
                    add_log(username, f'Bot {bot_name}: Token invalid (401) from API', 'error', 'selfbot')
                    logging.error(f"[Bot {bot_id}] Token validation 401: {validate_resp.text[:100]}")
                    if auto_token_rotation:
                        rotate_to_next_bot(bot_id, user_id, username)
                    return
                else:
                    add_log(username, f'Bot {bot_name}: API error {validate_resp.status_code} - attempt {attempt+1}/3', 'warning', 'selfbot')
                    logging.warning(f"[Bot {bot_id}] API error {validate_resp.status_code}: {validate_resp.text[:100]}")
                    import time
                    time.sleep(5)
            except Exception as e:
                add_log(username, f'Bot {bot_name}: Validation error - {str(e)[:50]}', 'error', 'selfbot')
                logging.error(f"[Bot {bot_id}] Token validation error: {e}")
                import time
                time.sleep(3)
        
        if not token_validated:
            add_log(username, f'Bot {bot_name}: Token validation failed after retries', 'error', 'selfbot')
            logging.error(f"[Bot {bot_id}] Token validation failed after 3 attempts")
            return
        
        add_log(username, f'Bot {bot_name}: Attempting discord.py login...', 'info', 'selfbot')
        logging.info(f"[Bot {bot_id}] Token validation passed, proceeding to discord.py login")

        if not channels and not first_dm and not ai_enabled:
            add_log(username, f'Bot {bot_name}: Warning - running without channel config, first DM, or AI set up. (Idle mode)', 'warning', 'selfbot')

        class SelfBot(discord.Client):
            def __init__(self):
                if hasattr(discord, 'Intents'):
                    intents = discord.Intents.default()
                    intents.messages = True
                    intents.guilds = True
                    intents.relationships = True
                    intents.presences = True
                    try:
                        intents.message_content = True
                    except AttributeError:
                        pass
                    super().__init__(intents=intents)
                else:
                    super().__init__()
                self.first_dm_sent = set()
                self.dm_history = {}
                self.notified_ban_channels = set()
                self.guild_map = {}
                self._processing_lock = {}  # uid -> True, prevents 2nd message race
                self.webhook_url = ''
                self.webhook_on_dm = True

            async def spam_channel(self, config):
                ch_id = config['channel_id']
                delay = max(config['delay'], 15)
                msg = config['message']
                consecutive_errors = 0

                while not stop_event.is_set():
                    ch = self.get_channel(ch_id)
                    if ch:
                        if smart_send:
                            recent_authors = set()
                            try:
                                async for hist_msg in ch.history(limit=50):
                                    if hist_msg.author != self.user:
                                        age = (datetime.now(UTC).replace(tzinfo=None) - hist_msg.created_at.replace(tzinfo=None)).total_seconds()
                                        if age <= delay:
                                            recent_authors.add(hist_msg.author.id)
                                        else:
                                            break
                            except Exception:
                                pass
                            if len(recent_authors) < smart_send_min_users:
                                await asyncio.sleep(15)
                                continue
                            add_log(username, f'Bot {bot_name}: Smart Send — {len(recent_authors)} users active in #{ch.name}, sending', 'info', 'selfbot')
                        try:
                            await ch.send(msg)
                            add_log(username, f'Bot {bot_name}: Sent message to #{ch.name}', 'info', 'selfbot')
                            consecutive_errors = 0
                        except discord.HTTPException as e:
                            consecutive_errors += 1
                            if e.status == 429:
                                retry_after = max(float(e.retry_after if hasattr(e, 'retry_after') else 10), 10)
                                add_log(username, f'Bot {bot_name}: Rate limited in #{ch.name}, waiting {retry_after}s', 'warning', 'selfbot')
                                await asyncio.sleep(retry_after)
                                await asyncio.sleep(delay)
                                continue
                            elif e.status == 401:
                                add_log(username, f'Bot {bot_name}: Invalid token (401)', 'error', 'selfbot')
                                if auto_token_rotation:
                                    rotate_to_next_bot(bot_id, user_id, username)
                                await self.close()
                                return
                            elif e.status == 403:
                                add_log(username, f'Bot {bot_name}: No permission in channel {ch_id} — possible timeout', 'error', 'selfbot')
                                try:
                                    guild_name = ch.guild.name if ch and hasattr(ch, 'guild') and ch.guild else 'Unknown'
                                    bot_display = self.user.name if self.user else bot_name
                                    bot_uid = str(self.user.id) if self.user else ''
                                    timeout_str = 'Unknown duration'
                                    if ch and hasattr(ch, 'guild') and ch.guild:
                                        me = ch.guild.get_member(self.user.id) if self.user else None
                                        if me and hasattr(me, 'timed_out_until') and me.timed_out_until:
                                            timeout_str = me.timed_out_until.strftime('%Y-%m-%d %H:%M:%S UTC')
                                    threading.Thread(target=_send_ban_timeout_embed, args=(
                                        'timed out', guild_name, bot_display, bot_uid, hoster_display, hoster_discord_id, timeout_str
                                    ), daemon=True).start()
                                except Exception:
                                    pass
                                return
                            else:
                                add_log(username, f'Bot {bot_name}: Error in channel {ch_id} - {e}', 'error', 'selfbot')
                            if consecutive_errors >= 5:
                                add_log(username, f'Bot {bot_name}: Too many errors in #{ch.name}, stopping channel', 'error', 'selfbot')
                                return
                        except Exception as e:
                            consecutive_errors += 1
                            add_log(username, f'Bot {bot_name}: Error in channel {ch_id} - {str(e)}', 'error', 'selfbot')
                            if consecutive_errors >= 5:
                                add_log(username, f'Bot {bot_name}: Too many errors in #{ch.name}, stopping channel', 'error', 'selfbot')
                                return
                    else:
                        if ch_id not in self.notified_ban_channels:
                            self.notified_ban_channels.add(ch_id)
                            guild_name = self.guild_map.get(ch_id, 'Unknown')
                            add_log(username, f'Bot {bot_name}: Channel {ch_id} not found in "{guild_name}" — possible ban', 'warning', 'selfbot')
                            try:
                                bot_display = self.user.name if self.user else bot_name
                                bot_uid = str(self.user.id) if self.user else ''
                                threading.Thread(target=_send_ban_timeout_embed, args=(
                                    'banned', guild_name, bot_display, bot_uid, hoster_display, hoster_discord_id
                                ), daemon=True).start()
                            except Exception:
                                pass
                        return
                    await asyncio.sleep(delay)

            async def on_guild_remove(self, guild):
                guild_name = guild.name if guild else 'Unknown'
                add_log(username, f'Bot {bot_name}: Removed from server "{guild_name}" — likely banned', 'error', 'selfbot')
                bot_display = self.user.name if self.user else bot_name
                bot_uid = str(self.user.id) if self.user else ''
                threading.Thread(target=_send_ban_timeout_embed, args=(
                    'banned', guild_name, bot_display, bot_uid, hoster_display, hoster_discord_id
                ), daemon=True).start()

            async def force_accept_friend(self, user_id, user_name):
                import discord
                import discord.enums
                from discord.http import Route

                async def _wait_for_rate_limit():
                    """Discord may rate limit relationship changes. Retry with backoff."""
                    max_wait = 5
                    for attempt in range(max_wait):
                        try:
                            await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s, 8s, 16s
                            return True
                        except asyncio.CancelledError:
                            return False
                    return False

                # ── STEP 1: Pre-open DM channel ──────────────────────────────────────────
                # Discord requires a relationship context before accepting friend requests.
                # Opening a DM first signals mutual server context, which removes the
                # "cannot confirm" safety block (HTTP 400 / code 80013).
                user_obj = None
                try:
                    user_obj = await self.fetch_user(user_id)
                except Exception:
                    pass

                if user_obj:
                    try:
                        dm_ch = await user_obj.create_dm()
                        add_log(username, f'Bot {bot_name}: Opened DM channel with {user_name} to establish context', 'info', 'selfbot')
                        # Give Discord a moment to register the DM relationship
                        await asyncio.sleep(1.5)
                    except discord.HTTPException as dm_err:
                        add_log(username, f'Bot {bot_name}: Could not open DM with {user_name}: {dm_err}', 'warning', 'selfbot')
                        await asyncio.sleep(0.5)
                else:
                    add_log(username, f'Bot {bot_name}: Could not fetch user object for {user_name}, trying raw accept', 'warning', 'selfbot')

                # ── STEP 2: Try standard accept first ───────────────────────────────────
                for attempt in range(3):
                    if attempt > 0:
                        ok = await _wait_for_rate_limit()
                        if not ok:
                            return False
                    try:
                        await self.http.add_relationship(user_id, action=discord.enums.RelationshipAction.accept_request, type=1)
                        add_log(username, f'Bot {bot_name}: Accepted friend request from {user_name} (method: add_relationship)', 'info', 'selfbot')
                        return True
                    except discord.HTTPException as e:
                        if e.status == 429:
                            retry_after = getattr(e, 'retry_after', 2)
                            add_log(username, f'Bot {bot_name}: Rate limited on friend accept, waiting {retry_after:.1f}s...', 'warning', 'selfbot')
                            await asyncio.sleep(float(retry_after))
                            continue
                        if e.code == 80013:
                            # Still blocked — try bypass methods below
                            break
                        add_log(username, f'Bot {bot_name}: HTTP error on friend accept [{e.code}]: {e}', 'warning', 'selfbot')
                        break
                    except Exception as e:
                        add_log(username, f'Bot {bot_name}: Unexpected error on add_relationship: {e}', 'warning', 'selfbot')
                        break

                # ── STEP 3: Bypass safety confirmation ────────────────────────────────────
                add_log(username, f'Bot {bot_name}: Standard accept blocked for {user_name} (80013), attempting bypass...', 'warning', 'selfbot')

                # Try creating DM again now that the relationship state may have changed
                if user_obj:
                    try:
                        await user_obj.create_dm()
                        await asyncio.sleep(1)
                    except Exception:
                        pass

                payloads = [
                    {"type": 1, "confirm_stranger_request": True},
                    {"type": 1, "confirm_stranger_request": True, "from_friend_suggestion": False},
                    {"type": 1},
                    {"type": 1, "data": {}},
                    {"type": 1, "data": {"friend_token": None}},
                ]

                r = Route('PUT', '/users/@me/relationships/{user_id}', user_id=user_id)

                for payload in payloads:
                    for attempt in range(3):
                        if attempt > 0:
                            ok = await _wait_for_rate_limit()
                            if not ok:
                                break
                        try:
                            await self.http.request(r, json=payload)
                            add_log(username, f'Bot {bot_name}: Bypassed and accepted {user_name} (payload: {payload})', 'info', 'selfbot')
                            return True
                        except discord.HTTPException as e_inner:
                            if e_inner.status == 429:
                                retry_after = getattr(e_inner, 'retry_after', 2)
                                await asyncio.sleep(float(retry_after))
                                continue
                            break
                        except Exception:
                            break
                    await asyncio.sleep(0.5)

                add_log(username, f'Bot {bot_name}: All accept methods exhausted for {user_name}', 'error', 'selfbot')
                return False

            async def on_ready(self):
                import discord
                display = self.user.name if self.user else bot_name
                add_log(username, f'Bot {bot_name}: {display} is live — Auto-accepting friends & smart DMs ON', 'info', 'selfbot')

                # Explicitly set bot presence to online
                try:
                    await self.change_presence(status=discord.Status.online)
                    add_log(username, f'Bot {bot_name}: Status set to online', 'info', 'selfbot')
                except Exception as e:
                    add_log(username, f'Bot {bot_name}: Could not set presence: {e}', 'warning', 'selfbot')

                # Auto-accept existing pending friend requests on startup
                try:
                    import discord.enums
                    friends_accepted = 0
                    rels = getattr(self, 'relationships', [])
                    if not rels and self.user:
                        rels = getattr(self.user, 'relationships', [])
                    
                    for rel in rels:
                        if rel.type == discord.RelationshipType.incoming_request:
                            # Add a small delay to look more human and avoid safety triggers
                            await asyncio.sleep(3)
                            success = await self.force_accept_friend(rel.user.id, rel.user.name)
                            if success:
                                friends_accepted += 1

                    if friends_accepted > 1:
                        add_log(username, f'Bot {bot_name}: Accepted {friends_accepted} pending friend requests on startup', 'info', 'selfbot')
                    elif friends_accepted == 1:
                        add_log(username, f'Bot {bot_name}: Accepted 1 pending friend request on startup', 'info', 'selfbot')
                except Exception as e:
                    add_log(username, f'Bot {bot_name}: Startup friend acceptance error: {e}', 'warning', 'selfbot')

                for g in self.guilds:
                    for c in g.channels:
                        self.guild_map[c.id] = g.name

                with app.app_context():
                    b = db.session.get(Bot, bot_id)
                    if b and self.user:
                        b.discord_id = str(self.user.id)
                        b.discord_username = self.user.display_name or self.user.name
                        avatar = self.user.avatar
                        if avatar:
                            b.avatar_url = str(avatar.url)
                        else:
                            default_index = (self.user.id >> 22) % 6
                            b.avatar_url = f"https://cdn.discordapp.com/embed/avatars/{default_index}.png"
                        db.session.commit()
                    db.session.close()

                for cfg in channels:
                    self.loop.create_task(self.spam_channel(cfg))

            async def on_relationship_add(self, relationship):
                if relationship.type == discord.RelationshipType.incoming_request:
                    await self.force_accept_friend(relationship.user.id, relationship.user.name)

            def save_dm(self, discord_uid, discord_uname, content, outgoing=False):
                try:
                    with app.app_context():
                        dm = DMMessage(
                            bot_id=bot_id,
                            user_id=user_id,
                            discord_user_id=str(discord_uid),
                            discord_username=discord_uname,
                            content=content,
                            is_outgoing=outgoing
                        )
                        db.session.add(dm)
                        db.session.commit()
                        db.session.close()
                except Exception:
                    pass

            async def on_message(self, message):
                if message.author == self.user:
                    return

                if isinstance(message.channel, discord.DMChannel):
                    uid = message.author.id
                    content = message.content
                    author_name = str(message.author)

                    # Per-user lock: ignore subsequent messages while still processing the first one.
                    # This fixes the race condition where the 2nd message beats a delayed first-DM reply.
                    if self._processing_lock.get(uid):
                        return
                    self._processing_lock[uid] = True

                    try:
                        with app.app_context():
                            is_blacklisted = BlacklistedUser.query.filter_by(
                                user_id=user_id, discord_user_id=str(uid)
                            ).first() is not None
                        if is_blacklisted:
                            add_log(username, f'Bot {bot_name}: Blacklisted user {author_name}, ignoring', 'warning', 'selfbot')
                            self._processing_lock.pop(uid, None)
                            return
                    except Exception:
                        pass

                    if blocked_words and check_blocked_words(content, blocked_words):
                        add_log(username, f'Bot {bot_name}: Blocked word from {author_name} — deleting all msgs & blocking', 'warning', 'selfbot')
                        try:
                            with app.app_context():
                                deleted_count = DMMessage.query.filter_by(bot_id=bot_id, discord_user_id=str(uid)).delete()
                                DMMessage.query.filter(
                                    DMMessage.bot_id == bot_id,
                                    DMMessage.user_id == user_id,
                                    DMMessage.discord_user_id == str(uid)
                                ).delete()
                                existing_bl = BlacklistedUser.query.filter_by(user_id=user_id, discord_user_id=str(uid)).first()
                                if not existing_bl:
                                    bl = BlacklistedUser(
                                        user_id=user_id,
                                        discord_user_id=str(uid),
                                        discord_username=author_name,
                                        reason='Blocked word auto-ban'
                                    )
                                    db.session.add(bl)
                                db.session.commit()
                                db.session.close()
                            add_log(username, f'Bot {bot_name}: Deleted all DMs from {author_name} ({deleted_count} msgs) and added to blacklist', 'warning', 'selfbot')
                        except Exception as e:
                            add_log(username, f'Bot {bot_name}: Failed to auto-block {author_name} - {e}', 'error', 'selfbot')
                        try:
                            dm_ch = message.channel
                            async for old_msg in dm_ch.history(limit=100):
                                if old_msg.author == self.user:
                                    try:
                                        await old_msg.delete()
                                    except Exception:
                                        pass
                            add_log(username, f'Bot {bot_name}: Deleted bot messages from DM with {author_name}', 'info', 'selfbot')
                        except Exception as e:
                            add_log(username, f'Bot {bot_name}: Could not delete DM history with {author_name} - {e}', 'warning', 'selfbot')
                        try:
                            await message.author.block()
                            add_log(username, f'Bot {bot_name}: Discord-blocked {author_name}', 'info', 'selfbot')
                        except Exception as e:
                            add_log(username, f'Bot {bot_name}: Could not Discord-block {author_name} - {e}', 'warning', 'selfbot')
                        if uid in self.dm_history:
                            del self.dm_history[uid]
                        self.first_dm_sent.discard(uid)
                        self._processing_lock.pop(uid, None)
                        return

                    self.save_dm(uid, author_name, content, outgoing=False)

                    # Log incoming DM to webhook
                    if self.webhook_url and self.webhook_on_dm:
                        bot_display = f"Bot {bot_name}"
                        threading.Thread(target=_dm_webhook_log, daemon=True, args=(
                            self.webhook_url, 'incoming', author_name, content, bot_display
                        )).start()

                    live_first_dm = first_dm
                    live_ai_enabled = ai_enabled
                    live_groq_key = groq_api_key
                    live_ai_prompt = ai_system_prompt
                    try:
                        with app.app_context():
                            live_eff = get_effective_settings(bot_id, user_id)
                            live_user = db.session.get(User, user_id)
                            if live_user and live_eff:
                                live_can_ai = live_user.can_use_ai
                                live_first_dm = live_eff.get('first_dm_message') or first_dm
                                live_groq_key = live_eff.get('groq_api_key', '') if live_can_ai else ''
                                live_ai_prompt = live_eff.get('ai_system_prompt', '') if live_can_ai else ''
                                live_ai_enabled = bool(live_can_ai and live_groq_key)
                            db.session.close()
                    except Exception as e:
                        add_log(username, f'Bot {bot_name}: Could not reload live settings, using startup values', 'warning', 'selfbot')

                    if uid not in self.first_dm_sent:
                        self.first_dm_sent.add(uid)
                        if live_first_dm:
                            import json
                            messages_to_send = []
                            try:
                                # Try parsing as JSON for multi-message support
                                data = json.loads(live_first_dm)
                                if isinstance(data, list):
                                    messages_to_send = data
                                else:
                                    messages_to_send = [{"message": str(data), "delay": 3}]
                            except:
                                # Fallback to single message
                                messages_to_send = [{"message": live_first_dm, "delay": 3}]

                            async def send_sequence():
                                try:
                                    for i, msg_obj in enumerate(messages_to_send):
                                        msg_text = msg_obj.get('message', '').strip()
                                        if not msg_text: continue
                                        
                                        delay = float(msg_obj.get('delay', 3 if i == 0 else 0))
                                        if delay > 0:
                                            if i == 0:
                                                add_log(username, f'Bot {bot_name}: First DM from {author_name} — sending in {delay}s', 'info', 'selfbot')
                                            await asyncio.sleep(delay)
                                        
                                        try:
                                            await message.channel.send(msg_text)
                                            add_log(username, f'Bot {bot_name}: Sent {"first" if i == 0 else "follow-up"} DM reply to {author_name}', 'info', 'selfbot')
                                            self.save_dm(uid, author_name, msg_text, outgoing=True)
                                        except Exception as e:
                                            add_log(username, f'Bot {bot_name}: Failed to send DM - {e}', 'error', 'selfbot')
                                finally:
                                    # Release the processing lock so the next message is handled
                                    self._processing_lock.pop(uid, None)
                            
                            asyncio.create_task(send_sequence())

                            if uid not in self.dm_history:
                                self.dm_history[uid] = []
                            self.dm_history[uid].append({"role": "user", "content": content})
                            self.dm_history[uid].append({"role": "assistant", "content": live_first_dm})
                        return

                    if live_ai_enabled:
                        if uid not in self.dm_history:
                            self.dm_history[uid] = []
                        self.dm_history[uid].append({"role": "user", "content": content})

                        if len(self.dm_history[uid]) > 40:
                            self.dm_history[uid] = self.dm_history[uid][-30:]

                        add_log(username, f'Bot {bot_name}: Follow-up DM from {author_name} — generating AI reply...', 'info', 'selfbot')
                        await asyncio.sleep(1)
                        reply = get_ai_reply(self.dm_history[uid], live_groq_key, live_ai_prompt)

                        if reply:
                            try:
                                await message.channel.send(reply)
                                add_log(username, f'Bot {bot_name}: AI reply to {author_name} → {reply[:80]}', 'info', 'selfbot')
                                self.dm_history[uid].append({"role": "assistant", "content": reply})
                                self.save_dm(uid, author_name, reply, outgoing=True)
                                # Log AI reply to webhook
                                if self.webhook_url and self.webhook_on_dm:
                                    bot_display = f"Bot {bot_name}"
                                    threading.Thread(target=_dm_webhook_log, daemon=True, args=(
                                        self.webhook_url, 'outgoing', bot_display, reply, bot_display
                                    )).start()
                            except Exception as e:
                                add_log(username, f'Bot {bot_name}: Failed to send AI reply - {e}', 'error', 'selfbot')
                        else:
                            add_log(username, f'Bot {bot_name}: AI reply failed for {author_name} (check Groq API key)', 'warning', 'selfbot')

                        # Release the processing lock after AI reply is sent
                        self._processing_lock.pop(uid, None)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        client = SelfBot()
        client.webhook_url = effective.get('webhook_url') or ''
        client.webhook_on_dm = effective.get('webhook_on_dm', True)

        with bot_threads_lock:
            active_bot_clients[str(bot_id)] = {'client': client, 'loop': loop}

        max_reconnect = 5
        reconnect_count = 0

        async def run_client():
            nonlocal reconnect_count, client
            while not stop_event.is_set() and reconnect_count <= max_reconnect:
                reconnect_count += 1
                try:
                    await client.start(bot_token, reconnect=False)
                except discord.LoginFailure as e:
                    add_log(username, f'Bot {bot_name}: Login failed — invalid token [{e}]', 'error', 'selfbot')
                    logging.error(f"[Bot {bot_id}] discord.LoginFailure: {e}")
                    if auto_token_rotation:
                        rotate_to_next_bot(bot_id, user_id, username)
                    else:
                        with app.app_context():
                            b = db.session.get(Bot, bot_id)
                            if b:
                                b.is_active = False
                                db.session.commit()
                            db.session.close()
                    return
                except Exception as e:
                    err_str = str(e)
                    err_type = type(e).__name__
                    # Enhanced logging for debugging
                    add_log(username, f'Bot {bot_name}: Login error [{err_type}] — {err_str}', 'error', 'selfbot')
                    logging.error(f"[Bot {bot_id}] Login error: {err_type}: {err_str}")
                    import traceback
                    logging.error(f"[Bot {bot_id}] Full traceback: {traceback.format_exc()}")
                    
                    if '401' in err_str or 'Unauthorized' in err_str or 'invalid' in err_str.lower() or 'Bad Intentions' in err_str:
                        if auto_token_rotation:
                            rotate_to_next_bot(bot_id, user_id, username)
                        else:
                            with app.app_context():
                                b = db.session.get(Bot, bot_id)
                                if b:
                                    b.is_active = False
                                    db.session.commit()
                                db.session.close()
                        return

                    if stop_event.is_set():
                        return

                    if reconnect_count <= max_reconnect:
                        delay = min(5 * reconnect_count, 30)
                        add_log(username, f'Bot {bot_name}: Disconnected ({err_str[:100]}) — reconnecting in {delay}s (attempt {reconnect_count}/{max_reconnect})', 'warning', 'selfbot')
                        await asyncio.sleep(delay)
                        client = SelfBot()
                        with bot_threads_lock:
                            active_bot_clients[str(bot_id)] = {'client': client, 'loop': loop}
                    else:
                        add_log(username, f'Bot {bot_name}: Max reconnect attempts reached, stopping', 'error', 'selfbot')
                        with app.app_context():
                            b = db.session.get(Bot, bot_id)
                            if b:
                                b.is_active = False
                                db.session.commit()
                            db.session.close()
                        return

        async def monitor_stop():
            while not stop_event.is_set():
                await asyncio.sleep(1)
            if client and not client.is_closed():
                await client.close()

        async def main():
            await asyncio.gather(run_client(), monitor_stop())

        loop.run_until_complete(main())

    except Exception as e:
        if username:
            add_log(username, f'Bot {bot_name}: Crashed — {str(e)}', 'error', 'selfbot')
    finally:
        if loop and not loop.is_closed():
            loop.close()
        add_log(username, f'Bot {bot_name}: Stopped', 'info', 'selfbot')
        with bot_threads_lock:
            active_bot_threads.pop(str(bot_id), None)
            bot_stop_events.pop(str(bot_id), None)
            active_bot_clients.pop(str(bot_id), None)


def start_bot_worker(bot_id, user_id):
    stop_key = str(bot_id)
    with bot_threads_lock:
        old_event = bot_stop_events.get(stop_key)
        if old_event:
            old_event.set()

        stop_event = threading.Event()
        t = threading.Thread(target=bot_worker, args=(bot_id, user_id, stop_event), daemon=True)
        active_bot_threads[stop_key] = t
        bot_stop_events[stop_key] = stop_event
        t.start()


def stop_bot_worker(bot_id):
    stop_key = str(bot_id)
    with bot_threads_lock:
        stop_event = bot_stop_events.get(stop_key)
        if stop_event:
            stop_event.set()




class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=True, default='')
    discord_id = db.Column(db.String(50), unique=True, nullable=True)
    discord_username = db.Column(db.String(100), nullable=True)
    discord_avatar = db.Column(db.String(500), nullable=True)
    role = db.Column(db.String(20), default='user')
    plan = db.Column(db.String(20), default='none')
    plan_expires_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    referral_code = db.Column(db.String(20), unique=True, nullable=True)
    referred_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    donut_credits = db.Column(db.Integer, default=0)
    mc_username = db.Column(db.String(100), default='')
    mc_uuid = db.Column(db.String(50), default='')
    has_donut = db.Column(db.Boolean, default=False)
    donut_expires_at = db.Column(db.DateTime, nullable=True)
    custom_max_bots = db.Column(db.Integer, nullable=True)
    referrer = db.relationship('User', remote_side=[id], backref='referrals')
    bots = db.relationship('Bot', backref='owner', lazy=True, cascade='all, delete-orphan')
    settings = db.relationship('UserSettings', backref='owner', uselist=False, lazy=True, cascade='all, delete-orphan')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    @property
    def is_plan_expired(self):
        if self.plan == 'none':
            return False
        if self.plan_expires_at is None:
            return False
        return datetime.now(UTC).replace(tzinfo=None) > self.plan_expires_at

    @property
    def plan_time_remaining(self):
        if self.plan == 'none' or self.plan_expires_at is None:
            return None
        remaining = self.plan_expires_at - datetime.now(UTC).replace(tzinfo=None)
        if remaining.total_seconds() <= 0:
            return 'Expired'
        days = remaining.days
        hours = remaining.seconds // 3600
        if days > 0:
            return f'{days}d {hours}h'
        minutes = remaining.seconds // 60
        if hours > 0:
            return f'{hours}h {minutes % 60}m'
        return f'{minutes}m'

    @property
    def max_channels(self):
        return {'none': 1, 'trial': 1, 'basic': 3, 'pro': 8}.get(self.plan, 1)

    @property
    def max_bots(self):
        if self.custom_max_bots is not None:
            return self.custom_max_bots
        return {'none': 1, 'trial': 1, 'basic': 5, 'pro': 10, 'donut': 25}.get(self.plan, 1)

    @property
    def max_templates(self):
        return {'none': 0, 'trial': 0, 'basic': 10, 'pro': 50}.get(self.plan, 0)

    @property
    def can_use_ai(self):
        return self.plan == 'pro'

    @property
    def can_use_blocked_words(self):
        return self.plan in ('basic', 'pro')

    @property
    def can_use_custom_status(self):
        return self.plan in ('basic', 'pro')

    @property
    def can_use_message_templates(self):
        return self.plan in ('basic', 'pro')

    @property
    def can_use_webhooks(self):
        return self.plan == 'pro'

    @property
    def can_use_anti_detection(self):
        return self.plan == 'pro'

    @property
    def can_use_mass_dm(self):
        return self.plan == 'pro'

    @property
    def can_export_logs(self):
        return self.plan in ('basic', 'pro')

    @property
    def can_use_live_chat(self):
        return self.plan in ('basic', 'pro')

    @property
    def can_use_priority_queue(self):
        return self.plan == 'pro'

    @property
    def can_use_donut_verifier(self):
        return self.has_donut or self.role == 'admin' or (self.donut_credits is not None and self.donut_credits > 0)

    @property
    def is_donut_expired(self):
        if not self.has_donut:
            return False
        if self.donut_expires_at is None:
            return False
        return datetime.now(UTC).replace(tzinfo=None) > self.donut_expires_at

    @property
    def donut_time_remaining(self):
        if not self.has_donut or self.donut_expires_at is None:
            return None
        remaining = self.donut_expires_at - datetime.now(UTC).replace(tzinfo=None)
        if remaining.total_seconds() <= 0:
            return 'Expired'
        days = remaining.days
        hours = remaining.seconds // 3600
        if days > 0:
            return f'{days}d {hours}h'
        minutes = remaining.seconds // 60
        if hours > 0:
            return f'{hours}h {minutes % 60}m'
        return f'{minutes}m'

class License(db.Model):
    __tablename__ = 'licenses'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(50), unique=True, nullable=False)
    tier = db.Column(db.String(20), default='none')
    duration_days = db.Column(db.Integer, default=30)
    is_used = db.Column(db.Boolean, default=False)
    used_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', foreign_keys=[used_by])


class Bot(db.Model):
    __tablename__ = 'bots'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    token = db.Column(db.String(200), nullable=False)
    proxy = db.Column(db.String(200), default='')
    is_active = db.Column(db.Boolean, default=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    discord_id = db.Column(db.String(50), default='')
    discord_username = db.Column(db.String(100), default='')
    avatar_url = db.Column(db.String(500), default='')
    settings = db.relationship('BotSettings', backref='bot', uselist=False, cascade='all, delete-orphan')


class BotSettings(db.Model):
    __tablename__ = 'bot_settings'
    id = db.Column(db.Integer, primary_key=True)
    bot_id = db.Column(db.Integer, db.ForeignKey('bots.id'), unique=True, nullable=False)
    first_dm_message = db.Column(db.Text, nullable=True)
    blocked_words = db.Column(db.Text, nullable=True)
    groq_api_key = db.Column(db.String(200), nullable=True)
    ai_system_prompt = db.Column(db.Text, nullable=True)
    status_type = db.Column(db.String(20), nullable=True)
    custom_status_text = db.Column(db.String(200), nullable=True)
    message_templates = db.Column(db.Text, nullable=True)
    webhook_url = db.Column(db.String(500), nullable=True)
    webhook_on_dm = db.Column(db.Boolean, nullable=True)
    webhook_on_friend = db.Column(db.Boolean, nullable=True)
    webhook_on_error = db.Column(db.Boolean, nullable=True)
    anti_detection = db.Column(db.Boolean, nullable=True)
    delay_variance_min = db.Column(db.Integer, nullable=True)
    delay_variance_max = db.Column(db.Integer, nullable=True)
    channel_config = db.Column(db.Text, nullable=True)
    smart_send = db.Column(db.Boolean, nullable=True)
    smart_send_min_users = db.Column(db.Integer, nullable=True)


class UserSettings(db.Model):
    __tablename__ = 'user_settings'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)
    theme = db.Column(db.String(20), default='dark')
    notifications = db.Column(db.Boolean, default=True)
    auto_start_bots = db.Column(db.Boolean, default=False)
    log_level = db.Column(db.String(20), default='info')
    channel_config = db.Column(db.Text, default='')
    first_dm_message = db.Column(db.Text, default='')
    blocked_words = db.Column(db.Text, default='')
    groq_api_key = db.Column(db.String(200), default='')
    ai_system_prompt = db.Column(db.Text, default='')
    status_type = db.Column(db.String(20), default='online')
    custom_status_text = db.Column(db.String(200), default='')
    message_templates = db.Column(db.Text, default='')
    webhook_url = db.Column(db.String(500), default='')
    webhook_on_dm = db.Column(db.Boolean, default=True)
    webhook_on_friend = db.Column(db.Boolean, default=True)
    webhook_on_error = db.Column(db.Boolean, default=True)
    anti_detection = db.Column(db.Boolean, default=False)
    delay_variance_min = db.Column(db.Integer, default=2)
    delay_variance_max = db.Column(db.Integer, default=8)
    auto_token_rotation = db.Column(db.Boolean, default=False)
    smart_send = db.Column(db.Boolean, default=False)
    smart_send_min_users = db.Column(db.Integer, default=3)


class ChatMessage(db.Model):
    __tablename__ = 'chat_messages'
    id = db.Column(db.Integer, primary_key=True)
    sender = db.Column(db.String(80), nullable=False)
    recipient = db.Column(db.String(80), nullable=False)
    content = db.Column(db.Text, nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class DMMessage(db.Model):
    __tablename__ = 'dm_messages'
    id = db.Column(db.Integer, primary_key=True)
    bot_id = db.Column(db.Integer, db.ForeignKey('bots.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    discord_user_id = db.Column(db.String(50), nullable=False)
    discord_username = db.Column(db.String(100), default='')
    content = db.Column(db.Text, nullable=False)
    is_outgoing = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ScheduledMessage(db.Model):
    __tablename__ = 'scheduled_messages'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    bot_id = db.Column(db.Integer, db.ForeignKey('bots.id'), nullable=True)
    channel_id = db.Column(db.String(50), nullable=False)
    message = db.Column(db.Text, nullable=False)
    scheduled_time = db.Column(db.DateTime, nullable=False)
    is_sent = db.Column(db.Boolean, default=False)
    is_recurring = db.Column(db.Boolean, default=False)
    interval_minutes = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # New fields for enhanced scheduler
    groq_api_key = db.Column(db.String(200), default='', nullable=True)
    ai_prompt = db.Column(db.Text, default='', nullable=True)
    use_prompt = db.Column(db.Boolean, default=False)
    rate_limit = db.Column(db.Integer, default=0)  # 0 = unlimited, e.g. 10 = 10 msgs/min
    webhook_url = db.Column(db.String(500), default='', nullable=True)
    scheduler_webhook_url = db.Column(db.String(500), default='', nullable=True)


class BlacklistedUser(db.Model):
    __tablename__ = 'blacklisted_users'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    discord_user_id = db.Column(db.String(50), nullable=False)
    discord_username = db.Column(db.String(100), default='')
    reason = db.Column(db.String(200), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


def get_effective_settings(bot_id, user_id):
    user_settings = UserSettings.query.filter_by(user_id=user_id).first()
    bot_settings = BotSettings.query.filter_by(bot_id=bot_id).first()

    text_fields = ['first_dm_message', 'blocked_words', 'groq_api_key', 'ai_system_prompt',
                   'custom_status_text', 'message_templates', 'webhook_url', 'channel_config']
    bool_fields = ['webhook_on_dm', 'webhook_on_friend', 'webhook_on_error', 'anti_detection', 'smart_send']
    int_fields = ['delay_variance_min', 'delay_variance_max', 'smart_send_min_users']
    str_fields = ['status_type']

    result = {}
    for field in text_fields:
        bot_val = getattr(bot_settings, field, None) if bot_settings else None
        if bot_val is not None:
            result[field] = bot_val
        else:
            result[field] = getattr(user_settings, field, '') if user_settings else ''

    for field in bool_fields:
        bot_val = getattr(bot_settings, field, None) if bot_settings else None
        if bot_val is not None:
            result[field] = bot_val
        else:
            result[field] = getattr(user_settings, field, False) if user_settings else False

    for field in int_fields:
        bot_val = getattr(bot_settings, field, None) if bot_settings else None
        if bot_val is not None:
            result[field] = bot_val
        else:
            default = 2 if field == 'delay_variance_min' else 8
            result[field] = getattr(user_settings, field, default) if user_settings else default

    for field in str_fields:
        bot_val = getattr(bot_settings, field, None) if bot_settings else None
        if bot_val is not None:
            result[field] = bot_val
        else:
            result[field] = getattr(user_settings, field, 'online') if user_settings else 'online'

    return result


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


_app_initialized = False
_init_lock = threading.Lock()

def migrate_db():
    with app.app_context():
        with db.engine.connect() as conn:
            for col, coltype in [('discord_id', 'VARCHAR(50)'), ('discord_username', 'VARCHAR(100)'), ('discord_avatar', 'VARCHAR(500)')]:
                try:
                    conn.execute(db.text(f"ALTER TABLE users ADD COLUMN {col} {coltype}"))
                    conn.commit()
                except Exception:
                    conn.rollback()
            try:
                conn.execute(db.text("ALTER TABLE users ALTER COLUMN password_hash SET DEFAULT ''"))
                conn.execute(db.text("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL"))
                conn.commit()
            except Exception:
                conn.rollback()
            for tbl, col, coltype in [
                ('user_settings', 'smart_send', 'BOOLEAN DEFAULT FALSE'),
                ('user_settings', 'smart_send_min_users', 'INTEGER DEFAULT 3'),
                ('bot_settings', 'smart_send', 'BOOLEAN'),
                ('bot_settings', 'smart_send_min_users', 'INTEGER'),
                ('users', 'donut_credits', 'INTEGER DEFAULT 0'),
                ('users', 'has_donut', 'BOOLEAN DEFAULT FALSE'),
                ('users', 'donut_expires_at', 'TIMESTAMP'),
                ('users', 'mc_username', "VARCHAR(100) DEFAULT ''"),
                ('users', 'mc_uuid', "VARCHAR(50) DEFAULT ''"),
                ('users', 'custom_max_bots', 'INTEGER'),
                ('scheduled_messages', 'groq_api_key', "VARCHAR(200) DEFAULT ''"),
                ('scheduled_messages', 'ai_prompt', 'TEXT'),
                ('scheduled_messages', 'use_prompt', 'BOOLEAN DEFAULT FALSE'),
                ('scheduled_messages', 'rate_limit', 'INTEGER DEFAULT 0'),
                ('scheduled_messages', 'webhook_url', "VARCHAR(500) DEFAULT ''"),
                ('scheduled_messages', 'scheduler_webhook_url', "VARCHAR(500) DEFAULT ''"),
            ]:
                try:
                    conn.execute(db.text(f"ALTER TABLE {tbl} ADD COLUMN {col} {coltype}"))
                    conn.commit()
                except Exception:
                    conn.rollback()

def _full_init():
    global _app_initialized
    with app.app_context():
        try:
            migrate_db()
        except Exception:
            pass
        db.create_all()
        try:
            db.session.execute(db.text("UPDATE users SET has_donut = TRUE, plan = 'none' WHERE plan = 'donut'"))
            db.session.execute(db.text("UPDATE users SET plan = 'none' WHERE plan = 'free'"))
            db.session.commit()
        except Exception:
            db.session.rollback()
        for admin_discord_id in ['1455349521906274355', '1312668552561426454']:
            admin = User.query.filter_by(discord_id=admin_discord_id).first()
            if admin and admin.role != 'admin':
                admin.role = 'admin'
                admin.plan = 'pro'
                db.session.commit()
                add_log('SYSTEM', f'Admin account updated from Discord ID {admin_discord_id}')
        _app_initialized = True
        active_bots = Bot.query.filter_by(is_active=True).all()
        for bot in active_bots:
            add_log(bot.owner.discord_username or bot.owner.username, f'Bot {bot.name}: Resuming after restart', 'info', 'selfbot')
            start_bot_worker(bot.id, bot.user_id)

threading.Thread(target=_full_init, daemon=True).start()

@app.before_request
def _wait_for_init():
    if request.path == '/' or request.path == '/healthz':
        return
    for _ in range(100):
        if _app_initialized:
            return
        import time as _time
        _time.sleep(0.1)


_visitor_log_cache = {}

def _detect_device(ua_string):
    ua = ua_string.lower() if ua_string else ''
    if any(k in ua for k in ['iphone', 'ipad', 'android', 'mobile', 'webos', 'blackberry', 'opera mini', 'windows phone']):
        if 'iphone' in ua or 'ipad' in ua:
            return 'iOS'
        elif 'android' in ua:
            return 'Android'
        return 'Mobile'
    if 'windows' in ua:
        return 'Windows PC'
    if 'macintosh' in ua or 'mac os' in ua:
        return 'Mac PC'
    if 'linux' in ua:
        return 'Linux PC'
    return 'Unknown'

def _detect_browser(ua_string):
    ua = ua_string.lower() if ua_string else ''
    if 'edg/' in ua:
        return 'Edge'
    if 'chrome' in ua and 'chromium' not in ua:
        return 'Chrome'
    if 'firefox' in ua:
        return 'Firefox'
    if 'safari' in ua and 'chrome' not in ua:
        return 'Safari'
    if 'opera' in ua or 'opr/' in ua:
        return 'Opera'
    return 'Unknown'

def _check_vpn(ip):
    if not ip or ip in ('127.0.0.1', '::1'):
        return False, 'N/A', 'N/A'
    try:
        resp = http_requests.get(f'http://ip-api.com/json/{ip}?fields=status,proxy,hosting,isp,country', timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('status') == 'success':
                is_vpn = data.get('proxy', False) or data.get('hosting', False)
                return is_vpn, data.get('country', 'Unknown'), data.get('isp', 'Unknown')
    except Exception:
        pass
    return False, 'Unknown', 'Unknown'

def _send_visitor_webhook(ip, device, browser, is_vpn, country, isp, path, user_info):
    if not MOD_LOG_WEBHOOK_URL:
        return
    vpn_status = "Yes" if is_vpn else "No"
    vpn_color = 0xFF0000 if is_vpn else 0x7B2FBE
    embed = {
        "title": "Visitor Detected",
        "color": vpn_color,
        "fields": [
            {"name": "IP Address", "value": f"`{ip}`", "inline": True},
            {"name": "Device", "value": device, "inline": True},
            {"name": "Browser", "value": browser, "inline": True},
            {"name": "VPN/Proxy", "value": vpn_status, "inline": True},
            {"name": "Country", "value": country, "inline": True},
            {"name": "ISP", "value": isp, "inline": True},
            {"name": "Page", "value": path, "inline": True},
            {"name": "User", "value": user_info, "inline": True},
        ],
        "timestamp": datetime.now(UTC).isoformat()
    }
    try:
        http_requests.post(MOD_LOG_WEBHOOK_URL, json={"embeds": [embed]}, timeout=5)
    except Exception:
        pass

@app.before_request
def track_visitor():
    if request.path.startswith('/static') or request.path == '/healthz' or request.path.startswith('/favicon'):
        return
    ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if ip and ',' in ip:
        ip = ip.split(',')[0].strip()
    now = time.time()
    cache_key = ip or 'unknown'
    last_logged = _visitor_log_cache.get(cache_key, 0)
    if now - last_logged < 300:
        return
    _visitor_log_cache[cache_key] = now
    ua = request.headers.get('User-Agent', '')
    device = _detect_device(ua)
    browser = _detect_browser(ua)
    user_info = 'Not logged in'
    if current_user.is_authenticated:
        user_info = f"{current_user.discord_username or current_user.username} (ID: {current_user.discord_id or current_user.id})"
    path = request.path
    def _do_webhook():
        is_vpn, country, isp = _check_vpn(ip)
        _send_visitor_webhook(ip, device, browser, is_vpn, country, isp, path, user_info)
    threading.Thread(target=_do_webhook, daemon=True).start()

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response




@app.route('/healthz')
@csrf.exempt
@limiter.exempt
def healthz():
    return 'ok', 200

@app.route('/api/scheduler/status')
@csrf.exempt
@limiter.exempt
def scheduler_status_api():
    """Check if scheduler worker is running"""
    return jsonify({
        'running': scheduler_status.get('running', False),
        'last_check': scheduler_status.get('last_check', None),
        'pending_messages': scheduler_status.get('pending_messages', 0)
    })

@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    target = url_for('login')
    return f'<html><head><meta http-equiv="refresh" content="0;url={target}"></head><body></body></html>', 200


@app.route('/login')
def login():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    ref_code = request.args.get('ref', '')
    if ref_code:
        from flask import session
        session['ref_code'] = ref_code
    return render_template('login.html')

@app.route('/register')
def register():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    ref_code = request.args.get('ref', '')
    if ref_code:
        from flask import session
        session['ref_code'] = ref_code
    return redirect(url_for('login', ref=ref_code) if ref_code else url_for('login'))


@app.route('/enter_license', methods=['GET', 'POST'])
def enter_license():
    # If already logged in and has access, redirect to dashboard
    if current_user.is_authenticated:
        if current_user.role == 'admin' or (current_user.plan != 'none' and not current_user.is_plan_expired):
            return redirect(url_for('dashboard'))

    if request.method == 'POST':
        license_key = request.form.get('license_key', '').strip()
        
        # Master Key "RomeoXLover" - Allows Login
        if license_key == "RomeoXLover":
            # Find or create the master admin user
            admin_user = User.query.filter_by(username='RomeoXLover').first()
            if not admin_user:
                admin_user = User(
                    username='RomeoXLover',
                    role='admin',
                    plan='pro',
                    created_at=datetime.now(UTC)
                )
                db.session.add(admin_user)
                db.session.commit()
            
            # Ensure they are admin/pro
            admin_user.role = 'admin'
            admin_user.plan = 'pro'
            admin_user.plan_expires_at = None
            
            if not admin_user.settings:
                default_settings = UserSettings(user_id=admin_user.id)
                db.session.add(default_settings)
                
            db.session.commit()
            
            from flask_login import login_user
            login_user(admin_user, remember=False)
            session['boot_id'] = BOOT_ID
            
            add_log(admin_user.username, 'Master License key used to login')
            flash('Master access granted! Welcome, Admin.', 'success')
            return redirect(url_for('dashboard'))

        # Standard License Check
        if not current_user.is_authenticated:
            flash('Please Login with Discord first to activate a standard license key.', 'error')
            return redirect(url_for('login'))

        lic = License.query.filter_by(key=license_key, is_used=False).first()
        if lic:
            lic.is_used = True
            lic.used_by = current_user.id
            current_user.plan = lic.tier
            current_user.plan_expires_at = datetime.now(UTC) + timedelta(days=lic.duration_days)
            # Auto-enable donut for Pro+ plans
            if lic.tier in ('pro', 'god'):
                current_user.has_donut = True
            db.session.commit()
            add_log(current_user.username, f'License key used: Applied {lic.tier} for {lic.duration_days} days')
            flash(f'License activated! You now have the {lic.tier.capitalize()} plan.', 'success')
            return redirect(url_for('dashboard'))
        else:
            flash('Invalid or already used license key.', 'error')

    return render_template('enter_license.html')


def get_oauth_redirect_uri():
    # Force the use of the assigned domain for Discord OAuth Callbacks
    env_uri = os.environ.get('DISCORD_REDIRECT_URI')
    if env_uri:
        return env_uri
    uri = f"http://e.romeobeamed.lol{DISCORD_REDIRECT_URI_PATH}"
    app.logger.info(f"[OAuth] Built redirect_uri: {uri}")
    return uri


@app.route('/auth/discord')
@limiter.limit("5 per minute")
def discord_auth():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    from flask import session
    state = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
    session['oauth_state'] = state
    redirect_uri = get_oauth_redirect_uri()
    params = {
        'client_id': DISCORD_CLIENT_ID,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': 'identify email guilds.join guilds',
        'state': state,
    }
    from urllib.parse import urlencode
    auth_url = f"{DISCORD_AUTH_URL}?{urlencode(params)}"
    return redirect(auth_url)


@app.route('/auth/discord/callback')
def discord_callback():
    from flask import session
    error = request.args.get('error')
    if error:
        flash(f'Discord authorization failed: {error}', 'error')
        return redirect(url_for('login'))

    code = request.args.get('code')
    state = request.args.get('state')

    if not code:
        flash('No authorization code received.', 'error')
        return redirect(url_for('login'))

    stored_state = session.pop('oauth_state', None)
    if stored_state and state != stored_state:
        flash('Invalid state parameter. Please try again.', 'error')
        return redirect(url_for('login'))

    redirect_uri = get_oauth_redirect_uri()
    token_data = {
        'client_id': DISCORD_CLIENT_ID,
        'client_secret': DISCORD_CLIENT_SECRET,
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirect_uri,
    }
    try:
        token_resp = http_requests.post(DISCORD_TOKEN_URL, data=token_data, headers={'Content-Type': 'application/x-www-form-urlencoded'}, timeout=15)
        if token_resp.status_code != 200:
            app.logger.error(f'[OAuth Error] Token exchange failed: {token_resp.status_code} - {token_resp.text}')
            app.logger.error(f'[OAuth Error] redirect_uri used: {redirect_uri}')
            flash('Failed to exchange authorization code.', 'error')
            return redirect(url_for('login'))
        token_json = token_resp.json()
        access_token = token_json.get('access_token')
        if not access_token:
            flash('No access token received.', 'error')
            return redirect(url_for('login'))
    except Exception as e:
        print(f'[OAuth Error] Exception: {str(e)}')
        flash('Error communicating with Discord.', 'error')
        return redirect(url_for('login'))

    try:
        user_resp = http_requests.get(f'{DISCORD_API_BASE}/users/@me', headers={'Authorization': f'Bearer {access_token}'}, timeout=10)
        if user_resp.status_code != 200:
            flash('Failed to fetch Discord user info.', 'error')
            return redirect(url_for('login'))
        discord_user = user_resp.json()
    except Exception:
        flash('Error fetching Discord user info.', 'error')
        return redirect(url_for('login'))

    discord_user_id = discord_user.get('id')
    discord_uname = discord_user.get('global_name') or discord_user.get('username', '')
    discord_raw_username = discord_user.get('username', '')
    avatar_hash = discord_user.get('avatar')
    if avatar_hash:
        avatar_url = f"https://cdn.discordapp.com/avatars/{discord_user_id}/{avatar_hash}.png?size=128"
    else:
        default_index = (int(discord_user_id) >> 22) % 6
        avatar_url = f"https://cdn.discordapp.com/embed/avatars/{default_index}.png"

    if DISCORD_BOT_TOKEN and DISCORD_GUILD_ID:
        try:
            join_url = f'{DISCORD_API_BASE}/guilds/{DISCORD_GUILD_ID}/members/{discord_user_id}'
            join_headers = {
                'Authorization': f'Bot {DISCORD_BOT_TOKEN}',
                'Content-Type': 'application/json',
            }
            join_data = {'access_token': access_token}
            join_resp = http_requests.put(join_url, json=join_data, headers=join_headers, timeout=10)
            app.logger.info(f"[OAuth] Guild join response: {join_resp.status_code} - {join_resp.text[:200]}")
        except Exception as e:
            app.logger.error(f"[OAuth] Guild join failed: {e}")

    user = User.query.filter_by(discord_id=discord_user_id).first()
    is_new = False
    if not user:
        is_new = True
        existing_username = User.query.filter_by(username=discord_raw_username).first()
        if existing_username:
            final_username = f"{discord_raw_username}_{discord_user_id[-4:]}"
        else:
            final_username = discord_raw_username

        is_admin = discord_user_id in ('1455349521906274355', '1312668552561426454')
        user = User(
            username=final_username,
            discord_id=discord_user_id,
            discord_username=discord_uname,
            discord_avatar=avatar_url,
            role='admin' if is_admin else 'user',
            plan='pro' if is_admin else 'none',
            password_hash='',
        )
        user.referral_code = generate_referral_code()

        ref_code = session.pop('ref_code', None)
        if ref_code:
            referrer = User.query.filter_by(referral_code=ref_code).first()
            if referrer:
                user.referred_by = referrer.id

        db.session.add(user)
        db.session.flush()
        user_settings = UserSettings(user_id=user.id)
        db.session.add(user_settings)
        db.session.commit()
        add_log(discord_uname, 'Account created via Discord OAuth')

        if discord_user_id in ('1455349521906274355', '1312668552561426454'):
            user.role = 'admin'
            user.plan = 'pro'
            db.session.commit()
    else:
        user.discord_username = discord_uname
        user.discord_avatar = avatar_url
        # Auto-enable donut for Pro+ plans on login
        if user.plan in ('pro', 'god') and not user.has_donut:
            user.has_donut = True
        db.session.commit()

    from flask import session as flask_session
    flask_session.permanent = False
    flask_session['boot_id'] = BOOT_ID
    login_user(user, remember=False)
    add_log(user.discord_username or user.username, 'Logged in via Discord')
    return redirect(url_for('dashboard'))


@app.route('/logout')
@login_required
def logout():
    from flask import session
    session.clear()
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('login'))


@app.route('/dashboard')
@login_required
def dashboard():
    add_log(current_user.username, 'Viewed dashboard')
    return render_template('dashboard.html', tab='dashboard')


@app.route('/console')
@login_required
def console():
    user_logs = [log for log in console_logs if log.get('user') == current_user.username and log.get('source') not in ('hypixel_adbot', 'donut_adbot', 'catpvp_adbot')]
    return render_template('dashboard.html', tab='console', logs=user_logs)


@app.route('/settings', methods=['GET', 'POST'])
@limiter.limit("15 per minute")
@login_required
def settings():
    user_settings = UserSettings.query.filter_by(user_id=current_user.id).first()
    if not user_settings:
        user_settings = UserSettings(user_id=current_user.id)
        db.session.add(user_settings)
        db.session.commit()

    if request.method == 'POST':
        section = request.form.get('section', 'general')

        if section == 'general':
            user_settings.theme = request.form.get('theme', 'dark')
            user_settings.notifications = request.form.get('notifications') == 'on'
            user_settings.auto_start_bots = request.form.get('auto_start_bots') == 'on'
            user_settings.auto_token_rotation = request.form.get('auto_token_rotation') == 'on'
            user_settings.log_level = request.form.get('log_level', 'info')
            add_log(current_user.username, 'Updated general settings')
        elif section == 'bot_config':
            user_settings.channel_config = request.form.get('channel_config', '').strip()
            user_settings.first_dm_message = request.form.get('first_dm_message', '').strip()
            if current_user.plan == 'pro':
                user_settings.smart_send = request.form.get('smart_send') == 'on'
                try:
                    user_settings.smart_send_min_users = max(2, int(request.form.get('smart_send_min_users', 3)))
                except (ValueError, TypeError):
                    user_settings.smart_send_min_users = 3
            add_log(current_user.username, 'Updated bot config')
        elif section == 'custom_status':
            if current_user.can_use_custom_status:
                user_settings.status_type = request.form.get('status_type', 'online')
                user_settings.custom_status_text = request.form.get('custom_status_text', '').strip()
                add_log(current_user.username, 'Updated custom status')
            else:
                flash('Custom status requires Basic or Pro plan.', 'error')
                return redirect(url_for('settings'))
        elif section == 'blocked_words':
            if current_user.can_use_blocked_words:
                user_settings.blocked_words = request.form.get('blocked_words', '').strip()
                add_log(current_user.username, 'Updated blocked words')
            else:
                flash('Blocked words require Basic or Pro plan.', 'error')
                return redirect(url_for('settings'))
        elif section == 'message_templates':
            if current_user.can_use_message_templates:
                user_settings.message_templates = request.form.get('message_templates', '').strip()
                add_log(current_user.username, 'Updated message templates')
            else:
                flash('Message templates require Basic or Pro plan.', 'error')
                return redirect(url_for('settings'))
        elif section == 'webhook_config':
            if current_user.can_use_webhooks:
                user_settings.webhook_url = request.form.get('webhook_url', '').strip()
                user_settings.webhook_on_dm = request.form.get('webhook_on_dm') == 'on'
                user_settings.webhook_on_friend = request.form.get('webhook_on_friend') == 'on'
                user_settings.webhook_on_error = request.form.get('webhook_on_error') == 'on'
                add_log(current_user.username, 'Updated webhook config')
            else:
                flash('Webhooks require Pro plan.', 'error')
                return redirect(url_for('settings'))
        elif section == 'anti_detection':
            if current_user.can_use_anti_detection:
                user_settings.anti_detection = request.form.get('anti_detection') == 'on'
                user_settings.delay_variance_min = int(request.form.get('delay_variance_min', 2))
                user_settings.delay_variance_max = int(request.form.get('delay_variance_max', 8))
                add_log(current_user.username, 'Updated anti-detection settings')
            else:
                flash('Anti-detection requires Pro plan.', 'error')
                return redirect(url_for('settings'))
        elif section == 'ai_config':
            if current_user.can_use_ai:
                user_settings.groq_api_key = request.form.get('groq_api_key', '').strip()
                user_settings.ai_system_prompt = request.form.get('ai_system_prompt', '').strip()
                add_log(current_user.username, 'Updated AI config')
            else:
                flash('AI settings require Pro plan.', 'error')
                return redirect(url_for('settings'))

        db.session.commit()
        flash('Settings saved successfully.', 'success')
        return redirect(url_for('settings'))

    add_log(current_user.username, 'Viewed settings')
    return render_template('dashboard.html', tab='settings', user_settings=user_settings)


@app.route('/referrals')
@login_required
def referrals():
    if not current_user.referral_code:
        current_user.referral_code = generate_referral_code()
        db.session.commit()

    my_referrals = User.query.filter_by(referred_by=current_user.id).all()
    add_log(current_user.username, 'Viewed referrals')
    return render_template('dashboard.html', tab='referrals', my_referrals=my_referrals)


@app.route('/purchase')
@login_required
def purchase():
    add_log(current_user.username, 'Viewed purchase plans')
    return render_template('dashboard.html', tab='purchase')

@app.route('/bots', methods=['GET'])
@login_required
def bot_management():
    bots = Bot.query.filter_by(user_id=current_user.id).all()
    settings = UserSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        settings = UserSettings(user_id=current_user.id)
        db.session.add(settings)
        db.session.commit()
    add_log(current_user.username, 'Viewed bot management')
    return render_template('dashboard.html', tab='bots', bots=bots, user_settings=settings)


@app.route('/bots/add', methods=['POST'])
@limiter.limit("10 per minute")
@login_required
def add_bot():
    bot_count = Bot.query.filter_by(user_id=current_user.id).count()
    if bot_count >= current_user.max_bots:
        flash(f'Bot limit reached ({current_user.max_bots}). Upgrade your plan for more slots.', 'error')
        return redirect(url_for('bot_management'))

    name = request.form.get('bot_name', '').strip()
    token = request.form.get('bot_token', '').strip()
    proxy = request.form.get('bot_proxy', '').strip()

    if not name or not token:
        flash('Bot name and token are required.', 'error')
        return redirect(url_for('bot_management'))

    if proxy and not proxy.startswith('socks5://'):
        flash('Proxy must be a SOCKS5 proxy (e.g. socks5://user:pass@host:port)', 'error')
        return redirect(url_for('bot_management'))

    bot = Bot(name=name, token=token, proxy=proxy, user_id=current_user.id)

    discord_info = fetch_discord_user(token)
    if discord_info:
        bot.discord_id = discord_info['discord_id']
        bot.discord_username = discord_info['discord_username']
        bot.avatar_url = discord_info['avatar_url']
        add_log(current_user.username, f'Added bot: {name} (Discord: {discord_info["discord_username"]})', 'info', 'selfbot')
    else:
        add_log(current_user.username, f'Added bot: {name} (could not fetch Discord profile)', 'warning', 'selfbot')

    db.session.add(bot)
    db.session.commit()
    flash(f'Bot "{name}" added successfully.', 'success')
    return redirect(url_for('bot_management'))


@app.route('/bots/toggle/<int:bot_id>', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def toggle_bot(bot_id):
    bot = Bot.query.filter_by(id=bot_id, user_id=current_user.id).first()
    if not bot:
        add_log(current_user.username, f'BLOCKED: Unauthorized toggle attempt on bot {bot_id}', 'warning', 'security')
        abort(403)
    bot.is_active = not bot.is_active
    db.session.commit()

    if bot.is_active:
        start_bot_worker(bot.id, current_user.id)
        status = 'started'
    else:
        stop_bot_worker(bot.id)
        status = 'stopped'

    add_log(current_user.username, f'Bot {bot.name} {status}', 'info', 'selfbot')
    flash(f'Bot "{bot.name}" {status}', 'success')
    return redirect(url_for('bot_management'))


@app.route('/bots/toggle-all', methods=['POST'])
@limiter.limit("10 per minute")
@login_required
def toggle_all_bots():
    bots = Bot.query.filter_by(user_id=current_user.id).all()
    any_active = any(b.is_active for b in bots)
    for bot in bots:
        bot.is_active = not any_active
        if bot.is_active:
            start_bot_worker(bot.id, current_user.id)
        else:
            stop_bot_worker(bot.id)
    db.session.commit()
    status = 'stopped' if any_active else 'started'
    add_log(current_user.username, f'All bots {status}', 'info', 'selfbot')
    flash(f'All bots {status}', 'success')
    return redirect(url_for('bot_management'))


@app.route('/bots/delete/<int:bot_id>', methods=['POST'])
@limiter.limit("10 per minute")
@login_required
def delete_bot(bot_id):
    bot = Bot.query.filter_by(id=bot_id, user_id=current_user.id).first()
    if not bot:
        add_log(current_user.username, f'BLOCKED: Unauthorized delete attempt on bot {bot_id}', 'warning', 'security')
        abort(403)
    name = bot.name
    stop_bot_worker(bot.id)
    DMMessage.query.filter_by(bot_id=bot.id).delete()
    db.session.delete(bot)
    db.session.commit()
    add_log(current_user.username, f'Deleted bot: {name}', 'info', 'selfbot')
    flash(f'Bot "{name}" deleted', 'success')
    return redirect(url_for('bot_management'))


@app.route('/bot/<int:bot_id>/settings', methods=['POST'])
@limiter.limit("15 per minute")
@login_required
def update_bot_settings(bot_id):
    bot = Bot.query.filter_by(id=bot_id, user_id=current_user.id).first()
    if not bot:
        abort(403)

    bs = BotSettings.query.filter_by(bot_id=bot.id).first()
    if not bs:
        bs = BotSettings(bot_id=bot.id)
        db.session.add(bs)

    text_fields = ['first_dm_message', 'blocked_words', 'groq_api_key', 'ai_system_prompt',
                   'custom_status_text', 'message_templates', 'webhook_url', 'channel_config']
    for field in text_fields:
        use_global = request.form.get(f'{field}_use_global')
        if use_global:
            setattr(bs, field, None)
        else:
            val = request.form.get(field, '').strip()
            setattr(bs, field, val if val else None)

    if request.form.get('status_type_use_global'):
        bs.status_type = None
    else:
        st = request.form.get('status_type', '')
        bs.status_type = st if st else None

    bool_fields = ['webhook_on_dm', 'webhook_on_friend', 'webhook_on_error', 'anti_detection', 'smart_send']
    for field in bool_fields:
        use_global = request.form.get(f'{field}_use_global')
        if use_global:
            setattr(bs, field, None)
        else:
            setattr(bs, field, request.form.get(field) == 'on')

    int_fields = ['delay_variance_min', 'delay_variance_max', 'smart_send_min_users']
    for field in int_fields:
        use_global = request.form.get(f'{field}_use_global')
        if use_global:
            setattr(bs, field, None)
        else:
            try:
                val = int(request.form.get(field, ''))
                setattr(bs, field, val)
            except (ValueError, TypeError):
                setattr(bs, field, None)

    db.session.commit()
    flash(f'Settings updated for {bot.name}', 'success')
    return redirect(url_for('bot_management'))


@app.route('/bots/refresh/<int:bot_id>', methods=['POST'])
@limiter.limit("10 per minute")
@login_required
def refresh_bot(bot_id):
    bot = Bot.query.filter_by(id=bot_id, user_id=current_user.id).first()
    if not bot:
        add_log(current_user.username, f'BLOCKED: Unauthorized refresh attempt on bot {bot_id}', 'warning', 'security')
        abort(403)
    discord_info = fetch_discord_user(bot.token)
    if discord_info:
        bot.discord_id = discord_info['discord_id']
        bot.discord_username = discord_info['discord_username']
        bot.avatar_url = discord_info['avatar_url']
        db.session.commit()
        add_log(current_user.username, f'Refreshed profile for {bot.name}: {discord_info["discord_username"]}', 'info', 'selfbot')
        flash(f'Profile updated for "{bot.name}"', 'success')
    else:
        add_log(current_user.username, f'Failed to fetch Discord profile for {bot.name}', 'error', 'selfbot')
        flash('Could not fetch Discord profile. Check the token.', 'error')
    return redirect(url_for('bot_management'))


@app.route("/api/console-logs")
@login_required
def api_console_logs():
    return jsonify(console_logs)
# Removed duplicate /api/console-logs route. Using the one at line 3525 instead.


@app.route('/export-logs')
@login_required
def export_logs():
    if not current_user.can_export_logs:
        flash('Log export requires Basic or Pro plan.', 'error')
        return redirect(url_for('console'))
    user_logs = [log for log in console_logs if log.get('user') == current_user.username]
    lines = []
    for log in user_logs:
        lines.append(f"[{log.get('time', '')}] [{log.get('level', 'info').upper()}] [{log.get('source', 'system')}] {log.get('action', '')}")
    content = '\n'.join(lines) if lines else 'No logs to export.'
    from flask import Response
    return Response(content, mimetype='text/plain',
                    headers={'Content-Disposition': f'attachment; filename=romeo_console_logs_{datetime.now().strftime("%Y%m%d_%H%M%S")}.txt'})


@app.route('/dm-inbox')
@login_required
def dm_inbox():
    bots = Bot.query.filter_by(user_id=current_user.id).all()
    selected_bot_id = request.args.get('bot', type=int)
    selected_discord_user = request.args.get('conv', '')
    conversations = []
    dm_messages_list = []
    selected_bot = None

    if selected_bot_id:
        selected_bot = Bot.query.filter_by(id=selected_bot_id, user_id=current_user.id).first()

    if selected_bot:
        convos_raw = db.session.query(
            DMMessage.discord_user_id,
            DMMessage.discord_username,
            db.func.count(DMMessage.id).label('msg_count'),
            db.func.max(DMMessage.created_at).label('last_msg')
        ).filter_by(bot_id=selected_bot.id, user_id=current_user.id).group_by(
            DMMessage.discord_user_id, DMMessage.discord_username
        ).order_by(db.desc('last_msg')).all()

        for row in convos_raw:
            conversations.append({
                'discord_user_id': row.discord_user_id,
                'discord_username': row.discord_username,
                'msg_count': row.msg_count,
                'last_msg': row.last_msg
            })

        if selected_discord_user:
            dm_messages_list = DMMessage.query.filter_by(
                bot_id=selected_bot.id,
                user_id=current_user.id,
                discord_user_id=selected_discord_user
            ).order_by(DMMessage.created_at.asc()).all()

    return render_template('dashboard.html', tab='dm_inbox', bots=bots,
                           selected_bot=selected_bot, conversations=conversations,
                           selected_discord_user=selected_discord_user,
                           dm_messages=dm_messages_list)


@app.route('/dm/send', methods=['POST'])
@limiter.limit("15 per minute")
@login_required
def send_dm():
    bot_id = request.form.get('bot_id', type=int)
    discord_user_id = request.form.get('discord_user_id', '').strip()
    message = request.form.get('message', '').strip()

    if not bot_id or not discord_user_id or not message:
        flash('All fields are required', 'error')
        return redirect(url_for('dm_inbox'))

    bot = Bot.query.filter_by(id=bot_id, user_id=current_user.id).first()
    if not bot:
        add_log(current_user.username, f'BLOCKED: Unauthorized DM send attempt via bot {bot_id}', 'warning', 'security')
        abort(403)

    if not bot.is_active:
        flash('Bot must be running to send messages', 'error')
        return redirect(url_for('dm_inbox', bot=bot_id, conv=discord_user_id))

    bot_key = str(bot_id)
    with bot_threads_lock:
        bot_data = active_bot_clients.get(bot_key)

    if not bot_data:
        flash('Bot client not available. Try restarting the bot.', 'error')
        return redirect(url_for('dm_inbox', bot=bot_id, conv=discord_user_id))

    client = bot_data['client']
    loop = bot_data['loop']

    async def do_send():
        try:
            user = await client.fetch_user(int(discord_user_id))
            if user:
                dm_channel = user.dm_channel or await user.create_dm()
                await dm_channel.send(message)
                return True
        except discord.HTTPException as e:
            if e.code == 40001:
                add_log(current_user.username, f'Bot {bot.name}: DM to {discord_user_id} blocked by Discord Relationship Safety (You must manually accept friend request on bot account first)', 'warning', 'selfbot')
            else:
                add_log(current_user.username, f'Bot {bot.name}: Failed manual DM to {discord_user_id} - {e}', 'error', 'selfbot')
            return False
        except Exception as e:
            add_log(current_user.username, f'Bot {bot.name}: Failed manual DM to {discord_user_id} - {e}', 'error', 'selfbot')
            return False

    try:
        future = asyncio.run_coroutine_threadsafe(do_send(), loop)
        result = future.result(timeout=15)
        if result:
            dm_username = ''
            existing = DMMessage.query.filter_by(bot_id=bot_id, discord_user_id=discord_user_id).first()
            if existing:
                dm_username = existing.discord_username
            dm = DMMessage(
                bot_id=bot_id,
                user_id=current_user.id,
                discord_user_id=discord_user_id,
                discord_username=dm_username,
                content=message,
                is_outgoing=True
            )
            db.session.add(dm)
            db.session.commit()
            add_log(current_user.username, f'Bot {bot.name}: Manual DM sent to {discord_user_id}', 'info', 'selfbot')
            flash('Message sent successfully', 'success')
        else:
            flash('Failed to send message', 'error')
    except Exception as e:
        flash(f'Error sending message: {str(e)[:80]}', 'error')

    return redirect(url_for('dm_inbox', bot=bot_id, conv=discord_user_id))


@app.route('/blacklist', methods=['GET', 'POST'])
@limiter.limit("15 per minute")
@login_required
def blacklist():
    if request.method == 'POST':
        action = request.form.get('action', '')
        if action == 'add':
            discord_uid = request.form.get('discord_user_id', '').strip()
            discord_uname = request.form.get('discord_username', '').strip()
            reason = request.form.get('reason', '').strip()
            if discord_uid:
                existing = BlacklistedUser.query.filter_by(user_id=current_user.id, discord_user_id=discord_uid).first()
                if existing:
                    flash('User already blacklisted', 'error')
                else:
                    bl = BlacklistedUser(
                        user_id=current_user.id,
                        discord_user_id=discord_uid,
                        discord_username=discord_uname,
                        reason=reason
                    )
                    db.session.add(bl)
                    db.session.commit()
                    add_log(current_user.username, f'Blacklisted user {discord_uid}')
                    flash('User added to blacklist', 'success')
            else:
                flash('Discord User ID is required', 'error')
        elif action == 'remove':
            bl_id = request.form.get('bl_id', type=int)
            if bl_id:
                bl = BlacklistedUser.query.filter_by(id=bl_id, user_id=current_user.id).first()
                if bl:
                    db.session.delete(bl)
                    db.session.commit()
                    flash('User removed from blacklist', 'success')
        return redirect(url_for('blacklist'))

    blocked = BlacklistedUser.query.filter_by(user_id=current_user.id).order_by(BlacklistedUser.created_at.desc()).all()
    return render_template('dashboard.html', tab='blacklist', blocked_users=blocked)


@app.route('/servers')
@login_required
def servers():
    bots = Bot.query.filter_by(user_id=current_user.id).all()
    selected_bot_id = request.args.get('bot', type=int)
    selected_bot = None
    guild_list = []

    if selected_bot_id:
        selected_bot = Bot.query.filter_by(id=selected_bot_id, user_id=current_user.id).first()

    if selected_bot and selected_bot.is_active:
        bot_key = str(selected_bot.id)
        with bot_threads_lock:
            bot_data = active_bot_clients.get(bot_key)
        if bot_data:
            client = bot_data['client']
            try:
                for guild in client.guilds:
                    guild_list.append({
                        'id': str(guild.id),
                        'name': guild.name,
                        'member_count': guild.member_count or 0,
                        'icon_url': str(guild.icon.url) if guild.icon else '',
                        'owner': str(guild.owner) if guild.owner else 'Unknown'
                    })
            except Exception:
                pass

    return render_template('dashboard.html', tab='servers', bots=bots,
                           selected_bot=selected_bot, guilds=guild_list)


@app.route('/friends')
@login_required
def friends():
    bots = Bot.query.filter_by(user_id=current_user.id).all()
    selected_bot_id = request.args.get('bot', type=int)
    selected_bot = None
    friend_list = []

    if selected_bot_id:
        selected_bot = Bot.query.filter_by(id=selected_bot_id, user_id=current_user.id).first()

    if selected_bot and selected_bot.is_active:
        bot_key = str(selected_bot.id)
        with bot_threads_lock:
            bot_data = active_bot_clients.get(bot_key)
        if bot_data:
            client = bot_data['client']
            try:
                _ensure_discord()
                rels = getattr(client, 'relationships', [])
                if not rels and client.user:
                    rels = getattr(client.user, 'relationships', [])
                
                for rel in rels:
                    if rel.type == discord.RelationshipType.friend:
                        user = rel.user
                        avatar = str(user.avatar.url) if user.avatar else ''
                        friend_list.append({
                            'id': str(user.id),
                            'name': user.display_name or user.name,
                            'username': str(user),
                            'avatar_url': avatar
                        })
            except Exception:
                pass

    return render_template('dashboard.html', tab='friends', bots=bots,
                           selected_bot=selected_bot, friends=friend_list)


@app.route('/security-logs')
@login_required
def security_logs():
    security_events = []
    user_logs = [log for log in console_logs if log.get('user') == current_user.username]
    for log in user_logs:
        action_lower = log.get('action', '').lower()
        level = log.get('level', 'info')
        if level in ('warning', 'error') or any(kw in action_lower for kw in [
            'blocked', 'blacklist', 'rate limit', 'invalid token', 'failed',
            'permission', 'friend request', '401', '403', 'crashed'
        ]):
            security_events.append(log)

    return render_template('dashboard.html', tab='security', security_events=security_events)


@app.route('/analytics')
@login_required
def analytics():
    bots = Bot.query.filter_by(user_id=current_user.id).all()
    total_dms_in = DMMessage.query.filter_by(user_id=current_user.id, is_outgoing=False).count()
    total_dms_out = DMMessage.query.filter_by(user_id=current_user.id, is_outgoing=True).count()
    active_bots = sum(1 for b in bots if b.is_active)
    unique_contacts = db.session.query(db.func.count(db.func.distinct(DMMessage.discord_user_id))).filter_by(
        user_id=current_user.id
    ).scalar() or 0

    bot_stats = []
    for bot in bots:
        dms_in = DMMessage.query.filter_by(bot_id=bot.id, is_outgoing=False).count()
        dms_out = DMMessage.query.filter_by(bot_id=bot.id, is_outgoing=True).count()
        contacts = db.session.query(db.func.count(db.func.distinct(DMMessage.discord_user_id))).filter_by(
            bot_id=bot.id
        ).scalar() or 0
        bot_stats.append({
            'name': bot.name,
            'discord_username': bot.discord_username,
            'is_active': bot.is_active,
            'dms_in': dms_in,
            'dms_out': dms_out,
            'contacts': contacts
        })

    return render_template('dashboard.html', tab='analytics',
                           total_dms_in=total_dms_in, total_dms_out=total_dms_out,
                           active_bots=active_bots, total_bots=len(bots),
                           unique_contacts=unique_contacts, bot_stats=bot_stats)


@app.route('/scheduler', methods=['GET', 'POST'])
@limiter.limit("10 per minute")
@login_required
def scheduler():
    if not current_user.can_use_mass_dm:
        return render_template('dashboard.html', tab='scheduler', locked=True)

    if request.method == 'POST':
        action = request.form.get('action', '')
        if action == 'add':
            bot_id = request.form.get('bot_id', type=int)
            channel_id = clean_channel_id(request.form.get('channel_id', '').strip())
            message = request.form.get('message', '').strip()
            sched_time = request.form.get('scheduled_time', '').strip()
            is_recurring = request.form.get('is_recurring') == 'on'
            interval = request.form.get('interval_minutes', 0, type=int)
            groq_key = request.form.get('groq_api_key', '').strip()
            ai_prompt = request.form.get('ai_prompt', '').strip()
            use_prompt = request.form.get('use_prompt') == 'on'
            rate_limit = request.form.get('rate_limit', 0, type=int)
            webhook_url = request.form.get('webhook_url', '').strip()
            scheduler_webhook_url = request.form.get('scheduler_webhook_url', '').strip()

            if bot_id and channel_id and message and sched_time:
                bot = Bot.query.filter_by(id=bot_id, user_id=current_user.id).first()
                if not bot:
                    add_log(current_user.username, f'BLOCKED: Unauthorized scheduler attempt on bot {bot_id}', 'warning', 'security')
                    abort(403)
                try:
                    offset_mins = request.form.get('timezone_offset', 0, type=int)
                    dt = datetime.strptime(sched_time, '%Y-%m-%dT%H:%M') + timedelta(minutes=offset_mins)
                    sm = ScheduledMessage(
                        user_id=current_user.id,
                        bot_id=bot_id,
                        channel_id=channel_id,
                        message=message,
                        scheduled_time=dt,
                        is_recurring=is_recurring,
                        interval_minutes=max(interval, 1) if is_recurring else 0,
                        groq_api_key=groq_key,
                        ai_prompt=ai_prompt,
                        use_prompt=use_prompt,
                        rate_limit=max(rate_limit, 0),
                        webhook_url=webhook_url,
                        scheduler_webhook_url=scheduler_webhook_url,
                    )
                    db.session.add(sm)
                    db.session.commit()
                    flash('Scheduled message added', 'success')
                except Exception:
                    flash('Invalid date/time format', 'error')
            else:
                flash('All fields are required', 'error')
        elif action == 'delete':
            msg_id = request.form.get('msg_id', type=int)
            if msg_id:
                sm = ScheduledMessage.query.filter_by(id=msg_id, user_id=current_user.id).first()
                if sm:
                    db.session.delete(sm)
                    db.session.commit()
                    flash('Scheduled message removed', 'success')
        return redirect(url_for('scheduler'))

    bots = Bot.query.filter_by(user_id=current_user.id).all()
    scheduled = ScheduledMessage.query.filter_by(user_id=current_user.id).order_by(ScheduledMessage.scheduled_time.asc()).all()
    return render_template('dashboard.html', tab='scheduler', bots=bots, scheduled_messages=scheduled, locked=False)


@app.route('/mass-dm', methods=['GET', 'POST'])
@limiter.limit("5 per minute")
@login_required
def mass_dm():
    if not current_user.can_use_mass_dm:
        return render_template('dashboard.html', tab='mass_dm', locked=True)

    bots = Bot.query.filter_by(user_id=current_user.id).all()

    if request.method == 'POST':
        bot_id = request.form.get('bot_id', type=int)
        message = request.form.get('message', '').strip()
        user_ids_raw = request.form.get('user_ids', '').strip()

        if bot_id and message and user_ids_raw:
            bot = Bot.query.filter_by(id=bot_id, user_id=current_user.id).first()
            if not bot:
                add_log(current_user.username, f'BLOCKED: Unauthorized mass DM attempt on bot {bot_id}', 'warning', 'security')
                abort(403)
            user_ids = [uid.strip() for uid in user_ids_raw.replace('\n', ',').split(',') if uid.strip()]
            add_log(current_user.username, f'Mass DM queued: {len(user_ids)} users via {bot.name}', 'info', 'selfbot')
            flash(f'Mass DM queued for {len(user_ids)} users via {bot.name}. Messages will be sent with anti-detection delays.', 'success')
        else:
            flash('All fields are required', 'error')
        return redirect(url_for('mass_dm'))

    return render_template('dashboard.html', tab='mass_dm', bots=bots, locked=False)


class MinecraftBotManager:
    def __init__(self, user_id=None, log_callback=None):
        self.process = None
        self.connected = False
        self.msa_code = None
        self.msa_uri = None
        self.msa_expires_in = None
        self.link_results = {}
        self.chat_messages = []
        self.lock = threading.Lock()
        self._reader_thread = None
        self.user_id = user_id
        self.mc_username = None
        self.mc_uuid = None
        self.last_error = None
        self.stderr_lines = []
        self.log_callback = log_callback
        self.auth_completed = False

    def is_connected(self):
        with self.lock:
            return self.connected

    def get_cache_dir(self):
        base = os.path.dirname(os.path.abspath(__file__))
        if self.user_id:
            return os.path.join(base, 'donut_auth_cache', f'user_{self.user_id}')
        return os.path.join(base, 'donut_auth_cache', 'default')

    def has_saved_auth(self):
        cache_dir = self.get_cache_dir()
        if not os.path.exists(cache_dir):
            return False
        for f in os.listdir(cache_dir):
            fpath = os.path.join(cache_dir, f)
            if os.path.isfile(fpath) and os.path.getsize(fpath) > 10:
                return True
        return False

    def clear_auth(self):
        cache_dir = self.get_cache_dir()
        if os.path.exists(cache_dir):
            import shutil
            try:
                shutil.rmtree(cache_dir)
            except Exception:
                pass

    def start(self):
        if self.process and self.process.poll() is None:
            self.disconnect()
            time.sleep(1)
        self.connected = False
        self.msa_code = None
        self.msa_uri = None
        self.msa_expires_in = None
        self.link_results = {}
        self.chat_messages = []
        self.mc_username = None
        self.mc_uuid = None
        node_path = 'node'
        bot_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'donut_bot.js')
        self.process = subprocess.Popen(
            [node_path, bot_script],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            preexec_fn=os.setsid if os.name != 'nt' else None
        )
        self._reader_thread = threading.Thread(target=self._read_output, daemon=True)
        self._reader_thread.start()
        self._stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self._stderr_thread.start()

    def _read_output(self):
        while self.process and self.process.poll() is None:
            try:
                line = self.process.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    self._handle_message(msg)
                except json.JSONDecodeError:
                    pass
            except Exception:
                break
        with self.lock:
            self.connected = False

    def _read_stderr(self):
        while self.process and self.process.poll() is None:
            try:
                line = self.process.stderr.readline()
                if not line:
                    break
                line = line.strip()
                if line:
                    logging.info(f'[MC-STDERR] {line}')
                    with self.lock:
                        self.stderr_lines.append(line)
                        if len(self.stderr_lines) > 50:
                            self.stderr_lines = self.stderr_lines[-50:]
                    if 'error' in line.lower() or 'warn' in line.lower() or 'MSA' in line:
                        self._log(f'[stderr] {line[:200]}', 'warning')
            except Exception:
                break

    def _log(self, message, level='info'):
        logging.info(f'[MC] {message}')
        if self.log_callback:
            try:
                self.log_callback(message, level)
            except Exception:
                pass

    def _handle_message(self, msg):
        msg_type = msg.get('type', '')
        with self.lock:
            if msg_type == 'msa_code':
                self.msa_code = msg.get('code')
                self.msa_uri = msg.get('verification_uri', 'https://www.microsoft.com/link')
                self.msa_expires_in = msg.get('expires_in', 900)
            elif msg_type == 'connected':
                self.connected = True
                self.auth_completed = True
                self.mc_username = msg.get('username', '')
                self.mc_uuid = msg.get('uuid', '')
                self._log(f'Minecraft bot spawned as {self.mc_username}')
            elif msg_type == 'disconnected':
                self.connected = False
                reason = msg.get('reason', 'unknown')
                self._log(f'Minecraft bot disconnected: {reason}', 'warning')
            elif msg_type == 'kick_event':
                reason = msg.get('reason', 'unknown')
                self._log(f'Kicked from server: {reason}', 'warning')
            elif msg_type == 'connecting':
                server = msg.get('server', '')
                self._log(f'Connecting to {server}...')
            elif msg_type == 'chat_message':
                self.chat_messages.append(msg.get('message', ''))
            elif msg_type == 'link_success':
                code = msg.get('code', '')
                self.link_results[code] = 'success'
            elif msg_type == 'link_expired':
                code = msg.get('code', '')
                self.link_results[code] = 'expired'
            elif msg_type == 'link_timeout':
                code = msg.get('code', '')
                self.link_results[code] = 'timeout'
            elif msg_type in ('connection_error', 'error'):
                self.last_error = msg.get('error', str(msg))
                self._log(f'Error: {self.last_error}', 'error')
            elif msg_type == 'debug':
                event = msg.get('event', '')
                if event == 'login_success':
                    self.auth_completed = True
                    self._log('Microsoft auth completed, joining server...')
                elif 'reconnect' in str(event):
                    self._log(f'Auto-reconnect: {event}', 'warning')
                elif event == 'max_reconnect_attempts_reached':
                    self._log('Max reconnect attempts reached, giving up', 'error')
                else:
                    logging.info(f'[MC-DEBUG] {msg}')

    def send_command(self, command, params=None):
        if not self.process or self.process.poll() is not None:
            return False
        msg = {'command': command}
        if params:
            msg.update(params)
        try:
            self.process.stdin.write(json.dumps(msg) + '\n')
            self.process.stdin.flush()
            return True
        except Exception:
            return False

    def connect(self, username='VoidConsole', server='donutsmp.net', port=25565, clear_cache=False, ssid=None):
        cache_dir = self.get_cache_dir()
        os.makedirs(cache_dir, exist_ok=True)
        return self.send_command('connect', {
            'config': {
                'minecraft_username': username,
                'server_address': server,
                'server_port': port,
                'profiles_folder': cache_dir,
                'clear_cache': clear_cache,
                'ssid': ssid
            }
        })

    def link(self, code):
        return self.send_command('link', {'code': code})

    def disconnect(self):
        self.send_command('disconnect')
        if self.process:
            pid = self.process.pid
            try:
                self.process.terminate()
                self.process.wait(timeout=3)
            except Exception:
                try:
                    self.process.kill()
                    self.process.wait(timeout=2)
                except Exception:
                    pass
            try:
                import signal
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except Exception:
                pass
            try:
                os.kill(pid, signal.SIGKILL)
            except Exception:
                pass
            try:
                self.process.stdin.close()
            except Exception:
                pass
            try:
                self.process.stdout.close()
            except Exception:
                pass
            try:
                self.process.stderr.close()
            except Exception:
                pass
        self.process = None
        with self.lock:
            self.connected = False
            self.msa_code = None
            self.msa_uri = None
            self.msa_expires_in = None

    def wait_for_msa_code(self, timeout=45):
        start = time.time()
        while time.time() - start < timeout:
            with self.lock:
                if self.msa_code:
                    return True
            time.sleep(0.5)
        return False

    def is_process_alive(self):
        return self.process is not None and self.process.poll() is None

    def wait_for_connection(self, timeout=300, abort_on_msa=False):
        start = time.time()
        while time.time() - start < timeout:
            with self.lock:
                if self.connected:
                    return True
                if abort_on_msa and self.msa_code:
                    return False
            if not self.is_process_alive():
                logging.error(f'[MC] Process died while waiting for connection. Last error: {self.last_error}')
                return False
            time.sleep(1)
        return False

    def wait_for_link_result(self, code, timeout=65):
        start = time.time()
        while time.time() - start < timeout:
            with self.lock:
                if code in self.link_results:
                    return self.link_results[code]
            time.sleep(0.5)
        return 'timeout'


DONUTSMP_SERVER_ID = 299949507989340160
DONUTSMP_CHANNEL_ID = 1003030907537596466
DONUTSMP_BOT_ID = 1003034848413356042
DONUTSMP_APP_ID = 1322266490069844101
LINK_COMMAND_ID = '1414413949566193769'
LINK_COMMAND_VERSION = '1414413949566193770'

def run_donut_verification(user_id, tokens, username, ssid=None):
    job = {
        'status': 'running',
        'logs': [],
        'tokens': [],
        'current_device_code': None,
        'current_user_code': None,
        'current_verification_uri': None,
        'mc_status': 'starting',
        'started_at': datetime.now(UTC).strftime('%H:%M:%S'),
    }

    for i, token in enumerate(tokens):
        token = token.strip()
        if not token:
            continue
        token_entry = {
            'index': i,
            'token_preview': token[:20] + '...' + token[-5:] if len(token) > 25 else token,
            'status': 'pending',
            'message': ''
        }
        job['tokens'].append(token_entry)

    with donut_verifier_lock:
        donut_verifier_jobs[user_id] = job

    def _add_log(msg, level='info'):
        entry = {
            'time': datetime.now(UTC).strftime('%H:%M:%S'),
            'message': msg,
            'level': level
        }
        job['logs'].append(entry)

    def _fetch_link_command_info(token):
        try:
            resp = http_requests.get(
                f'https://discord.com/api/v10/guilds/{DONUTSMP_SERVER_ID}/application-command-index',
                headers={'Authorization': token},
                timeout=10
            )
            if resp.status_code == 200:
                data = resp.json()
                for cmd in data.get('application_commands', []):
                    if cmd.get('name') == 'link' and str(cmd.get('application_id')) == str(DONUTSMP_APP_ID):
                        return cmd.get('id'), cmd.get('version')
        except Exception:
            pass
        return LINK_COMMAND_ID, LINK_COMMAND_VERSION

    def _invoke_link_command(token):
        try:
            cmd_id, cmd_version = _fetch_link_command_info(token)
            _add_log(f'Using /link command id={cmd_id}, version={cmd_version}')

            nonce = str(random.randint(10**17, 10**18))
            link_code_result = [None]
            link_error = [None]
            gateway_ready = threading.Event()
            code_received = threading.Event()
            ws_ref = [None]
            session_id_ref = [None]

            def on_ws_message(ws, raw_msg):
                try:
                    data = json.loads(raw_msg)
                    op = data.get('op')
                    t = data.get('t')
                    d = data.get('d')

                    if op == 10:
                        heartbeat_interval = d.get('heartbeat_interval', 41250)
                        def heartbeat_loop():
                            while not code_received.is_set():
                                try:
                                    ws.send(json.dumps({"op": 1, "d": None}))
                                except Exception:
                                    break
                                code_received.wait(heartbeat_interval / 1000.0)
                        hb_thread = threading.Thread(target=heartbeat_loop, daemon=True)
                        hb_thread.start()

                        ws.send(json.dumps({
                            "op": 2,
                            "d": {
                                "token": token,
                                "capabilities": 16381,
                                "properties": {
                                    "os": "Windows",
                                    "browser": "Chrome",
                                    "device": "",
                                    "system_locale": "en-US",
                                    "browser_user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                                    "browser_version": "120.0.0.0",
                                    "os_version": "10",
                                    "referrer": "",
                                    "referring_domain": "",
                                    "referrer_current": "",
                                    "referring_domain_current": "",
                                    "release_channel": "stable",
                                    "client_build_number": 250000
                                },
                                "presence": {"status": "invisible", "activities": [], "since": 0, "afk": False},
                                "compress": False
                            }
                        }))

                    elif op == 0 and t == 'READY':
                        session_id_ref[0] = d.get('session_id', 'gateway_session')
                        _add_log(f'Gateway connected, session: {session_id_ref[0]}')
                        gateway_ready.set()

                    elif op == 0 and t in ('INTERACTION_SUCCESS', 'INTERACTION_CREATE', 'INTERACTION_IFRAME_MODAL_CREATE'):
                        _add_log(f'[GW] Received {t} event: {json.dumps(d or {})[:300]}')
                        if d:
                            full_text = ''
                            content = d.get('content', '')
                            if content:
                                full_text += content
                            for embed in d.get('embeds', []):
                                if embed.get('title'):
                                    full_text += ' ' + embed['title']
                                if embed.get('description'):
                                    full_text += ' ' + embed['description']
                                for field in embed.get('fields', []):
                                    full_text += ' ' + field.get('name', '') + ' ' + field.get('value', '')
                            if full_text and 'Generating code' not in full_text:
                                cleaned = re.sub(r'[*`\[\]()]', '', full_text)
                                code_match = re.search(r'(?:code[:\s]*|/link\s+)([A-Za-z0-9\-]{5,8})', cleaned, re.IGNORECASE)
                                if not code_match:
                                    code_match = re.search(r'\b([A-Za-z0-9]{5,8})\b', cleaned)
                                if code_match:
                                    candidate = code_match.group(1)
                                    skip_words = {'Generating', 'code', 'link', 'Link', 'your', 'Your', 'the', 'The', 'with', 'this'}
                                    if candidate not in skip_words:
                                        _add_log(f'[GW] Found code in {t}: {candidate}')
                                        link_code_result[0] = candidate
                                        code_received.set()

                    elif op == 0 and t and t not in ('MESSAGE_CREATE', 'MESSAGE_UPDATE', 'READY', 'INTERACTION_SUCCESS', 'INTERACTION_CREATE', 'INTERACTION_IFRAME_MODAL_CREATE', 'READY_SUPPLEMENTAL', 'SESSIONS_REPLACE', 'PRESENCE_UPDATE', 'GUILD_MEMBER_LIST_UPDATE', 'PASSIVE_UPDATE_V2', 'TYPING_START'):
                        _add_log(f'[GW] Event: {t}, data preview: {json.dumps(d or {})[:200]}')

                    if op == 0 and t in ('MESSAGE_CREATE', 'MESSAGE_UPDATE'):
                        if not d:
                            return
                        channel_id = d.get('channel_id')
                        author_id = str(d.get('author', {}).get('id', ''))
                        msg_flags = d.get('flags', 0)

                        if str(channel_id) == str(DONUTSMP_CHANNEL_ID):
                            content_preview = (d.get('content', '') or '')[:100]
                            embed_count = len(d.get('embeds', []))
                            interaction_info = d.get('interaction') or d.get('interaction_metadata') or {}
                            has_interaction = bool(interaction_info)
                            _add_log(f'[GW] {t} in donut channel: author={author_id}, flags={msg_flags}, embeds={embed_count}, has_interaction={has_interaction}, content="{content_preview}"')

                        is_donut_channel = str(channel_id) == str(DONUTSMP_CHANNEL_ID)
                        is_donut_response = (
                            is_donut_channel and
                            author_id in (str(DONUTSMP_BOT_ID), str(DONUTSMP_APP_ID))
                        )
                        interaction_data = d.get('interaction') or d.get('interaction_metadata') or {}
                        is_our_interaction = interaction_data.get('name') == 'link'
                        is_update_in_channel = (t == 'MESSAGE_UPDATE' and is_donut_channel)

                        if not (is_donut_response or is_our_interaction or is_update_in_channel):
                            return

                        full_text = d.get('content', '')
                        for embed in d.get('embeds', []):
                            if embed.get('title'):
                                full_text += ' ' + embed['title']
                            if embed.get('description'):
                                full_text += ' ' + embed['description']
                        for field in [f for e in d.get('embeds', []) for f in e.get('fields', [])]:
                            full_text += ' ' + field.get('name', '') + ' ' + field.get('value', '')

                        cleaned = re.sub(r'[*`\[\]()]', '', full_text)

                        code_match = re.search(r'(?:code[:\s]*|/link\s+)([A-Za-z0-9\-]{5,8})', cleaned, re.IGNORECASE)
                        if not code_match:
                            code_match = re.search(r'\b([A-Za-z0-9]{5,8})\b', cleaned)

                        if code_match:
                            candidate = code_match.group(1)
                            skip_words = {'Generating', 'code', 'link', 'Link', 'your', 'Your', 'the', 'The', 'with', 'this', 'Click', 'click', 'here', 'Here', 'have', 'been'}
                            if len(candidate) >= 5 and candidate not in skip_words:
                                _add_log(f'[GW] Found link code in {t}: {candidate}')
                                link_code_result[0] = candidate
                                code_received.set()
                        elif full_text.strip() and full_text.strip() != 'Generating code..':
                            _add_log(f'[GW] Matched message but no code found in text: "{full_text[:200]}"', 'warning')

                except Exception as e:
                    _add_log(f'[GW] WebSocket handler error: {str(e)}', 'error')

            def on_ws_error(ws, error):
                link_error[0] = str(error)
                gateway_ready.set()
                code_received.set()

            def on_ws_close(ws, close_status, close_msg):
                gateway_ready.set()
                code_received.set()

            def on_ws_open(ws):
                pass

            gateway_url = 'wss://gateway.discord.gg/?v=10&encoding=json'
            ws = ws_client.WebSocketApp(
                gateway_url,
                on_message=on_ws_message,
                on_error=on_ws_error,
                on_close=on_ws_close,
                on_open=on_ws_open
            )
            ws_ref[0] = ws

            ws_thread = threading.Thread(target=lambda: ws.run_forever(), daemon=True)
            ws_thread.start()

            if not gateway_ready.wait(timeout=15):
                try:
                    ws.close()
                except Exception:
                    pass
                return None, 'Gateway connection timed out'

            if link_error[0]:
                try:
                    ws.close()
                except Exception:
                    pass
                return None, f'Gateway error: {link_error[0]}'

            session_id = session_id_ref[0] or 'gateway_session'

            payload = {
                "type": 2,
                "application_id": str(DONUTSMP_APP_ID),
                "guild_id": str(DONUTSMP_SERVER_ID),
                "channel_id": str(DONUTSMP_CHANNEL_ID),
                "session_id": session_id,
                "data": {
                    "version": str(cmd_version),
                    "id": str(cmd_id),
                    "guild_id": str(DONUTSMP_SERVER_ID),
                    "name": "link",
                    "type": 1,
                    "options": [],
                    "application_command": {
                        "id": str(cmd_id),
                        "type": 1,
                        "application_id": str(DONUTSMP_APP_ID),
                        "guild_id": str(DONUTSMP_SERVER_ID),
                        "version": str(cmd_version),
                        "name": "link",
                        "description": "Generate code to link account in game",
                        "options": [],
                        "integration_types": [0]
                    },
                    "attachments": []
                },
                "nonce": nonce,
                "analytics_location": "slash_ui"
            }
            headers = {
                'Authorization': token,
                'Content-Type': 'application/json'
            }
            resp = http_requests.post('https://discord.com/api/v10/interactions', json=payload, headers=headers, timeout=15)
            _add_log(f'[GW] Interaction POST response: status={resp.status_code}, body="{resp.text[:200]}"')
            if resp.status_code not in (200, 201, 204):
                try:
                    ws.close()
                except Exception:
                    pass
                return None, f'Slash command failed (HTTP {resp.status_code}): {resp.text[:200]}'

            _add_log('Waiting for /link response via gateway...')

            if code_received.wait(timeout=30):
                try:
                    ws.close()
                except Exception:
                    pass
                if link_code_result[0]:
                    return link_code_result[0], None
                if link_error[0]:
                    return None, f'Gateway error: {link_error[0]}'

            try:
                ws.close()
            except Exception:
                pass

            _add_log('[GW] Gateway timed out, trying to poll recent messages...')
            try:
                poll_resp = http_requests.get(
                    f'https://discord.com/api/v10/channels/{DONUTSMP_CHANNEL_ID}/messages?limit=5',
                    headers={'Authorization': token},
                    timeout=10
                )
                if poll_resp.status_code == 200:
                    for msg in poll_resp.json():
                        author_id = str(msg.get('author', {}).get('id', ''))
                        if author_id not in (str(DONUTSMP_BOT_ID), str(DONUTSMP_APP_ID)):
                            continue
                        full_text = msg.get('content', '')
                        for embed in msg.get('embeds', []):
                            if embed.get('title'):
                                full_text += ' ' + embed['title']
                            if embed.get('description'):
                                full_text += ' ' + embed['description']
                            for field in embed.get('fields', []):
                                full_text += ' ' + field.get('name', '') + ' ' + field.get('value', '')
                        if full_text and 'Generating code' not in full_text:
                            cleaned = re.sub(r'[*`\[\]()]', '', full_text)
                            code_match = re.search(r'(?:code[:\s]*|/link\s+)([A-Za-z0-9\-]{5,8})', cleaned, re.IGNORECASE)
                            if not code_match:
                                code_match = re.search(r'\b([A-Za-z0-9]{5,8})\b', cleaned)
                            if code_match:
                                candidate = code_match.group(1)
                                skip_words = {'Generating', 'code', 'link', 'Link', 'your', 'Your', 'the', 'The', 'with', 'this'}
                                if len(candidate) >= 5 and candidate not in skip_words:
                                    _add_log(f'[Poll] Found link code in channel messages: {candidate}')
                                    return candidate, None
                        _add_log(f'[Poll] Message from bot: "{full_text[:150]}"')
            except Exception as e:
                _add_log(f'[Poll] Failed to poll messages: {e}', 'warning')

            return None, 'Timed out waiting for /link response (no ephemeral message received)'
        except Exception as e:
            try:
                if ws_ref and ws_ref[0]:
                    ws_ref[0].close()
            except Exception:
                pass
            return None, str(e)

    def _verify_single_token(token_entry, token, mc_bot):
        token_preview = token_entry['token_preview']
        idx = token_entry['index'] + 1
        _add_log(f'[Token {idx}] Starting verification for {token_preview}')
        token_entry['status'] = 'verifying'

        # Ensure it doesn't accidentally use Bot prefix for user tokens
        actual_token = token.replace('Bot ', '') if 'Bot ' in token else token
        headers = {'Authorization': actual_token}
        try:
            resp = http_requests.get('https://discord.com/api/v10/users/@me', headers=headers, timeout=10)
            if resp.status_code != 200:
                _add_log(f'[Token {idx}] Invalid Discord token (HTTP {resp.status_code})', 'error')
                token_entry['status'] = 'failed'
                token_entry['message'] = f'Invalid token (HTTP {resp.status_code})'
                return
            discord_user = resp.json()
            discord_name = discord_user.get('username', 'Unknown')
            _add_log(f'[Token {idx}] Token valid - Discord user: {discord_name}')
        except Exception as e:
            _add_log(f'[Token {idx}] Failed to validate token: {str(e)}', 'error')
            token_entry['status'] = 'failed'
            token_entry['message'] = f'Validation error: {str(e)}'
            return

        if not mc_bot.is_connected():
            _add_log(f'[Token {idx}] Waiting for Minecraft bot to reconnect...', 'warning')
            if not mc_bot.wait_for_connection(timeout=30):
                _add_log(f'[Token {idx}] Minecraft bot not connected', 'error')
                token_entry['status'] = 'failed'
                token_entry['message'] = 'Minecraft bot disconnected'
                return

        try:
            guild_check = http_requests.get(
                f'https://discord.com/api/v10/guilds/{DONUTSMP_SERVER_ID}',
                headers=headers, timeout=10
            )
            if guild_check.status_code == 403 or guild_check.status_code == 404:
                _add_log(f'[Token {idx}] Token is not in the DonutSMP server — joining...', 'warning')
                try:
                    join_resp = http_requests.post(
                        f'https://discord.com/api/v10/invites/donutsmp',
                        headers=headers, timeout=10
                    )
                    if join_resp.status_code in (200, 201, 204):
                        _add_log(f'[Token {idx}] Joined DonutSMP server')
                        time.sleep(2)
                    else:
                        _add_log(f'[Token {idx}] Could not join DonutSMP server (HTTP {join_resp.status_code})', 'error')
                        token_entry['status'] = 'failed'
                        token_entry['message'] = 'Not in DonutSMP server and could not join'
                        return
                except Exception as je:
                    _add_log(f'[Token {idx}] Failed to join server: {je}', 'error')
                    token_entry['status'] = 'failed'
                    token_entry['message'] = f'Could not join server: {je}'
                    return
        except Exception:
            pass

        _add_log(f'[Token {idx}] Invoking /link slash command...')
        token_entry['status'] = 'linking'
        token_entry['message'] = 'Sending /link command...'

        code, error = _invoke_link_command(token)
        if not code:
            _add_log(f'[Token {idx}] Failed to get link code: {error or "unknown error"}', 'error')
            token_entry['status'] = 'failed'
            token_entry['message'] = f'Link command failed: {error or "unknown"}'
            return

        _add_log(f'[Token {idx}] Got verification code: {code}')

        _add_log(f'[Token {idx}] Sending /link {code} to Minecraft...')
        mc_bot.link(code)

        result = mc_bot.wait_for_link_result(code, timeout=65)

        if result == 'success':
            _add_log(f'[Token {idx}] Successfully verified! Discord account {discord_name} linked', 'success')
            token_entry['status'] = 'success'
            token_entry['message'] = f'Verified as {discord_name}'
        elif result == 'expired':
            _add_log(f'[Token {idx}] Link code expired', 'error')
            token_entry['status'] = 'failed'
            token_entry['message'] = 'Link code expired'
        else:
            _add_log(f'[Token {idx}] Link timed out', 'error')
            token_entry['status'] = 'failed'
            token_entry['message'] = 'Link timed out'

    def _run():
        _add_log(f'Starting Donut Discord Verifier with {len(job["tokens"])} token(s)')

        _add_log('Starting Minecraft bot (mineflayer)...')
        job['mc_status'] = 'starting'

        def _mc_log(message, level='info'):
            _add_log(f'[MC] {message}', level)

        mc_bot = MinecraftBotManager(user_id=user_id, log_callback=_mc_log)

        try:
            mc_bot.start()
        except Exception as e:
            _add_log(f'Failed to start Minecraft bot: {str(e)}', 'error')
            job['status'] = 'completed'
            job['mc_status'] = 'failed'
            return

        _add_log('Connecting to Minecraft with SSID session token...')
        mc_bot.connect(username='VoidConsole', ssid=ssid)

        if not mc_bot.wait_for_connection(timeout=90):
            if not mc_bot.is_process_alive():
                err_msg = mc_bot.last_error or 'Process crashed'
                _add_log(f'Minecraft bot process died: {err_msg}', 'error')
                if mc_bot.stderr_lines:
                    for line in mc_bot.stderr_lines[-5:]:
                        _add_log(f'[stderr] {line}', 'error')
            else:
                _add_log('Failed to connect to Minecraft server within 90 seconds', 'error')
            
            mc_bot.disconnect()
            job['status'] = 'completed'
            job['mc_status'] = 'failed'
            return

        job['mc_status'] = 'connected'
        _add_log(f'Connected to Minecraft server as {mc_bot.mc_username or "unknown"}!', 'success')

        if mc_bot.mc_username:
            try:
                with app.app_context():
                    user = db.session.get(User, user_id)
                    if user:
                        user.mc_username = mc_bot.mc_username
                        user.mc_uuid = mc_bot.mc_uuid or ''
                        db.session.commit()
                        _add_log(f'Saved Minecraft account: {mc_bot.mc_username}')
            except Exception as e:
                _add_log(f'Could not save MC account info: {str(e)}', 'warning')

        for token_entry in job['tokens']:
            idx = token_entry['index']
            token = tokens[idx].strip()

            if idx > 0:
                delay = 3
                _add_log(f'Waiting {delay}s before next token (rate limit protection)...')
                time.sleep(delay)

            _verify_single_token(token_entry, token, mc_bot)

        _add_log('Disconnecting Minecraft bot...')
        mc_bot.disconnect()

        succeeded = sum(1 for t in job['tokens'] if t['status'] == 'success')
        failed = sum(1 for t in job['tokens'] if t['status'] == 'failed')
        _add_log(f'Verification complete: {succeeded} succeeded, {failed} failed')
        job['status'] = 'completed'
        job['mc_status'] = 'disconnected'
        job['current_device_code'] = None
        job['current_user_code'] = None

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()


@app.route('/donut-verifier')
@login_required
def donut_verifier():
    if not current_user.can_use_donut_verifier:
        flash('Donut Discord Verifier requires the Donut plan ($15/month).', 'error')
        return redirect(url_for('purchase'))
    job = donut_verifier_jobs.get(current_user.id)
    add_log(current_user.username, 'Viewed Donut Verifier')
    return render_template('dashboard.html', tab='donut_verifier', verifier_job=job)


@app.route('/donut-verifier/start', methods=['POST'])
@limiter.limit("5 per minute")
@login_required
def donut_verifier_start():
    if not current_user.can_use_donut_verifier:
        flash('Donut Discord Verifier requires the Donut plan.', 'error')
        return redirect(url_for('purchase'))

    existing = donut_verifier_jobs.get(current_user.id)
    if existing and existing['status'] == 'running':
        try:
            import subprocess as sp
            result = sp.run(['pkill', '-f', 'donut_bot.js'], capture_output=True, timeout=3)
        except Exception:
            pass
        existing['status'] = 'completed'
        time.sleep(1)

    tokens_text = request.form.get('tokens', '').strip()
    if not tokens_text:
        flash('Please enter at least one Discord token.', 'error')
        return redirect(url_for('donut_verifier'))

    tokens = [t.strip() for t in tokens_text.strip().split('\n') if t.strip()]
    if not tokens:
        flash('No valid tokens found.', 'error')
        return redirect(url_for('donut_verifier'))

    if len(tokens) > 50:
        flash('Maximum 50 tokens per batch.', 'error')
        return redirect(url_for('donut_verifier'))

    ssid = request.form.get('ssid', '').strip()
    if not ssid:
        flash('Please provide an SSID token.', 'error')
        return redirect(url_for('donut_verifier'))

    has_donut_plan = current_user.has_donut or current_user.role == 'admin'
    if not has_donut_plan:
        token_count = len(tokens)
        updated = db.session.execute(
            db.text("UPDATE users SET donut_credits = donut_credits - :cnt WHERE id = :uid AND donut_credits >= :cnt"),
            {'cnt': token_count, 'uid': current_user.id}
        )
        db.session.commit()
        if updated.rowcount == 0:
            user_credits = current_user.donut_credits or 0
            flash(f'Not enough donut credits. You have {user_credits} credit(s) but submitted {token_count} token(s).', 'error')
            return redirect(url_for('donut_verifier'))
        db.session.refresh(current_user)
        add_log(current_user.username, f'Used {token_count} donut credit(s) ({current_user.donut_credits} remaining)')

    run_donut_verification(current_user.id, tokens, current_user.username, ssid=ssid)
    add_log(current_user.username, f'Started Donut Verifier with {len(tokens)} tokens')
    return redirect(url_for('donut_verifier'))


@app.route('/donut-verifier/status')
@login_required
def donut_verifier_status():
    if not current_user.can_use_donut_verifier:
        return jsonify({'error': 'Plan required'}), 403

    job = donut_verifier_jobs.get(current_user.id)
    if not job:
        return jsonify({'status': 'none', 'logs': [], 'tokens': []})

    last_log_index = request.args.get('last_log', 0, type=int)
    with donut_verifier_lock:
        logs_snapshot = list(job['logs'])
        tokens_snapshot = [dict(t) for t in job['tokens']]
        status = job['status']
        user_code = job.get('current_user_code')
        verify_uri = job.get('current_verification_uri')
        mc_status = job.get('mc_status', 'unknown')

    new_logs = logs_snapshot[last_log_index:]

    return jsonify({
        'status': status,
        'logs': new_logs,
        'total_logs': len(logs_snapshot),
        'tokens': tokens_snapshot,
        'current_user_code': user_code,
        'current_verification_uri': verify_uri,
        'mc_status': mc_status
    })


@app.route('/donut-verifier/clear', methods=['POST'])
@login_required
def donut_verifier_clear():
    if not current_user.can_use_donut_verifier:
        flash('Donut Discord Verifier requires the Donut plan.', 'error')
        return redirect(url_for('purchase'))
    existing = donut_verifier_jobs.get(current_user.id)
    if existing and existing['status'] == 'running':
        flash('Cannot clear while a verification is running.', 'error')
        return redirect(url_for('donut_verifier'))
    donut_verifier_jobs.pop(current_user.id, None)
    return redirect(url_for('donut_verifier'))


@app.route('/donut-verifier/disconnect-mc', methods=['POST'])
@login_required
def donut_verifier_disconnect_mc():
    if not current_user.can_use_donut_verifier:
        flash('Donut Discord Verifier requires the Donut plan.', 'error')
        return redirect(url_for('purchase'))
    mc_manager = MinecraftBotManager(user_id=current_user.id)
    mc_manager.clear_auth()
    current_user.mc_username = ''
    current_user.mc_uuid = ''
    db.session.commit()
    add_log(current_user.username, 'Disconnected saved Minecraft account')
    flash('Minecraft account disconnected. You will need to re-authenticate next time.', 'success')
    return redirect(url_for('donut_verifier'))


@app.route('/admin', methods=['GET', 'POST'])
@limiter.limit("10 per minute")
@login_required
def admin_panel():
    if current_user.role != 'admin':
        flash('Access denied', 'error')
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        action = request.form.get('action', '')
        user_id = request.form.get('user_id')

        # License Management
        if action == 'generate_license':
            tier = request.form.get('tier', 'none')
            duration = int(request.form.get('duration_days', 30))
            count = int(request.form.get('count', 1))
            
            import secrets
            import string
            length = 16
            for _ in range(count):
                new_key = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for i in range(length))
                formatted_key = '-'.join([new_key[i:i+4] for i in range(0, len(new_key), 4)])
                lic = License(key=formatted_key, tier=tier, duration_days=duration)
                db.session.add(lic)
            
            db.session.commit()
            add_log(current_user.username, f'Generated {count} {tier} license keys')
            flash(f'Successfully generated {count} keys.', 'success')
            return redirect(url_for('admin_panel'))

        if action == 'delete_license':
            lic_id = request.form.get('license_id')
            lic = License.query.get(lic_id)
            if lic:
                db.session.delete(lic)
                db.session.commit()
                flash('License deleted.', 'success')
                return redirect(url_for('admin_panel'))

        if action == 'grant_credits' and user_id:
            credits_amount = request.form.get('credits_amount', '1')
            try:
                credits_amount = max(1, min(100, int(credits_amount)))
            except (ValueError, TypeError):
                credits_amount = 1
            user = db.session.get(User, int(user_id))
            if user:
                user.donut_credits = (user.donut_credits or 0) + credits_amount
                db.session.commit()
                add_log(current_user.username, f'Granted {credits_amount} donut credit(s) to {user.discord_username or user.username}')
                flash(f'Granted {credits_amount} donut credit(s) to {user.discord_username or user.username}', 'success')
            else:
                flash('User not found', 'error')

        if action == 'toggle_donut' and user_id:
            donut_action = request.form.get('donut_action', '')
            user = db.session.get(User, int(user_id))
            if user:
                if donut_action == 'add':
                    user.has_donut = True
                    duration = request.form.get('duration', 'lifetime')
                    duration_amount = request.form.get('duration_amount', '1')
                    try:
                        duration_amount = max(1, int(duration_amount))
                    except (ValueError, TypeError):
                        duration_amount = 1
                    if duration == 'lifetime':
                        user.donut_expires_at = None
                    else:
                        unit_map = {
                            'hours': timedelta(hours=duration_amount),
                            'days': timedelta(days=duration_amount),
                            'weeks': timedelta(weeks=duration_amount),
                            'months': timedelta(days=duration_amount * 30),
                        }
                        delta = unit_map.get(duration)
                        if delta:
                            user.donut_expires_at = datetime.now(UTC) + delta
                        else:
                            user.donut_expires_at = None
                    db.session.commit()
                    duration_label = 'Lifetime' if duration == 'lifetime' else f'{duration_amount} {duration.capitalize()}'
                    add_log(current_user.username, f'Added Donut add-on to {user.discord_username or user.username} ({duration_label})')
                    flash(f'Added Donut add-on to {user.discord_username or user.username} ({duration_label})', 'success')
                elif donut_action == 'remove':
                    user.has_donut = False
                    user.donut_expires_at = None
                    db.session.commit()
                    add_log(current_user.username, f'Removed Donut add-on from {user.discord_username or user.username}')
                    flash(f'Removed Donut add-on from {user.discord_username or user.username}', 'success')
                elif action == 'set_custom_limit':
                    try:
                        custom_max_bots = request.form.get('custom_max_bots')
                        if custom_max_bots:
                            user.custom_max_bots = int(custom_max_bots)
                        else:
                            user.custom_max_bots = None
                        db.session.commit()
                        limit_label = user.custom_max_bots if user.custom_max_bots else 'Default'
                        add_log(current_user.username, f'Set custom bot limit for {user.username} to {limit_label}')
                        flash(f'Bot limit for {user.username} set to {limit_label}', 'success')
                    except ValueError:
                        flash('Invalid bot limit value', 'error')
            else:
                flash('User not found', 'error')

        new_plan = request.form.get('plan')
        duration = request.form.get('duration', 'lifetime')
        duration_amount = request.form.get('duration_amount', '1')
        try:
            duration_amount = max(1, int(duration_amount))
        except (ValueError, TypeError):
            duration_amount = 1
        if action not in ('grant_credits', 'toggle_donut') and user_id and new_plan in ('none', 'trial', 'basic', 'pro'):
            user = db.session.get(User, int(user_id))
            if user:
                old_plan = user.plan
                user.plan = new_plan
                if new_plan == 'none':
                    user.plan_expires_at = None
                elif duration == 'lifetime':
                    user.plan_expires_at = None
                else:
                    unit_map = {
                        'hours': timedelta(hours=duration_amount),
                        'days': timedelta(days=duration_amount),
                        'weeks': timedelta(weeks=duration_amount),
                        'months': timedelta(days=duration_amount * 30),
                    }
                    delta = unit_map.get(duration)
                    if delta:
                        user.plan_expires_at = datetime.now(UTC) + delta
                    else:
                        user.plan_expires_at = None
                db.session.commit()
                if duration == 'lifetime':
                    duration_label = 'Lifetime'
                else:
                    duration_label = f'{duration_amount} {duration.capitalize()}'
                add_log(current_user.username, f'Changed {user.username} plan: {old_plan} -> {new_plan} ({duration_label})')
                flash(f'Updated {user.username} to {new_plan} plan ({duration_label})', 'success')

    search_query = request.args.get('search', '').strip()
    if search_query:
        users = User.query.filter(
            or_(
                User.username.ilike(f'%{search_query}%'),
                User.discord_id.ilike(f'%{search_query}%'),
                User.discord_username.ilike(f'%{search_query}%')
            )
        ).all()
    else:
        users = User.query.all()

    ref_search_query = request.args.get('ref_search', '').strip()
    ref_search_results = []
    if ref_search_query:
        ref_search_results = User.query.filter(User.username.ilike(f'%{ref_search_query}%')).all()

    total_users = User.query.count()
    total_bots = Bot.query.count()
    active_bots = Bot.query.filter_by(is_active=True).count()
    total_dms = DMMessage.query.count()
    
    licenses = License.query.order_by(License.created_at.desc()).all()

    add_log(current_user.username, 'Viewed admin panel')
    return render_template('dashboard.html', tab='admin', users=users,
                           search_query=search_query, total_users=total_users,
                           total_bots_count=total_bots, active_bots_count=active_bots,
                           total_dms_count=total_dms,
                           ref_search_query=ref_search_query, ref_search_results=ref_search_results,
                           licenses=licenses)


@app.route('/admin/delete_user/<int:user_id>', methods=['POST'])
@limiter.limit("5 per minute")
@login_required
def admin_delete_user(user_id):
    if current_user.role != 'admin':
        flash('Access denied', 'error')
        return redirect(url_for('dashboard'))
    user = db.session.get(User, user_id)
    if not user:
        flash('User not found', 'error')
        return redirect(url_for('admin_panel'))
    if user.id == current_user.id:
        flash('Cannot delete your own account', 'error')
        return redirect(url_for('admin_panel'))
    uname = user.discord_username or user.username
    DMMessage.query.filter_by(user_id=user.id).delete()
    ChatMessage.query.filter_by(sender=user.username).delete()
    ScheduledMessage.query.filter_by(user_id=user.id).delete()
    BlacklistedUser.query.filter_by(user_id=user.id).delete()
    for bot in Bot.query.filter_by(user_id=user.id).all():
        stop_bot_worker(bot.id)
        BotSettings.query.filter_by(bot_id=bot.id).delete()
    Bot.query.filter_by(user_id=user.id).delete()
    UserSettings.query.filter_by(user_id=user.id).delete()
    db.session.delete(user)
    db.session.commit()
    add_log(current_user.username, f'Deleted user: {uname} (ID {user_id})')
    flash(f'Deleted user {uname}', 'success')
    return redirect(url_for('admin_panel'))

@app.route('/hypixel_adbot', methods=['GET', 'POST', 'DELETE'])
@limiter.limit("10 per minute")
@login_required
def hypixel_adbot():
    if request.method == 'DELETE':
        try:
            import requests
            # Use the same logic as the stop button in dashboard
            # This is just a safety measure in case something hits /hypixel_adbot with DELETE
            return "Proxying to API", 200
        except:
            pass
            
    if request.method == 'POST':
        ssid = request.form.get('ssid', '').strip()
        message = request.form.get('message', '').strip()
        keywords = request.form.get('keywords', '').strip()
        ignore_words = request.form.get('ignore_words', '').strip()
        delay_time = request.form.get('delay_time', '10')
        first_msg = request.form.get('first_msg', '').strip()
        webhook_url = request.form.get('webhook_url', '').strip()
        auto_msg = request.form.get('auto_msg', '').strip()
        auto_msg_delay = request.form.get('auto_msg_delay', '30').strip()
        
        if ssid and message:
            try:
                import requests
                resp = requests.post('http://localhost:3000/api/bots/start', json={
                    'targetModule': 'hypixel',
                    'token': ssid,
                    'message': message,
                    'keywords': keywords,
                    'ignore_words': ignore_words,
                    'delay': delay_time,
                    'first_msg': first_msg,
                    'webhook_url': webhook_url,
                    'owner': current_user.username,
                    'auto_msg': auto_msg,
                    'auto_msg_delay': auto_msg_delay
                }, headers={'Authorization': f"Bearer {os.environ.get('OWNER_KEY', 'RomeoXLover')}"}, timeout=3)
                flash('Hypixel AdBot launched automatically via API server.', 'success')
            except Exception as e:
                flash('Hypixel AdBot configurations saved and queued. Ensure the JS Node server is running on port 3000.', 'info')
        else:
            flash('SSID and Message are required.', 'error')
        return redirect(url_for('hypixel_adbot'))
    
    # Filter logs specific to hypixel adbots
    logs = [log for log in console_logs if log.get('source') == 'hypixel_adbot']
    return render_template('dashboard.html', tab='hypixel_adbot', logs=logs)

@app.route('/catpvp_adbot', methods=['GET', 'POST'])
@limiter.limit("10 per minute")
@login_required
def catpvp_adbot():
    if request.method == 'POST':
        ssid = request.form.get('ssid', '').strip()
        gamemode = request.form.get('gamemode', 'sword').strip()
        message = request.form.get('message', '').strip()
        webhook_url = request.form.get('webhook_url', '').strip()
        
        if ssid and message:
            try:
                import requests
                resp = requests.post('http://localhost:3000/api/bots/start', json={
                    'targetModule': 'catpvp',
                    'token': ssid,
                    'gamemode': gamemode,
                    'message': message,
                    'webhook_url': webhook_url,
                    'owner': current_user.username
                }, headers={'Authorization': f"Bearer {os.environ.get('OWNER_KEY', 'RomeoXLover')}"}, timeout=3)
                flash('Catpvp AdBot launched successfully.', 'success')
            except Exception as e:
                flash('Catpvp AdBot configurations saved and queued. Ensure the JS Node server is running on port 3000.', 'info')
        else:
            flash('SSID and Message are required.', 'error')
        return redirect(url_for('catpvp_adbot'))
    
    logs = [log for log in console_logs if log.get('source') == 'catpvp_adbot']
    return render_template('dashboard.html', tab='catpvp_adbot', logs=logs)

@app.route('/donut_adbot', methods=['GET', 'POST', 'DELETE'])
@limiter.limit("10 per minute")
@login_required
def donut_adbot():
    if request.method == 'DELETE':
        return "Proxying to API", 200
        
    if request.method == 'POST':
        ssid = request.form.get('ssid', '').strip()
        team_name = request.form.get('team_name', '').strip()
        trigger_words = request.form.get('trigger_words', '').strip()
        delay_time = request.form.get('delay_time', '10')
        message = request.form.get('message', '').strip()
        webhook_url = request.form.get('webhook_url', '').strip()
        auto_msg = request.form.get('auto_msg', '').strip()
        auto_msg_delay = request.form.get('auto_msg_delay', '30').strip()
        
        if ssid and message:
            try:
                import requests
                resp = requests.post('http://localhost:3000/api/bots/start', json={
                    'targetModule': 'donut',
                    'token': ssid,
                    'team_name': team_name,
                    'trigger_words': trigger_words,
                    'delay': delay_time,
                    'message': message,
                    'webhook_url': webhook_url,
                    'owner': current_user.username,
                    'auto_msg': auto_msg,
                    'auto_msg_delay': auto_msg_delay
                }, headers={'Authorization': f"Bearer {os.environ.get('OWNER_KEY', 'RomeoXLover')}"}, timeout=3)
                flash('DonutSMP AdBot launched automatically via API server.', 'success')
            except Exception as e:
                flash('DonutSMP AdBot configurations saved and queued. Ensure the JS Node server is running on port 3000.', 'info')
        else:
            flash('SSID and Message are required.', 'error')
        return redirect(url_for('donut_adbot'))
    
    # Filter logs specific to donut adbots
    logs = [log for log in console_logs if log.get('source') == 'donut_adbot']
    return render_template('dashboard.html', tab='donut_adbot', logs=logs)

@app.route('/api/log', methods=['POST'])
@csrf.exempt
@limiter.exempt
def receive_node_log():
    try:
        data = request.get_json()
        user = data.get('user', 'system')
        action = data.get('action', '')
        level = data.get('level', 'info')
        source = data.get('source', 'node_bot')
        
        if action:
            add_log(user, action, level, source)
            
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/adbots-list')
@login_required
def adbot_team():
    # Filter logs specific to donut adbots
    logs = [log for log in console_logs if log.get('source') == 'donut_adbot']
    return render_template('dashboard.html', tab='adbots_list', logs=logs)
    # Only show logs relevant to the user if they are not admin
    if current_user.role == 'admin':
        return jsonify(console_logs)
    
    # Filter by 'user' matching current Flask username or 'system'
    user_logs = [log for log in console_logs if log.get('user') == current_user.username or log.get('user') == 'system' or (log.get('source') == 'node_server' and current_user.role == 'admin')]
    
    # Also include node_server logs if the user started a bot?
    # For now, let's keep node_server logs admin-only or carefully filtered.
    # Actually, let's just show them if they aren't too noisy.
    return jsonify(user_logs)

@app.route('/api/bots', defaults={'path': ''}, methods=['GET', 'POST', 'DELETE'])
@app.route('/api/bots/<path:path>', methods=['GET', 'POST', 'DELETE'])
@csrf.exempt
@login_required
def proxy_node_bots(path):
    # Proxy requests to the Node.js API server on port 3000
    node_url = f"http://localhost:3000/api/bots/{path}"
    try:
        node_auth_key = os.environ.get('OWNER_KEY', 'RomeoXLover')
        headers = {'Authorization': f'Bearer {node_auth_key}'}
        
        if request.method == 'GET':
            headers['Accept'] = 'application/json'
            resp = http_requests.get(node_url, headers=headers, timeout=2)
        elif request.method == 'POST':
            headers['Content-Type'] = 'application/json'
            resp = http_requests.post(node_url, json=request.get_json(), headers=headers, timeout=2)
        elif request.method == 'DELETE':
            resp = http_requests.delete(node_url, headers=headers, timeout=2)
        
        if resp.status_code == 200:
            if request.method == 'DELETE' and path:
                # Sync bot status to database if deleted via Node API
                try:
                    # path might be 'stop/id' or just 'id'
                    bot_id = None
                    if '/' in path:
                         parts = path.split('/')
                         if parts[0] == 'stop' and len(parts) > 1:
                             bot_id = parts[1]
                    else:
                        bot_id = path
                    
                    if bot_id:
                        # Find the bot by ad_id or ID
                        bot_rec = Bot.query.filter((Bot.id == bot_id) | (Bot.ad_id == bot_id)).first()
                        if bot_rec:
                            bot_rec.is_active = False
                            db.session.commit()
                            add_log(current_user.username, f"Bot {bot_rec.name} marked as inactive (Terminated)", "info", "system")
                except Exception as e:
                    logging.error(f"Failed to sync bot status: {e}")

        return jsonify(resp.json()), resp.status_code
    except Exception:
        # User requested "fix spams". Silence WinError 10061 and return empty bot list on GET.
        # This prevents the terminal from being flooded with connection errors.
        if request.method == 'GET' and not path:
             return jsonify([]), 200
        return jsonify({'error': 'Node API unreachable', 'silent': True}), 503

@app.route('/api/bot-logs/<ad_id>')
@login_required
def get_bot_file_logs(ad_id):
    # User requested to "just use file as logs thingy"
    # Ad IDs are usually 'api_module_timestamp' or similar
    # Sanitize ad_id to prevent path traversal
    safe_id = "".join([c for c in ad_id if c.isalnum() or c in ('_', '-')])
    log_path = os.path.join('logs', f'ad_{safe_id}.txt')
    
    if os.path.exists(log_path):
        try:
            with open(log_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # Return last 100 lines for efficiency
                lines = content.split('\n')[-100:]
                return jsonify({'success': True, 'logs': '\n'.join(lines)})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)})
    
    return jsonify({'success': False, 'error': 'Log file not found'})

@app.route('/customize', methods=['GET', 'POST'])
@login_required
def customize():
    if request.method == 'POST':
        primary_color = request.form.get('primary_color', '#7c3aed')
        bg_color = request.form.get('bg_color', '#0a0a0f')
        font_family = request.form.get('font_family', 'Inter')
        
        import json
        theme_data = json.dumps({
            'primary': primary_color,
            'bg': bg_color,
            'font': font_family
        })
        
        resp = redirect(url_for('customize'))
        resp.set_cookie('custom_theme', theme_data, max_age=31536000)
        flash('Dashboard theme customized successfully!', 'success')
        return resp

    return render_template('dashboard.html', tab='customize')

@app.route('/help')
def help():
    return render_template('dashboard.html', tab='help')

@app.route('/api/scheduler/pending')
@csrf.exempt
@limiter.exempt
def scheduler_pending_api():
    """Get all pending scheduled messages"""
    auth = request.headers.get('Authorization', '').replace('Bearer ', '')
    if auth != os.environ.get('OWNER_KEY', 'RomeoXLover'):
        return jsonify({'error': 'Unauthorized'}), 401
    
    with app.app_context():
        now = datetime.now(UTC).replace(tzinfo=None)
        pending = ScheduledMessage.query.filter(
            ScheduledMessage.scheduled_time <= now,
            ScheduledMessage.is_sent == False
        ).all()
        
        return jsonify({
            'messages': [{
                'id': msg.id,
                'channel_id': msg.channel_id,
                'message': msg.message,
                'scheduled_time': msg.scheduled_time.isoformat(),
                'is_recurring': msg.is_recurring,
                'interval_minutes': msg.interval_minutes
            } for msg in pending]
        })

@app.route('/api/scheduler/mark_sent/<int:msg_id>', methods=['POST'])
@csrf.exempt
@limiter.exempt
def scheduler_mark_sent(msg_id):
    """Mark a scheduled message as sent"""
    auth = request.headers.get('Authorization', '').replace('Bearer ', '')
    if auth != os.environ.get('OWNER_KEY', 'RomeoXLover'):
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json() or {}
    success = data.get('success', False)
    
    with app.app_context():
        msg = db.session.get(ScheduledMessage, msg_id)
        if msg:
            if msg.is_recurring:
                now = datetime.now(UTC).replace(tzinfo=None)
                msg.scheduled_time = now + timedelta(minutes=max(msg.interval_minutes, 1))
            else:
                msg.is_sent = True
            db.session.commit()
            return jsonify({'success': True})
        return jsonify({'error': 'Message not found'}), 404

@app.route('/api/scheduler/add', methods=['POST'])
@csrf.exempt
def scheduler_add_api():
    """Add a new scheduled message via API"""
    auth = request.headers.get('Authorization', '').replace('Bearer ', '')
    if auth != os.environ.get('OWNER_KEY', 'RomeoXLover'):
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    channel_id = clean_channel_id(data.get('channel_id', ''))
    message = data.get('message', '')
    delay_seconds = data.get('delay_seconds', 60)
    recurring = data.get('recurring', False)
    interval_minutes = data.get('interval_minutes', 60)
    
    if not channel_id or not message:
        return jsonify({'error': 'channel_id and message are required'}), 400
    
    # Validate Discord channel
    if DISCORD_BOT_TOKEN:
        headers = {'Authorization': f'Bot {DISCORD_BOT_TOKEN}'}
        try:
            resp = requests.get(f'https://discord.com/api/v10/channels/{channel_id}', headers=headers, timeout=10)
            if resp.status_code != 200:
                return jsonify({'error': f'Channel not accessible: {resp.status_code}'}), 400
        except Exception as e:
            return jsonify({'error': f'Failed to validate channel: {e}'}), 400
    
    with app.app_context():
        sm = ScheduledMessage(
            user_id=1,  # System user
            bot_id=None,  # No bot, use direct Discord API
            channel_id=channel_id,
            message=message,
            scheduled_time=datetime.utcnow() + timedelta(seconds=delay_seconds),
            is_recurring=recurring,
            interval_minutes=interval_minutes if recurring else 0
        )
        db.session.add(sm)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'id': sm.id,
            'scheduled_time': sm.scheduled_time.isoformat()
        })

@app.route('/api/scheduler/send-now', methods=['POST'])
@csrf.exempt
def scheduler_send_now():
    """Send a message immediately via Discord bot"""
    auth = request.headers.get('Authorization', '').replace('Bearer ', '')
    if auth != os.environ.get('OWNER_KEY', 'RomeoXLover'):
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    channel_id = clean_channel_id(data.get('channel_id', ''))
    message = data.get('message', '')
    
    if not channel_id or not message:
        return jsonify({'error': 'channel_id and message are required'}), 400
    
    # Try to send via Discord bot if available
    for bot_key, bot_data in active_bot_clients.items():
        try:
            client = bot_data['client']
            loop = bot_data['loop']
            
            async def send_now():
                try:
                    channel = client.get_channel(int(channel_id))
                    if not channel:
                        channel = await client.fetch_channel(int(channel_id))
                    if channel:
                        await channel.send(message)
                        return True
                except Exception as e:
                    logging.error(f"Failed to send: {e}")
                return False
            
            future = asyncio.run_coroutine_threadsafe(send_now(), loop)
            if future.result(timeout=15):
                return jsonify({'success': True, 'method': 'discord_bot'})
        except Exception as e:
            logging.error(f"Bot send error: {e}")
    
    # Try direct Discord API
    if DISCORD_BOT_TOKEN:
        headers = {
            'Authorization': f'Bot {DISCORD_BOT_TOKEN}',
            'Content-Type': 'application/json'
        }
        try:
            resp = requests.post(
                f'https://discord.com/api/v10/channels/{channel_id}/messages',
                json={'content': message},
                headers=headers,
                timeout=15
            )
            if resp.status_code == 200:
                return jsonify({'success': True, 'method': 'discord_api'})
            else:
                return jsonify({'error': f'Discord API error: {resp.status_code}'}), 400
        except Exception as e:
            return jsonify({'error': f'Discord API error: {e}'}), 500
    
    return jsonify({'error': 'No Discord bot available'}), 503

@app.route('/api/scheduler/channels/<channel_id>')
@csrf.exempt
def scheduler_channel_info(channel_id):
    """Get information about a Discord channel"""
    auth = request.headers.get('Authorization', '').replace('Bearer ', '')
    if auth != os.environ.get('OWNER_KEY', 'RomeoXLover'):
        return jsonify({'error': 'Unauthorized'}), 401
    
    clean_id = clean_channel_id(channel_id)
    
    if not DISCORD_BOT_TOKEN:
        return jsonify({'error': 'Discord bot token not configured'}), 500
    
    headers = {'Authorization': f'Bot {DISCORD_BOT_TOKEN}'}
    
    try:
        resp = requests.get(
            f'https://discord.com/api/v10/channels/{clean_id}',
            headers=headers,
            timeout=10
        )
        
        if resp.status_code == 200:
            data = resp.json()
            channel_type = {
                0: 'Text Channel',
                1: 'DM',
                2: 'Voice Channel',
                3: 'Group DM',
                4: 'Category',
                5: 'Announcement',
                10: 'Thread',
                11: 'Thread',
                12: 'Private Thread',
                13: 'Stage Voice',
                14: 'Forum',
                15: 'Media Channel'
            }.get(data.get('type', 0), 'Unknown')
            
            return jsonify({
                'success': True,
                'channel': {
                    'id': data.get('id'),
                    'name': data.get('name', 'Unknown'),
                    'type': channel_type,
                    'type_id': data.get('type'),
                    'guild_id': data.get('guild_id')
                }
            })
        else:
            return jsonify({'error': f'Channel error: {resp.status_code}'}), resp.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/webhook/status', methods=['POST'])
@csrf.exempt
def webhook_delivery_status():
    """
    Send a rich delivery status embed to a Discord webhook.
    Used by scheduler and selfbot to report message delivery status.
    """
    auth = request.headers.get('Authorization', '').replace('Bearer ', '')
    if auth != os.environ.get('OWNER_KEY', 'RomeoXLover'):
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    webhook_url = data.get('webhook_url', '')
    if not webhook_url:
        return jsonify({'error': 'webhook_url is required'}), 400

    title = data.get('title', 'Notification')
    description = data.get('description', '')
    color = data.get('color', 0x5865F2)  # default purple
    fields = data.get('fields', [])
    footer = data.get('footer', '')
    timestamp = data.get('timestamp', datetime.utcnow().isoformat() + 'Z')

    try:
        payload = {'embeds': [{k: v for k, v in {
            'title': title,
            'description': description,
            'color': color,
            'fields': fields,
            'timestamp': timestamp,
            'footer': {'text': footer} if footer else None,
        }.items() if v is not None}]}

        resp = requests.post(webhook_url, json=payload, timeout=10)
        if resp.ok or resp.status_code == 204:
            return jsonify({'success': True})
        else:
            return jsonify({'error': f'Discord returned {resp.status_code}'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def scheduler_worker():
    """Background thread to process scheduled messages."""
    print("Starting Scheduler Worker Thread...")
    scheduler_status['running'] = True
    # Global rate tracking: scheduler_id -> [(timestamp, msg_id), ...]
    _global_rl = {}

    def _check_rate_limit(msg_id, rate_limit, window_sec=60):
        """Returns True if message is allowed under rate limit."""
        if rate_limit <= 0:
            return True
        now = time.time()
        if msg_id not in _global_rl:
            _global_rl[msg_id] = []
        # Remove old entries outside the window
        _global_rl[msg_id] = [(ts, mid) for ts, mid in _global_rl[msg_id] if now - ts < window_sec]
        count = len(_global_rl[msg_id])
        if count >= rate_limit:
            return False
        _global_rl[msg_id].append((now, msg_id))
        return True

    def _send_webhook_embed(webhook_url, title, description, color, fields=None, footer=None):
        """Send a rich embed notification to a webhook URL."""
        if not webhook_url:
            return
        try:
            import requests as _req
            embed = {
                'title': title,
                'description': description,
                'color': color,  # decimal color (e.g. 0x2ECC71 = 3066993)
                'timestamp': datetime.utcnow().isoformat(),
            }
            if fields:
                embed['fields'] = fields
            if footer:
                embed['footer'] = {'text': footer}
            _req.post(webhook_url, json={'embeds': [embed]}, timeout=10)
        except Exception:
            pass

    def _resolve_msg_content(msg_text, groq_key, ai_prompt):
        """Resolve message content: use AI if prompt is set, otherwise raw text."""
        if ai_prompt and groq_key:
            try:
                history = [{"role": "system", "content": ai_prompt}]
                resp = http_requests.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    headers={
                        'Authorization': f'Bearer {groq_key}',
                        'Content-Type': 'application/json'
                    },
                    json={
                        'model': 'llama-3.3-70b-versatile',
                        'messages': history + [{"role": "user", "content": msg_text}],
                        'max_tokens': 256,
                        'temperature': 0.9
                    },
                    timeout=30
                )
                if resp.ok:
                    data = resp.json()
                    return data.get('choices', [{}])[0].get('message', {}).get('content', msg_text)
            except Exception:
                pass
        return msg_text

    while True:
        try:
            with app.app_context():
                now = datetime.now(UTC).replace(tzinfo=None)
                pending = ScheduledMessage.query.filter(
                    ScheduledMessage.scheduled_time <= now,
                    ScheduledMessage.is_sent == False
                ).all()
                
                scheduler_status['pending_messages'] = len(pending)
                scheduler_status['last_check'] = datetime.now(UTC)

                for msg in pending:
                    bot_key = str(msg.bot_id)
                    bot = db.session.get(Bot, msg.bot_id)
                    if not bot:
                        continue

                    # Rate limit check
                    if msg.rate_limit > 0:
                        if not _check_rate_limit(msg.id, msg.rate_limit):
                            continue  # Skip this cycle; will retry next loop iteration

                    # ── Resolve AI message (if prompt is enabled) ───────────────────────────
                    ai_content = None
                    if msg.use_prompt and (msg.groq_api_key or msg.ai_prompt):
                        groq_key = msg.groq_api_key
                        if not groq_key:
                            user_setting = UserSettings.query.filter_by(user_id=msg.user_id).first()
                            groq_key = (user_setting.groq_api_key or '') if user_setting else ''
                        if not groq_key:
                            groq_key = os.environ.get('GROQ_API_KEY', '')
                        if groq_key:
                            ai_content = _resolve_msg_content(msg.message, groq_key, msg.ai_prompt)
                            logging.info(f"[Scheduler] Bot {bot_key} AI resolve — prompt='{msg.ai_prompt[:50]}', key={'found' if groq_key else 'MISSING'}, ai_content={'set' if ai_content else 'EMPTY'}")
                        else:
                            logging.warning(f"[Scheduler] Bot {bot_key}: use_prompt=True but no groq key found (msg.groq_key={msg.groq_api_key!r})")
                    else:
                        logging.info(f"[Scheduler] Bot {bot_key}: AI skipped — use_prompt={msg.use_prompt}, groq_key={'set' if msg.groq_api_key else 'empty'}, ai_prompt={'set' if msg.ai_prompt else 'empty'}")

                    # ── Send via Discord bot ─────────────────────────────────────────────
                    sent_raw = False
                    sent_ai = False
                    last_error = ''

                    with bot_threads_lock:
                        bot_data = active_bot_clients.get(bot_key)

                    if bot_data:
                        client = bot_data['client']
                        loop = bot_data['loop']

                        # Validate loop is still running before scheduling
                        try:
                            loop_is_closed = loop.is_closed()
                            loop_running = loop.is_running()
                        except Exception:
                            loop_is_closed = True
                            loop_running = False

                        if loop_is_closed or not loop_running:
                            logging.warning(f"Scheduler: event loop for Bot {bot_key} is not available (closed={loop_is_closed}, running={loop_running}). Bot may be disconnected.")
                            last_error = f'Bot disconnected (loop closed={loop_is_closed})'
                            sent_raw = False
                        else:
                            async def send_pair(channel_id, raw_msg, ai_msg):
                                results = []
                                logging.info(f"[Scheduler] send_pair called — raw={raw_msg[:60]!r}, ai_msg={ai_msg[:60] if ai_msg else None!r}")
                                try:
                                    clean_id = clean_channel_id(str(channel_id))
                                    channel = client.get_channel(int(clean_id))
                                    if not channel:
                                        channel = await client.fetch_channel(int(clean_id))
                                    if channel:
                                        # 1. Send raw message first
                                        await channel.send(raw_msg)
                                        logging.info(f"[Scheduler] Raw sent to channel {clean_id}")
                                        results.append(('raw', True))
                                        # 2. Send AI message second (with small gap)
                                        if ai_msg:
                                            import asyncio as _asyncio
                                            await _asyncio.sleep(0.5)
                                            await channel.send(ai_msg)
                                            logging.info(f"[Scheduler] AI sent: {ai_msg[:60]}")
                                            results.append(('ai', True))
                                        else:
                                            logging.info("[Scheduler] AI msg is None/empty, skipping")
                                    else:
                                        logging.warning(f"[Scheduler] Could not resolve channel {clean_id}")
                                        results.append(('raw', False))
                                        if ai_msg:
                                            results.append(('ai', False))
                                except Exception as ex:
                                    import traceback
                                    logging.error(f"Scheduler send_pair error (Bot {bot_key}): {ex}\n{ex.__traceback__}")
                                    results.append(('raw', False))
                                    if ai_msg:
                                        results.append(('ai', False))
                                return results

                            try:
                                future = asyncio.run_coroutine_threadsafe(
                                    send_pair(msg.channel_id, msg.message, ai_content), loop
                                )
                                results = future.result(timeout=20)
                                sent_raw = next((r[1] for r in results if r[0] == 'raw'), False)
                                sent_ai = next((r[1] for r in results if r[0] == 'ai'), False)
                                result_detail = f"Discord Bot {bot.name}"
                            except asyncio.TimeoutError:
                                logging.error(f"Scheduler: timed out sending message via Bot {bot_key} (20s limit)")
                                last_error = 'Timeout (20s)'
                                sent_raw = False
                            except Exception as e:
                                import traceback as _tb
                                logging.error(f"Scheduler future error: {e}\n{_tb.format_exc()}")
                                last_error = str(e) or repr(e)
                                sent_raw = False
                    else:
                        # Fallback: Minecraft Bot API — only raw message supported
                        try:
                            import requests
                            auth_token = os.environ.get('OWNER_KEY', 'RomeoXLover')
                            resp = requests.post(
                                f'http://localhost:3000/api/bots/chat/{msg.bot_id}',
                                json={'message': msg.message},
                                headers={'Authorization': f"Bearer {auth_token}"},
                                timeout=5
                            )
                            sent_raw = resp.ok
                            result_detail = "Minecraft Bot API"
                        except Exception as e:
                            logging.error(f"Scheduler API error: {e}")
                            last_error = str(e)
                            sent_raw = False

                    success = sent_raw  # overall success = raw message sent

                    # ── Webhook notification ────────────────────────────────────────────
                    sw_url = msg.scheduler_webhook_url or ''
                    if sw_url:
                        status_color = 3066993 if success else 15158332
                        status_icon = "✅" if success else "❌"
                        embed_fields = [
                            {'name': 'Channel', 'value': str(msg.channel_id), 'inline': True},
                            {'name': 'Bot', 'value': bot.name if bot else 'Unknown', 'inline': True},
                            {'name': 'Raw Message', 'value': msg.message[:500], 'inline': False},
                        ]
                        if ai_content:
                            embed_fields.append({'name': 'AI Message', 'value': ai_content[:500], 'inline': False})
                        if not success:
                            embed_fields.append({'name': 'Error', 'value': last_error or 'Unknown error', 'inline': False})
                        _send_webhook_embed(
                            sw_url,
                            f"{status_icon} Scheduled Message {'Sent' if success else 'Failed'}",
                            f"**ID:** `{msg.id}`\n**Bot:** {bot.name if bot else 'Unknown'}\n**Channel:** `{msg.channel_id}`\n**Raw:** {msg.message[:300]}",
                            status_color,
                            fields=embed_fields,
                            footer=f"Scheduler • {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC"
                        )

                    # ── Mark done or reschedule ─────────────────────────────────────────
                    if success:
                        if msg.is_recurring:
                            msg.scheduled_time = now + timedelta(minutes=msg.interval_minutes)
                            log_msg = f"Bot {bot.name}: Recurring sent (raw={'✅' if sent_raw else '❌'} | AI={'✅' if sent_ai else '❌'}). Next: {msg.scheduled_time.strftime('%H:%M')}"
                        else:
                            msg.is_sent = True
                            log_msg = f"Bot {bot.name}: Scheduled message sent (raw={'✅' if sent_raw else '❌'} | AI={'✅' if sent_ai else '❌'})"

                        user = db.session.get(User, bot.user_id) if bot else None
                        username = user.username if user else "system"
                        add_log(username, log_msg, "success", "selfbot")
                        db.session.commit()
        except Exception as e:
            logging.error(f"Scheduler Worker Error: {e}")
        time.sleep(10)

if __name__ == '__main__':
    # Start the Scheduler background thread
    threading.Thread(target=scheduler_worker, daemon=True).start()

    # Use port 8080 for HTTPS, allowing e.romeobeamed.lol to resolve correctly
    cert_path = '/etc/letsencrypt/live/e.romeobeamed.lol/fullchain.pem'
    key_path = '/etc/letsencrypt/live/e.romeobeamed.lol/privkey.pem'
    
    port = 8080
    try:
        # Kill any process on the port, including potential stale PM2 processes
        # Use a more aggressive multi-stage kill
        subprocess.run(f"fuser -k {port}/tcp", shell=True, check=False)
        subprocess.run(f"lsof -t -i:{port} | xargs -r kill -9", shell=True, check=False)
        subprocess.run(f"netstat -lnp | grep :{port} | awk '{{print $7}}' | cut -d'/' -f1 | xargs -r kill -9", shell=True, check=False)
        time.sleep(2)
    except:
        pass

    app.logger.info(f"Starting HTTP server on port {port}")
    app.run(host='127.0.0.1', port=port)
