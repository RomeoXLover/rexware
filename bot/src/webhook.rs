use chrono::Utc;
use serde_json::{json, Value};

// Branded Discord webhooks for SkyUtils. Every message is posted as the
// "SkyUtils" identity with a consistent author / thumbnail / footer so the
// channel reads like a clean activity feed instead of raw bot spam.

const BRAND: &str = "SkyUtils";
const BRAND_ICON: &str = "https://mc-heads.net/avatar/MHF_Steve/100";

/// Severity of an event — drives the embed accent colour and the small label
/// shown next to the bot name. Colours mirror the dashboard palette.
#[derive(Clone, Copy)]
pub enum Level {
    Online, // bot connected / in world  → green
    Info,   // neutral lifecycle event   → blue
    Warn,   // recoverable (kick, retry) → amber
    Error,  // failure                   → red
    Ban,    // banned from the server    → crimson
}

impl Level {
    fn color(self) -> u32 {
        match self {
            Level::Online => 0x22c55e,
            Level::Info => 0x3b82f6,
            Level::Warn => 0xf59e0b,
            Level::Error => 0xef4444,
            Level::Ban => 0xdc2626,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Level::Online => "ONLINE",
            Level::Info => "EVENT",
            Level::Warn => "WARNING",
            Level::Error => "ERROR",
            Level::Ban => "BANNED",
        }
    }
}

/// Render URL for a player's head avatar (used as embed thumbnail / icon).
fn head(user: &str) -> String {
    let u: String = user
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .take(16)
        .collect();
    let u = if u.is_empty() { "MHF_Steve".to_string() } else { u };
    format!("https://mc-heads.net/avatar/{u}/64")
}

/// Fire-and-forget POST so the bot loop never blocks on Discord.
fn post(url: String, embed: Value) {
    if url.is_empty() {
        return;
    }
    tokio::spawn(async move {
        let payload = json!({
            "username": BRAND,
            "avatar_url": BRAND_ICON,
            "embeds": [embed],
        });
        let client = reqwest::Client::new();
        let res = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await;
        if let Err(e) = res {
            eprintln!("[Webhook] POST failed: {e}");
        }
    });
}

fn footer() -> Value {
    json!({ "text": format!("{BRAND} · SkyUtils"), "icon_url": BRAND_ICON })
}

/// Branded lifecycle event embed (connect, kick, death, ban, errors, …).
pub fn event(url: String, bot: &str, level: Level, title: &str, description: &str) {
    let embed = json!({
        "author": { "name": format!("{bot} · {}", level.label()), "icon_url": head(bot) },
        "title": title,
        "description": description,
        "color": level.color(),
        "thumbnail": { "url": head(bot) },
        "footer": footer(),
        "timestamp": Utc::now().to_rfc3339(),
    });
    post(url, embed);
}

/// A whisper/reply was sent to a player — shows both the bot and the target.
pub fn reply(url: String, bot: &str, user: &str, message: &str) {
    let msg = if message.trim().is_empty() {
        "—".to_string()
    } else {
        message.to_string()
    };
    let embed = json!({
        "author": { "name": format!("{bot} · REPLY"), "icon_url": head(bot) },
        "title": "Reply sent",
        "color": Level::Info.color(),
        "thumbnail": { "url": head(user) },
        "fields": [
            { "name": "Player", "value": format!("`{user}`"), "inline": true },
            { "name": "Message", "value": msg, "inline": false }
        ],
        "footer": footer(),
        "timestamp": Utc::now().to_rfc3339(),
    });
    post(url, embed);
}
