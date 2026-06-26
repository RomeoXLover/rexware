use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use azalea::app::{App, Plugin, Update};
use azalea::cookies::{ServerCookies, StoreCookieEvent};
use azalea::ecs::lifecycle::Add;
use azalea::ecs::observer::On;
use azalea::ecs::prelude::{Commands, MessageReader};
use azalea::packet::config::ReceiveConfigPacketEvent;
use azalea::packet::game::ReceiveGamePacketEvent;
use azalea::prelude::*;
use azalea::protocol::packets::config::ClientboundConfigPacket;
use azalea::protocol::packets::game::ClientboundGamePacket;
use azalea::{ClientInformation, Identifier, SprintDirection, WalkDirection};
use parking_lot::Mutex;
use rand::Rng;
use regex::Regex;

use crate::config::{AccountCfg, Config};
use crate::log::{CYAN, GREEN, MAGENTA, RED, YELLOW};
use crate::packet::{self, PacketCfg};
use crate::persona::Persona;
use crate::{logln, webhook};

// Zero-width space — invisible to most text filters, makes each message unique
const ZWSP: &str = "\u{200B}";
// Word joiner — prevents word wrapping from merging characters
const WJ: &str = "\u{2060}";

/// Applies random stealth mutations to a message string to help it bypass
/// mute/anti-spam filters that use hash-based or exact-match detection.
///
/// Not guaranteed to work on all servers — filter evasion is server-dependent.
fn mutate_bypass_text(msg: &str, rng: &mut impl Rng) -> String {
    let r = rng.gen_range(0.0..1.0);

    // ── 1. TRAILING EMOTICONS ───────────────────────────────────────────────
    // Adding a trailing emoticon changes the string hash so exact-match filters
    // see it as a different message. Emoticons also add human-readable context.
    let emoticons = [":))", ":))", ":? ", ":$ ", ";)", "xD", "^_^", ":o", ":|", "~~", ":')", "<3", "lol", "sike", ":DD", ":p"];
    let suffix = if r < 0.45 {
        let e = emoticons[rng.gen_range(0..emoticons.len())];
        format!(" {}", e)
    } else {
        String::new()
    };

    // ── 2. WORD JOINERS (zero-width invisible characters) ───────────────────
    // Injecting \u{200B} (ZWSP) and \u{2060} (WJ) between words forces the
    // final string to differ from any static hash the server might track, while
    // remaining visually identical to human readers.
    let word_joiners = if r > 0.25 { WJ } else { "" };

    // Split on spaces and rejoin with invisible joiners
    let words: Vec<&str> = msg.split_whitespace().collect();
    let joined = if words.len() > 1 && r > 0.2 {
        words.join(word_joiners)
    } else {
        msg.to_string()
    };

    // ── 3. PREFIX ZERO-WIDTH CHARACTER ──────────────────────────────────────
    // Leading invisible char adds an extra variation without changing appearance.
    let prefixed = if r > 0.6 { format!("{}{}", ZWSP, joined.trim_start()) } else { joined };

    // ── 4. WORD CASE VARIATION (first word) ─────────────────────────────────
    // Some filters do case-insensitive matching. Flipping the first character
    // case keeps the word readable but changes its byte representation.
    let cased: String = if r > 0.7 && !prefixed.is_empty() {
        let mut chars = prefixed.chars();
        match chars.next() {
            Some(c) if c.is_ascii_alphabetic() => {
                let flipped = if c.is_uppercase() { c.to_ascii_lowercase() } else { c.to_ascii_uppercase() };
                format!("{}{}", flipped, chars.as_str())
            }
            _ => prefixed,
        }
    } else {
        prefixed
    };

    format!("{}{}", cased.trim_end(), suffix)
}

const TPS: f64 = 20.0;

// Minimum spacing (~1.6s) between two chat sends. The outbox is drained one
// message per tick respecting this gap so a burst of triggers is paced out
// instead of tripping the server's "sending messages too fast/similar" filter.
const SEND_GAP_TICKS: u64 = 32;

pub struct Inner {
    pub yaw: f32,
    pub pitch: f32,
    pub look_target: Option<(f32, f32)>,
    pub look_step: u32,
    pub look_total: u32,
    pub last_msg_tick: u64,
    pub next_msg_ticks: u64,
    pub last_afk_tick: u64,
    pub next_afk_ticks: u64,
    pub walk_until: u64,
    pub joined: bool,
    pub join_tick: u64,
    // Outgoing chat queue: (sender_opt, messages, earliest_tick_to_send).
    // For private AI replies the messages VecDeque holds msg1, msg2, msg3 … sent
    // in strict FIFO order so nothing is dropped. sender_opt = Some(username).
    // For public broadcasts sender_opt = None and the queue has exactly one entry.
    pub outbox: VecDeque<(Option<String>, VecDeque<String>, u64)>,
    pub last_sent_tick: u64,
    // Window of recently sent message bodies (most recent last). Used to dodge
    // the server's "too similar" filter, which compares against several past
    // messages — not just the immediately previous one.
    pub recent_sent: VecDeque<String>,
    pub last_trigger: Option<Instant>,
    pub recent: HashMap<String, Instant>,
    /// Pending trigger sequences: (sender, next_tick, cfg_idx, remaining_messages).
    /// next_tick = the tick when the next message should be sent.
    /// cfg_idx = index into trigger_configs (or usize::MAX for legacy).
    pub pending_replies: Vec<(String, u64, usize, VecDeque<String>)>,
    /// Tick when the outbox was last polled (for AI chat message pickup).
    pub last_outbox_poll_tick: u64,
}

impl Default for Inner {
    fn default() -> Self {
        Inner {
            yaw: 0.0,
            pitch: 0.0,
            look_target: None,
            look_step: 0,
            look_total: 0,
            last_msg_tick: 0,
            next_msg_ticks: 0,
            last_afk_tick: 0,
            next_afk_ticks: 0,
            walk_until: 0,
            joined: false,
            join_tick: 0,
            outbox: VecDeque::new(),
            last_sent_tick: 0,
            recent_sent: VecDeque::new(),
            last_trigger: None,
            recent: HashMap::new(),
            pending_replies: Vec::new(),
            last_outbox_poll_tick: 0,
        }
    }
}

pub struct RunCtx {
    pub cfg: Arc<Config>,
    pub account: AccountCfg,
    pub persona: Persona,
    pub rotate: AtomicBool,
    // Set when the server kicks us with a "Transferring region" reason. The
    // main loop reads this to reconnect immediately (same account, no backoff)
    // so the proxy can place us on the new instance.
    pub transferring: AtomicBool,
    // New destination requested by a real ClientboundTransfer game packet
    // (host:port). Servers like mcpvp move you between backends with this
    // packet — NOT a kick. azalea 0.15's built-in handler for it is a no-op,
    // so we capture it ourselves (see transfer_plugin) and the main loop
    // reconnects to THIS address instead of the original one.
    pub transfer_target: Mutex<Option<(String, u16)>>,
    // True when the transfer packet points back at the same address we already
    // connected to (Velocity proxy loop). Used to suppress verbose logging and
    // apply a longer wait so cookies have time to propagate.
    pub is_proxy_loop: AtomicBool,
    // Set to true once we successfully log in this run. The main loop reads it
    // to reset the transfer-kick rotation counter (a clean join means whatever
    // IP throttle we hit cleared, so the next transfer-kick streak starts fresh).
    pub connected: AtomicBool,
    pub inner: Mutex<Inner>,
}

static CURRENT: Mutex<Option<Arc<RunCtx>>> = Mutex::new(None);

/// Process-wide cookie jar that survives a full client teardown.
///
/// Modern proxy networks (Velocity "transfer packets", which mcpvp uses) move a
/// player between backends by: (1) sending a `store_cookie` carrying a routing
/// token, then (2) sending a `Transfer` packet — often pointing back at the
/// proxy's own entry address (`mcpvp.club:25565`). On the reconnect the proxy
/// asks for that cookie (`cookie_request`) to decide which backend to route us
/// to. azalea keeps cookies in a `ServerCookies` component, but it lives on the
/// ECS entity and is destroyed when we tear the whole client down between
/// reconnect attempts. With the cookie gone, the proxy can't route us and just
/// transfers us again — that's the endless transfer loop. We therefore mirror
/// every stored cookie here (lives for the whole process) and replay it onto
/// the next connection so the handshake answers the proxy correctly.
static COOKIE_JAR: Mutex<Option<HashMap<Identifier, Vec<u8>>>> = Mutex::new(None);

pub fn set_current(ctx: Arc<RunCtx>) {
    *CURRENT.lock() = Some(ctx);
}

/// Forget all stored cookies. Called when we deliberately go back to the lobby
/// (account rotation or a normal kick), where stale routing cookies are no
/// longer valid and could send us to a dead backend. Cookies are intentionally
/// KEPT across a transfer reconnect — that's the whole point.
pub fn clear_cookies() {
    *COOKIE_JAR.lock() = None;
}

fn current() -> Arc<RunCtx> {
    CURRENT.lock().clone().expect("RunCtx not initialized")
}

#[derive(Clone, Component)]
pub struct State {
    pub ctx: Arc<RunCtx>,
}

impl Default for State {
    fn default() -> Self {
        State { ctx: current() }
    }
}

/// Captures the real `ClientboundTransfer` game packet.
///
/// Modern servers (1.20.5+) move a player between backend instances by sending
/// a Transfer packet carrying the NEW host:port — they do NOT kick you. azalea
/// 0.15's built-in handler for this packet is a no-op (`fn transfer(..) {}`),
/// so without this plugin the bot never learns where to go and just sits on the
/// dead connection until it times out, then reconnects to the ORIGINAL address
/// (the bug). The old mineflayer script worked precisely because it listened
/// for this packet (`bot._client.on('transfer', ...)`) and reconnected to
/// `packet.host:packet.port`.
///
/// We record the destination on the shared `RunCtx`; the disconnect that
/// follows (the server closes the old connection) returns control to the main
/// loop, which then reconnects to the recorded address.
pub struct TransferPlugin;

impl Plugin for TransferPlugin {
    fn build(&self, app: &mut App) {
        // The Transfer packet can arrive in EITHER protocol state:
        //  - Game state  -> ClientboundGamePacket::Transfer
        //  - Config state -> ClientboundConfigPacket::Transfer  (very common on
        //    Velocity/proxy networks that move you "between regions" right after
        //    login, before you fully enter the game world)
        // The old mineflayer script caught both transparently via
        // `bot._client.on('transfer')`. We were only listening on the Game state,
        // so config-state transfers slipped through and we only saw the fallback
        // "Transferring region" kick. Register a system for each state.
        app.add_systems(Update, capture_transfer_game);
        app.add_systems(Update, capture_transfer_config);
        // Cookie persistence: capture every stored cookie into the process-wide
        // jar, and replay the jar onto each fresh connection so the proxy can
        // route us back to the correct backend instead of looping the transfer.
        app.add_observer(capture_store_cookie);
        app.add_observer(ensure_cookies_on_connect);
    }
}

/// Mirror every cookie the server stores into the persistent jar. We use our
/// own observer (in addition to azalea's built-in one) because azalea only
/// records the cookie when the `ServerCookies` component already exists — which
/// it doesn't during the login/config handshake — whereas this fires in any
/// protocol state.
fn capture_store_cookie(ev: On<StoreCookieEvent>) {
    let ctx = current();
    let mut g = COOKIE_JAR.lock();
    g.get_or_insert_with(HashMap::new)
        .insert(ev.key.clone(), ev.payload.clone());
    logln!(
        YELLOW,
        "[{}] [COOKIE] Stored routing cookie '{}' ({} bytes)",
        ctx.account.your_username,
        ev.key,
        ev.payload.len()
    );
}

/// Prefill `ServerCookies` from the persistent jar the instant the client
/// entity is created (when its `Account` component is added), BEFORE any network
/// packet is processed.
///
/// This timing is the whole point. azalea only inserts `ServerCookies` as part
/// of its in-game bundle (once you fully join a world), so during the
/// login/config handshake the component is ABSENT. mcpvp does its cookie +
/// transfer dance during config state — so on a reconnect azalea's
/// `handle_request_cookie` observer finds no `ServerCookies`, answers the
/// proxy's cookie request with an empty payload, and the proxy can't route us,
/// transferring us again forever. By inserting a jar-backed `ServerCookies`
/// here (a lifecycle observer that runs synchronously at entity spawn, before
/// the connection even opens) we guarantee the routing cookie is available the
/// moment the proxy asks for it — no race with packet handling.
fn ensure_cookies_on_connect(ev: On<Add, Account>, mut commands: Commands) {
    let jar = COOKIE_JAR.lock();
    let map = jar.clone().unwrap_or_default();
    let count = map.len();
    commands
        .entity(ev.entity)
        .insert(ServerCookies { map });
    if count > 0 {
        let ctx = current();
        logln!(
            YELLOW,
            "[{}] [COOKIE] Restored {} routing cookie(s) onto fresh connection",
            ctx.account.your_username,
            count
        );
    }
}

/// Shared: record the transfer destination and flag the run for reconnect.
fn record_transfer(host: String, port: u16) {
    let ctx = current();
    let cfg = &ctx.cfg;

    // Velocity proxies send the Transfer packet pointing back at the entry
    // address (mcpvp.club:25565) — the routing cookie is supposed to guide the
    // proxy to the right backend. Detect this loop and tag it so the main loop
    // waits longer and silences the verbose log.
    let is_loop = (host == cfg.host && port == cfg.port)
        || (host == cfg.host.replace("eu.", "").replace("us.", "").replace("asia.", ""))
          && port == cfg.port;
    ctx.is_proxy_loop.store(is_loop, Ordering::SeqCst);
    *ctx.transfer_target.lock() = Some((host.clone(), port));
    ctx.transferring.store(true, Ordering::SeqCst);

    if is_loop {
        logln!(
            YELLOW,
            "[{}] [TRANSFER] Proxy loop (same address) — waiting for routing cookie",
            ctx.account.your_username,
        );
    } else {
        logln!(
            YELLOW,
            "[{}] [TRANSFER] Server transfer packet -> {}:{} — reconnecting there",
            ctx.account.your_username,
            host,
            port
        );
        webhook::event(
            ctx.cfg.webhook_url.clone(),
            &ctx.account.your_username,
            webhook::Level::Warn,
            "Server transfer",
            &format!(
                "`{}` is being transferred to **{host}:{port}**.",
                ctx.account.your_username
            ),
        );
    }
}

fn capture_transfer_game(mut events: MessageReader<ReceiveGamePacketEvent>) {
    for ReceiveGamePacketEvent { packet, .. } in events.read() {
        if let ClientboundGamePacket::Transfer(t) = packet.as_ref() {
            record_transfer(t.host.clone(), t.port as u16);
        }
    }
}

fn capture_transfer_config(mut events: MessageReader<ReceiveConfigPacketEvent>) {
    for ReceiveConfigPacketEvent { packet, .. } in events.read() {
        if let ClientboundConfigPacket::Transfer(t) = packet.as_ref() {
            record_transfer(t.host.clone(), t.port as u16);
        }
    }
}

pub async fn handle(bot: Client, event: Event, state: State) -> anyhow::Result<()> {
    let ctx = state.ctx;
    match event {
        Event::Init => {
            // Fingerprint client identico a un client vanilla reale.
            // - main_hand deriva dalla persona (varia per account, non sempre Right)
            // - allows_listing=true: un client vanilla compare di default nella tab
            //   list; il default di azalea (false) farebbe apparire il bot come
            //   "Anonymous Player", un fingerprint sospetto per gli anticheat.
            // - i restanti campi (model_customization con tutti i layer skin attivi,
            //   chat_colors, particle_status) restano al default vanilla.
            let main_hand = if ctx.persona.right_handed {
                azalea::entity::HumanoidArm::Right
            } else {
                azalea::entity::HumanoidArm::Left
            };
            let _ = bot.set_client_information(ClientInformation {
                view_distance: ctx.persona.view_distance,
                language: ctx.persona.locale.clone(),
                main_hand,
                allows_listing: true,
                ..Default::default()
            });
        }
        Event::Login => {
            let st = &ctx.cfg.stealth;
            let mut rng = rand::thread_rng();
            let delay = if st.enabled {
                rng.gen_range(st.join_delay_min..=st.join_delay_max.max(st.join_delay_min + 0.5))
            } else {
                0.0
            };
            let mut g = ctx.inner.lock();
            g.join_tick = (delay * TPS) as u64;
            g.last_trigger = Some(Instant::now());
            g.yaw = rng.gen_range(-180.0..180.0);
            g.pitch = rng.gen_range(-10.0..10.0);
            drop(g);
            ctx.connected.store(true, Ordering::SeqCst);
            logln!(GREEN, "[{}] Connected", ctx.account.your_username);
        }
        Event::Spawn => {
            let user = &ctx.account.your_username;
            logln!(GREEN, "[{}] [JOIN] Spawned in the world", user);
            crate::report::report_status("running");
            webhook::event(
                ctx.cfg.webhook_url.clone(),
                user,
                webhook::Level::Online,
                "Bot is online",
                &format!("`{user}` joined **{}:{}**", ctx.cfg.host, ctx.cfg.port),
            );
        }
        Event::Chat(packet) => {
            on_chat(&bot, &ctx, &packet);
        }
        Event::Death(_) => {
            let user = &ctx.account.your_username;
            logln!(RED, "[{}] [DEATH] The bot died", user);
            webhook::event(
                ctx.cfg.webhook_url.clone(),
                user,
                webhook::Level::Info,
                "Bot died",
                &format!("`{user}` died and will respawn."),
            );
        }
        Event::Disconnect(reason) => {
            let user = &ctx.account.your_username;
            let why = reason
                .map(|r| strip_section(&r.to_string()))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "no reason given (connection lost)".to_string());
            // A "Transferring region" kick means the server's proxy intends to
            // move us to another backend instance. Flag it so the main loop
            // reconnects right away (same account, no exponential backoff): the
            // reconnect lets the proxy route us onto the new instance instead of
            // treating this as a normal kick.
            if why.to_lowercase().contains("transferring region") {
                ctx.transferring.store(true, Ordering::SeqCst);
                logln!(
                    YELLOW,
                    "[{}] [TRANSFER] Region transfer requested — will wait for the proxy to move us, then reconnect",
                    user
                );
                webhook::event(
                    ctx.cfg.webhook_url.clone(),
                    user,
                    webhook::Level::Warn,
                    "Transferring region",
                    &format!("`{user}` is being moved to another backend.\n```{why}```"),
                );
                return Ok(());
            }
            // Detect a ban from the kick reason so it stands out from a normal
            // disconnect (servers phrase it many ways: "banned", "tempban", …).
            let low = why.to_lowercase();
            let is_ban = low.contains("ban");
            if is_ban {
                logln!(RED, "[{}] [BAN] Banned by server: {}", user, why);
                webhook::event(
                    ctx.cfg.webhook_url.clone(),
                    user,
                    webhook::Level::Ban,
                    "Banned from server",
                    &format!("`{user}` was banned from **{}**.\n```{why}```", ctx.cfg.host),
                );
            } else {
                // When the server actively kicks us this carries the kick
                // message; otherwise it's a dropped/closed connection.
                logln!(RED, "[{}] [KICK] Disconnected by server: {}", user, why);
                webhook::event(
                    ctx.cfg.webhook_url.clone(),
                    user,
                    webhook::Level::Warn,
                    "Kicked / disconnected",
                    &format!("`{user}` lost connection.\n```{why}```"),
                );
            }
        }
        Event::Tick => {
            on_tick(&bot, &ctx);
        }
        _ => {}
    }
    Ok(())
}

fn on_chat(bot: &Client, ctx: &Arc<RunCtx>, packet: &azalea::chat::ChatPacket) {
    let text = strip_section(&packet.message().to_string());
    logln!(CYAN, "[{}] [CHAT] {}", ctx.account.your_username, text);

    let sender = match packet.split_sender_and_content() {
        (Some(u), _) => clean_name(&u),
        _ => extract_sender(&text),
    };
    let Some(sender) = sender else { return };

    if sender.is_empty() || sender.eq_ignore_ascii_case(&ctx.account.your_username) {
        return;
    }

    // If AI chat is enabled, delegate to the LLM (best-effort, background).
    // AI fires on every message — per-user overrides are applied in ai_chat.rs.
    // When AI is active the static reply flow is skipped entirely.
    if ctx.cfg.ai_enabled {
        crate::ai_chat::capture_message(&sender, &text);
        return;
    }

    // Find which trigger config (if any) matches this message.
    // Only consider trigger_configs if at least one has a non-empty keyword.
    let trigger_configs_exist = ctx.cfg.trigger_configs.iter().any(|tc| !tc.keyword.is_empty());
    let matched_config_idx = if trigger_configs_exist {
        ctx.cfg.trigger_configs
            .iter()
            .position(|tc| text.contains(&tc.keyword))
    } else {
        None
    };

    let has_legacy_trigger = !ctx.cfg.trigger_keyword.is_empty()
        && text.contains(&ctx.cfg.trigger_keyword);

    let has_bulk_reply = ctx
        .cfg
        .bulk_reply_keywords
        .iter()
        .any(|kw| !kw.is_empty() && text.contains(kw));

    // Bulk trigger word match: private-whisper the sender back.
    // These fire on public chat messages and whisper a reply to the sender.
    let has_bulk_trigger = ctx
        .cfg
        .bulk_trigger_words
        .iter()
        .any(|w| !w.is_empty() && text.contains(w));

    // If nothing matches, nothing to do.
    if matched_config_idx.is_none() && !has_legacy_trigger && !has_bulk_reply && !has_bulk_trigger {
        return;
    }

    // Build the whisper message(s) for the sender.
    // Priority: trigger_configs > legacy reply_actions > legacy single reply.
    let messages: VecDeque<String> = if let Some(idx) = matched_config_idx {
        // New multi-trigger: each line becomes /msg <user> <line>
        ctx.cfg.trigger_configs[idx]
            .messages
            .iter()
            .filter(|m| !m.trim().is_empty())
            .map(|m| format!("/msg {} {}", sender, m))
            .collect()
    } else {
        // Legacy / bulk reply path: build whisper lines from reply_actions or
        // fallback to a single /msg reply. If reply_actions is empty, send the
        // configured reply text as a single whisper.
        if ctx.cfg.reply_actions.is_empty() {
            VecDeque::from([format!("/msg {} {}", sender, ctx.cfg.reply)])
        } else {
            ctx.cfg
                .reply_actions
                .iter()
                .filter(|a| !a.trim().is_empty())
                .map(|a| {
                    a.replace("{user}", &sender)
                        .replace("{reply}", &ctx.cfg.reply)
                })
                .collect()
        }
    };

    if messages.is_empty() {
        return;
    }

    let now = Instant::now();
    let cooldown = ctx.cfg.reply_cooldown;
    let delay = ctx.cfg.reply_delay;
    let mut g = ctx.inner.lock();

    let cooldown_ok = g
        .recent
        .get(&sender)
        .map(|t| now.duration_since(*t).as_secs() >= cooldown)
        .unwrap_or(true);
    let queued = g.pending_replies.iter().any(|(u, _, _, _)| u == &sender);

    if cooldown_ok && !queued {
        g.last_trigger = Some(Instant::now());
        logln!(
            YELLOW,
            "[{}] [QUEUE] {} messages to {} in {}s",
            ctx.account.your_username,
            messages.len(),
            sender,
            delay
        );
        let tick = bot.component::<azalea::tick_counter::TicksConnected>().0;
        let next_tick = tick + delay * 20;
        g.pending_replies.push((sender, next_tick, 0, messages));
    }
}

fn on_tick(bot: &Client, ctx: &Arc<RunCtx>) {
    // Capture position for world-view dashboard (best-effort, silent failure).
    #[allow(deprecated)]
    let pos = bot.position();
    let x = pos.x as f64;
    let y = pos.y as f64;
    let z = pos.z as f64;
    // Use the bot's tracked look direction from Inner
    let (yaw, pitch) = {
        let g = ctx.inner.lock();
        (g.yaw, g.pitch)
    };
    let username = ctx.account.your_username.clone();
    crate::world_view::capture(&username, x, y, z, yaw, pitch, 20.0, false);

    let tick = bot.component::<azalea::tick_counter::TicksConnected>().0;
    let st = &ctx.cfg.stealth;
    let mut rng = rand::thread_rng();
    let now = Instant::now(); // used for inactivity check at end of function

    let mut g = ctx.inner.lock();

    // Poll outbox every ~5 seconds (100 ticks) for AI chat messages queued
    // via the runner callback (from the AI chat module).
    let poll_due = ctx.cfg.ai_enabled && tick >= {
        let g = ctx.inner.lock();
        g.last_outbox_poll_tick
    } + 100;
    if poll_due {
        {
            let mut g = ctx.inner.lock();
            g.last_outbox_poll_tick = tick;
        } // g dropped here, lock released
        poll_outbox();
    }

    if !g.joined {
        if tick < g.join_tick {
            return;
        }
        g.joined = true;
        g.last_msg_tick = tick;
        g.last_afk_tick = tick;
        g.next_msg_ticks = jittered(ctx.cfg.message_interval, st.message_jitter, &mut rng);
        g.next_afk_ticks = afk_ticks(ctx.cfg.afk_interval, st.human_afk, &mut rng);
    }

    // Drain pending AI chat messages into the outbox.
    // Each sender gets their own FIFO queue so msg1 → msg2 → msg3 are sent in order.
    for (sender, messages) in crate::world_view::drain_pending_chats() {
        let due_tick = tick.saturating_add(1);
        g.outbox.push_back((sender, messages, due_tick));
    }

    // Drain pending payment notifications — send private DMs to each player.
    for (mc_username, msg_text) in crate::world_view::drain_pending_payments() {
        let due_tick = tick.saturating_add(1);
        // /msg <username> <text> for private in-game messaging
        let full = format!("/msg {} {}", mc_username, msg_text);
        g.outbox.push_back((None, VecDeque::from([full]), due_tick));
    }

    // Drain at most one queued message per tick, respecting the anti-spam gap.
    // Send the FIRST ready message — we look across all senders and pick the
    // earliest due one so a busy private chat doesn't block public broadcasts.
    if tick >= g.last_sent_tick.saturating_add(SEND_GAP_TICKS) {
        if let Some(idx) = g.outbox.iter().position(|(_, _, due)| tick >= *due) {
            let (sender, mut messages, _) = g.outbox.remove(idx).unwrap();
            let text = messages.pop_front().unwrap();

            match sender {
                None => {
                    // Public broadcast message (single-message queue, always empty after pop).
                    let mut text = text;
                    if is_too_similar(&g.recent_sent, &text) {
                        for _ in 0..6 {
                            let candidate = vary_dup(&text, true);
                            if !is_too_similar(&g.recent_sent, &candidate) {
                                text = candidate;
                                break;
                            }
                            text = candidate;
                        }
                    }
                    g.last_sent_tick = tick;
                    g.recent_sent.push_back(text.clone());
                    while g.recent_sent.len() > 6 {
                        g.recent_sent.pop_front();
                    }
                    drop(g);
                    logln!(MAGENTA, "[{}] [SEND] {}", ctx.account.your_username, text);
                    bot.chat(&text);
                    g = ctx.inner.lock();
                }
                Some(who) => {
                    // Trigger reply: send exactly as configured — no humanise/vary.
                    // If this user has more queued messages, put the rest back first.
                    if !messages.is_empty() {
                        g.outbox.push_front((Some(who.clone()), messages, tick));
                    }
                    g.last_sent_tick = tick;
                    g.recent_sent.push_back(format!("/msg {} {}", who, text.clone()));
                    while g.recent_sent.len() > 6 {
                        g.recent_sent.pop_front();
                    }
                    drop(g);
                    logln!(MAGENTA, "[{}] [MSG→{}] {}", ctx.account.your_username, who, text);
                    bot.chat(&format!("/msg {} {}", who, text));
                    g = ctx.inner.lock();
                }
            }
        }
    }

    let pcfg = PacketCfg::from(st);
    step_look(bot, &mut g, &pcfg);

    if pcfg.enabled
        && pcfg.micro_noise > 0.0
        && g.look_target.is_none()
        && tick % 11 == 0
        // redundant_skip: ogni tanto NON inviamo la micro-rotazione, cosi' il
        // ritmo dei pacchetti non e' perfettamente regolare (come un umano).
        && !packet::redundant_skip(&pcfg, &mut rng)
    {
        let (cy, cp) = (g.yaw, g.pitch);
        packet::idle_micro_rotation(bot, &pcfg, cy, cp);
    }

    if tick >= g.walk_until {
        bot.walk(WalkDirection::None);
    }

    // Drain trigger-reply entries whose next tick has arrived. Each entry carries
    // the remaining messages (already formatted as /msg lines) and the tick to send
    // the next one. Uses the shared outbox so anti-spam gap applies consistently.
    let mut to_send: Vec<(String, usize, VecDeque<String>)> = Vec::new();
    for (user, next_tick, cfg_idx, remaining) in g.pending_replies.iter() {
        if tick >= *next_tick {
            to_send.push((user.clone(), *cfg_idx, remaining.clone()));
        }
    }
    // Remove entries being processed from pending_replies first.
    g.pending_replies.retain(|(user, next_tick, _, _)| {
        !(tick >= *next_tick)
    });
    for (user, cfg_idx, mut remaining) in to_send {
        if let Some(line) = remaining.pop_front() {
            // Re-queue the rest with the per-trigger interval (in ticks).
            let interval_ticks = if cfg_idx < ctx.cfg.trigger_configs.len() {
                ctx.cfg.trigger_configs[cfg_idx].reply_interval.max(1)
            } else {
                // Legacy trigger: gap between reply lines (reply_delay ≈ seconds, *20 for ticks)
                (ctx.cfg.reply_delay * 20).max(40)
            };

            if !remaining.is_empty() {
                g.pending_replies.push((
                    user.clone(),
                    tick.saturating_add(interval_ticks),
                    cfg_idx,
                    remaining,
                ));
            } else {
                // All messages sent — record cooldown.
                g.recent.insert(user.clone(), now);
            }
            // Scope the lock release/acquire to this block so the outer `g`
            // is unaffected by the shadowing.
            {
                drop(g);
                enqueue_chat(&mut ctx.inner.lock(), None, line, tick, ctx);
            }
            g = ctx.inner.lock();
            webhook::reply(
                ctx.cfg.webhook_url.clone(),
                &ctx.account.your_username,
                &user,
                &ctx.cfg.reply,
            );
        }
    }

    // Periodic broadcast: only enqueue when the outbox is clear so trigger
    // replies always take priority and we don't build a backlog of stale ads.
    if g.outbox.is_empty() && tick >= g.last_msg_tick + g.next_msg_ticks {
        g.last_msg_tick = tick;
        g.next_msg_ticks = jittered(ctx.cfg.message_interval, st.message_jitter, &mut rng);
        let text = pick_random(&ctx.cfg.messages, &mut rng)
            .unwrap_or_else(|| &ctx.cfg.message)
            .clone();
        let text = mutate_bypass_text(&text, &mut rng);
        enqueue_chat(&mut g, None, text, tick, ctx);
    }

    if tick >= g.last_afk_tick + g.next_afk_ticks {
        g.last_afk_tick = tick;
        g.next_afk_ticks = afk_ticks(ctx.cfg.afk_interval, st.human_afk, &mut rng);
        do_afk(bot, ctx, &mut g, tick, &mut rng);
    } else if st.enabled && ctx.persona.idle_drift && tick % 7 == 0 && g.look_target.is_none() {
        let dy = rng.gen_range(-2.0..2.0);
        let dp = rng.gen_range(-1.0..1.0);
        let (cy, cp) = (g.yaw, g.pitch);
        set_look(&mut g, cy + dy, cp + dp, ctx, 4);
    }

    let timeout = ctx.cfg.inattivita_timeout;
    let elapsed = g.last_trigger.map(|t| now.duration_since(t).as_secs());
    if let Some(e) = elapsed {
        if e >= timeout {
            logln!(
                YELLOW,
                "[{}] [INACTIVITY] No trigger for {}s — switching account",
                ctx.account.your_username,
                e
            );
            ctx.rotate.store(true, Ordering::SeqCst);
            drop(g);
            bot.disconnect();
        }
    }
}

fn do_afk(bot: &Client, ctx: &Arc<RunCtx>, g: &mut Inner, tick: u64, rng: &mut impl Rng) {
    if !ctx.cfg.stealth.human_afk {
        let dir = if rng.gen_bool(0.5) {
            WalkDirection::Forward
        } else {
            WalkDirection::Backward
        };
        bot.walk(dir);
        g.walk_until = tick + 20;
        return;
    }
    let roll = rng.gen_range(0..100);
    if roll < 40 {
        let y = rng.gen_range(-180.0..180.0);
        let p = rng.gen_range(-25.0..30.0);
        set_look(g, y, p, ctx, 10);
    } else if roll < 65 {
        let y = rng.gen_range(-180.0..180.0);
        set_look(g, y, rng.gen_range(-12.0..18.0), ctx, 8);
        // sprint_bias della persona: a volte la camminata diventa sprint, come
        // un giocatore reale che si sposta piu' velocemente in avanti.
        if rng.gen_bool(ctx.persona.sprint_bias.clamp(0.0, 1.0)) {
            let dir = match rng.gen_range(0..3) {
                0 => SprintDirection::Forward,
                1 => SprintDirection::ForwardLeft,
                _ => SprintDirection::ForwardRight,
            };
            bot.sprint(dir);
        } else {
            let dir = match rng.gen_range(0..6) {
                0 => WalkDirection::Forward,
                1 => WalkDirection::Backward,
                2 => WalkDirection::Left,
                3 => WalkDirection::Right,
                4 => WalkDirection::ForwardLeft,
                _ => WalkDirection::ForwardRight,
            };
            bot.walk(dir);
        }
        g.walk_until = tick + rng.gen_range(5..19);
    } else if roll < 77 {
        // jump_bias della persona modula quanto spesso il salto avviene davvero.
        if rng.gen_bool((0.4 + ctx.persona.jump_bias).clamp(0.0, 1.0)) {
            bot.set_jumping(true);
            bot.set_jumping(false);
        }
        g.walk_until = g.walk_until.max(tick + 4);
    } else {
        let y = rng.gen_range(-180.0..180.0);
        let cp = g.pitch;
        set_look(g, y, cp, ctx, 6);
    }
}

fn enqueue_chat(g: &mut Inner, sender: Option<String>, text: String, tick: u64, ctx: &Arc<RunCtx>) {
    if !ctx.cfg.stealth.human_chat {
        g.outbox.push_back((sender, VecDeque::from([text]), tick));
        return;
    }
    let typing = (text.chars().count() as f64 / ctx.persona.typing_cps * TPS) as u64;
    let mut base = (ctx.persona.reaction_ticks as u64) + typing.min(180);
    let pcfg = PacketCfg::from(&ctx.cfg.stealth);
    let mut rng = rand::thread_rng();
    base = packet::jitter_ticks(&pcfg, &mut rng, base);
    g.outbox.push_back((sender, VecDeque::from([text]), tick + base.max(2)));
}

/// Normalize a message for similarity comparison: lowercase, trim, and drop
/// trailing decorative punctuation we add in `vary_dup` so two variants of the
/// same base message are recognized as "the same".
fn normalize_msg(s: &str) -> String {
    s.trim()
        .trim_end_matches(|c: char| {
            c.is_whitespace() || matches!(c, '.' | '!' | ')' | '(' | ':' | '3' | '~' | '-' | '_')
        })
        .to_lowercase()
}

/// True if `text` is essentially the same as something we sent recently — the
/// server rejects near-duplicates, so we must vary it before sending.
fn is_too_similar(recent: &VecDeque<String>, text: &str) -> bool {
    let n = normalize_msg(text);
    if n.is_empty() {
        return false;
    }
    recent.iter().any(|prev| normalize_msg(prev) == n)
}

/// Return a random element from a slice, or `None` if empty.
fn pick_random<'a, T>(slice: &'a [T], rng: &mut impl Rng) -> Option<&'a T> {
    if slice.is_empty() {
        None
    } else {
        Some(&slice[rng.gen_range(0..slice.len())])
    }
}

/// Poll the runner outbox for AI chat messages and enqueue them.
fn poll_outbox() {
    let runner_url = match std::env::var("RUNNER_CALLBACK_URL") {
        Ok(u) if !u.is_empty() => u,
        _ => return,
    };
    let runner_token = match std::env::var("RUNNER_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => return,
    };
    let run_id = match std::env::var("RUN_ID") {
        Ok(r) if !r.is_empty() => r,
        _ => return,
    };

    let base = runner_url.trim_end_matches("/callback").trim_end_matches("/api/runner").trim_end_matches("/");
    let url = format!("{base}/api/runner/outbox?runId={run_id}");
    let token = runner_token;

    // Spawn a short-lived tokio task for the HTTP request.
    tokio::spawn(async move {
        let client = match reqwest::Client::builder().build() {
            Ok(c) => c,
            Err(_) => return,
        };
        let res = match client
            .get(&url)
            .header("x-runner-token", &token)
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r,
            _ => return,
        };
        #[derive(serde::Deserialize)]
        struct OutboxResponse {
            messages: Vec<OutboxMessage>,
        }
        #[derive(serde::Deserialize)]
        struct OutboxMessage {
            id: String,
            content: String,
            sender: Option<String>,
        }
        let body: OutboxResponse = match res.json().await {
            Ok(b) => b,
            Err(_) => return,
        };
        if body.messages.is_empty() {
            return;
        }
        // Messages are already marked claimed by the GET handler server-side.
        // Store them in the world_view pending outbox so the tick loop picks them up.
        for msg in body.messages {
            crate::world_view::enqueue_chat(msg.sender, msg.content);
        }
    });
}

/// Mutate a message that's too similar to a recent send so the server doesn't
/// reject it. When `humanise` is true, adds randomised prefixes/suffixes to
/// vary the text; otherwise only trailing decoration suffixes are applied.
fn vary_dup(text: &str, humanise: bool) -> String {
    let mut rng = rand::thread_rng();
    let suffixes = ["", ".", "!", " :)", " gg", "..", " :3", " !", " ~", "...", " :D"];
    let s = suffixes[rng.gen_range(0..suffixes.len())];
    if humanise && rng.gen_bool(0.3) {
        let prefixes = ["yo ", "hey ", "ok ", "btw ", "psst "];
        let p = prefixes[rng.gen_range(0..prefixes.len())];
        format!("{p}{text}{s}")
    } else {
        format!("{text}{s}")
    }
}

fn set_look(g: &mut Inner, yaw: f32, pitch: f32, ctx: &Arc<RunCtx>, steps: u32) {
    let p = pitch.clamp(-89.0, 89.0);
    if !ctx.cfg.stealth.smooth_look {
        g.yaw = yaw;
        g.pitch = p;
        g.look_target = Some((yaw, p));
        g.look_step = 0;
        g.look_total = 1;
        return;
    }
    let s = ((steps as f64) / ctx.persona.sensitivity).round() as u32;
    g.look_target = Some((yaw, p));
    g.look_step = 0;
    g.look_total = s.max(3);
}

fn step_look(bot: &Client, g: &mut Inner, pcfg: &PacketCfg) {
    let Some((ty, tp)) = g.look_target else { return };
    if g.look_step >= g.look_total {
        g.look_target = None;
        return;
    }
    g.look_step += 1;
    let t = g.look_step as f32 / g.look_total as f32;
    let e = t * t * (3.0 - 2.0 * t);
    let mut delta = (ty - g.yaw) % 360.0;
    if delta > 180.0 {
        delta -= 360.0;
    } else if delta < -180.0 {
        delta += 360.0;
    }
    let mut rng = rand::thread_rng();
    let ny = g.yaw + delta * e + rng.gen_range(-0.6..0.6);
    let np = (g.pitch + (tp - g.pitch) * e + rng.gen_range(-0.4..0.4)).clamp(-89.0, 89.0);
    g.yaw = ny;
    g.pitch = np;
    if g.look_step == g.look_total {
        packet::humanized_rotation(bot, pcfg, ny, np);
    } else {
        bot.set_direction(ny, np);
    }
}

fn jittered(secs: u64, jitter: f64, rng: &mut impl Rng) -> u64 {
    let base = secs as f64 * TPS;
    let factor = if jitter > 0.0 {
        1.0 + rng.gen_range(-jitter..jitter)
    } else {
        1.0
    };
    (base * factor).max(3.0 * TPS) as u64
}

fn afk_ticks(secs: u64, human: bool, rng: &mut impl Rng) -> u64 {
    let base = secs as f64 * TPS;
    if human {
        (base * rng.gen_range(0.6..1.4)) as u64
    } else {
        base as u64
    }
}

fn strip_section(s: &str) -> String {
    let re = Regex::new(r"§.").unwrap();
    re.replace_all(s, "").trim().to_string()
}

fn clean_name(s: &str) -> Option<String> {
    let re = Regex::new(r"\[.*?\]").unwrap();
    let stripped = re.replace_all(s, "");
    let name: String = stripped
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn extract_sender(text: &str) -> Option<String> {
    let re = Regex::new(r"(.+?)\s*(?:»|>|:|➛)\s*(.+)").ok()?;
    let caps = re.captures(text)?;
    clean_name(caps.get(1)?.as_str())
}
