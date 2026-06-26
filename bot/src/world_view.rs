use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::Client;
use serde_json::json;

/// Last position snapshot captured from the ECS tick. Written by the tick
/// handler (main thread) and read by the background sender task.
static LAST_SNAP: parking_lot::Mutex<Option<BotSnapshot>> = parking_lot::const_mutex(None);
/// Pending AI chat messages from the outbox poll. Written by poll_outbox, read
/// by the tick loop (on the same thread) and cleared as they are dispatched.
/// Each entry is (sender_opt, messages): Some(username) = private /msg, None = public.
static PENDING_CHATS: parking_lot::Mutex<VecDeque<(Option<String>, VecDeque<String>)>> =
    parking_lot::const_mutex(VecDeque::new());
/// Pending payment notifications from the website. Written by the background
/// payment-polling task, drained by the tick loop.
/// Each entry is (mc_username, message_text).
static PENDING_PAYMENTS: parking_lot::Mutex<VecDeque<(String, String)>> =
    parking_lot::const_mutex(VecDeque::new());
/// Whether the background sender task has been started (once per process).
static SENDER_STARTED: AtomicBool = AtomicBool::new(false);
/// Whether the payment-polling task has been started (once per process).
static PAYMENT_POLL_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, serde::Serialize)]
pub struct BotSnapshot {
    pub bot_id: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub yaw: f32,
    pub pitch: f32,
    pub health: f32,
    pub username: String,
    pub on_ground: bool,
}

/// Initialise the world-view pipeline. No-ops if RUNNER_CALLBACK_URL is absent.
pub fn init() {
    if SENDER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let url = match std::env::var("RUNNER_CALLBACK_URL") {
        Ok(u) if !u.is_empty() => u,
        _ => return,
    };
    let token = std::env::var("RUNNER_TOKEN").unwrap_or_default();
    let bot_id = std::env::var("BOT_ID").unwrap_or_default();

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()
        .ok();

    // callback URL ends with /api/runner/callback; strip it to get the base.
    let base = url.trim_end_matches("/callback").trim_end_matches("/api/runner").trim_end_matches("/");
    let endpoint = format!("{}/api/runner/world", base);
    let endpoint_for_log = endpoint.clone();

    tokio::spawn(async move {
        let client = match client {
            Some(c) => c,
            None => return,
        };
        let token = token;
        let endpoint = endpoint;
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            interval.tick().await;

            let snap = { LAST_SNAP.lock().clone() };
            let Some(snap) = snap else { continue };

            let payload = json!({
                "botId": snap.bot_id,
                "bot": {
                    "x": snap.x,
                    "y": snap.y,
                    "z": snap.z,
                    "yaw": snap.yaw,
                    "pitch": snap.pitch,
                    "health": snap.health,
                    "username": snap.username,
                    "on_ground": snap.on_ground,
                },
                "entities": [],
            });

            let _ = client
                .post(&endpoint)
                .header("x-runner-token", &token)
                .json(&payload)
                .send()
                .await;
        }
    });

    if !bot_id.is_empty() {
        println!(
            "[WV] World-view enabled  botId={}  endpoint={}",
            bot_id, endpoint_for_log
        );
    }

    // ── Payment notification polling (every 10 seconds) ─────────────────────
    if PAYMENT_POLL_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let token = std::env::var("RUNNER_TOKEN").unwrap_or_default();
    let url = std::env::var("RUNNER_CALLBACK_URL").unwrap_or_default();

    tokio::spawn(async move {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()
            .ok();

        let base = url.trim_end_matches("/callback").trim_end_matches("/api/runner").trim_end_matches("/");
        let endpoint = format!("{}/api/runner/payments", base);

        let mut interval = tokio::time::interval(Duration::from_secs(10));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            interval.tick().await;

            let Some(client) = client.as_ref() else { continue };

            let resp = client
                .get(&endpoint)
                .header("x-runner-token", &token)
                .send()
                .await;

            let Ok(resp) = resp else { continue };
            let Ok(body) = resp.text().await else { continue };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) else { continue };

            let payments = match json.get("payments").and_then(|p| p.as_array()) {
                Some(arr) => arr,
                None => continue,
            };

            for item in payments {
                let Some(mc_username) = item.get("mcUsername").and_then(|v| v.as_str()) else {
                    continue;
                };
                let plan_name = item
                    .get("planName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("your plan");
                let coin = item
                    .get("coin")
                    .and_then(|v| v.as_str())
                    .unwrap_or("crypto");
                let amount: f64 = item
                    .get("amountUsd")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);

                let msg = if amount > 0.0 {
                    format!(
                        "Payment confirmed! You purchased {} for {} {}. Your plan is now active!",
                        plan_name, format!("{:.2}", amount), coin
                    )
                } else {
                    format!("Payment confirmed! Your {} is now active!", plan_name)
                };

                PENDING_PAYMENTS.lock().push_back((mc_username.to_string(), msg));
                println!("[PAYMENT] Enqueued DM for {} — {}", mc_username, plan_name);
            }
        }
    });
}

/// Call from the ECS tick handler to capture the latest bot state.
/// Safe to call every tick — the background task throttles POSTs.
pub fn capture(
    username: &str,
    x: f64,
    y: f64,
    z: f64,
    yaw: f32,
    pitch: f32,
    health: f32,
    on_ground: bool,
) {
    if std::env::var("RUNNER_CALLBACK_URL").is_err() {
        return;
    }
    *LAST_SNAP.lock() = Some(BotSnapshot {
        bot_id: std::env::var("BOT_ID").unwrap_or_default(),
        x,
        y,
        z,
        yaw,
        pitch,
        health,
        username: username.to_string(),
        on_ground,
    });
}

/// Called from poll_outbox (tokio thread) to queue a chat message for the tick
/// loop to pick up on the main azalea thread. sender=None means public chat.
pub fn enqueue_chat(sender: Option<String>, text: String) {
    PENDING_CHATS
        .lock()
        .push_back((sender, VecDeque::from([text])));
}

/// Called from the tick loop on the azalea thread to drain pending AI chat messages.
/// Each drain returns (sender_opt, VecDeque<messages>) pairs so multi-message
/// queues are preserved for FIFO delivery.
pub fn drain_pending_chats() -> Vec<(Option<String>, VecDeque<String>)> {
    let mut guard = PENDING_CHATS.lock();
    let msgs: Vec<(Option<String>, VecDeque<String>)> = guard.drain(..).collect();
    msgs
}

/// Drain pending payment notifications from the background polling task.
/// Returns (mc_username, message_text) pairs to be sent as DMs.
pub fn drain_pending_payments() -> Vec<(String, String)> {
    let mut guard = PENDING_PAYMENTS.lock();
    let msgs: Vec<(String, String)> = guard.drain(..).collect();
    msgs
}
