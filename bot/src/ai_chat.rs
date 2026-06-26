//! AI chat module for the Minecraft bot.
//! When `ai_enabled` is set in config, chat messages trigger an LLM call
//! (via Groq/OpenAI-compatible API) and the bot replies with the model's response.
//!
//! Per-user overrides: specific Minecraft players can have their own custom AI model
//! and/or system prompt. When a message arrives from a matched username, their custom
//! settings are used instead of the bot's default.

use std::collections::HashMap;
use std::sync::Arc;

use crate::config::{AiUserOverride, Config};
use crate::handler::RunCtx;
use crate::log::CYAN;

/// Per-user AI override — custom model and/or prompt for a specific Minecraft player.
#[derive(Clone)]
struct PerUserCfg {
    model: Option<String>,
    prompt: Option<String>,
}

/// Global AI configuration loaded once at startup from the Rust Config.
struct AiCfg {
    api_key: String,
    default_model: String,
    default_prompt: String,
    /// Per-user overrides, keyed by lowercase Minecraft username.
    user_overrides: HashMap<String, PerUserCfg>,
}

impl AiCfg {
    /// Resolve effective model and prompt for a given Minecraft username.
    /// Returns (model, prompt) — either from the per-user override or the defaults.
    fn resolve(&self, mc_username: &str) -> (String, String) {
        let key = mc_username.to_lowercase();
        if let Some(override_) = self.user_overrides.get(&key) {
            let model = override_
                .model
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(&self.default_model);
            let prompt = override_
                .prompt
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(&self.default_prompt);
            return (model.to_string(), prompt.to_string());
        }
        (self.default_model.clone(), self.default_prompt.clone())
    }
}

static LAST_CFG: parking_lot::Mutex<Option<AiCfg>> = parking_lot::Mutex::new(None);

/// Module initialised; returns early if AI is disabled.
pub fn init(cfg: &Config) {
    if !cfg.ai_enabled {
        println!("[AI] AI chat disabled.");
        return;
    }
    if cfg.ai_api_key.is_empty() {
        println!("[AI] AI chat enabled but ai_api_key is empty — replies will fail.");
        return;
    }

    let default_model = if cfg.ai_model.is_empty() {
        "llama-3.3-70b-versatile".to_string()
    } else {
        cfg.ai_model.clone()
    };
    let default_prompt = if cfg.ai_prompt.is_empty() {
        "You are a friendly Minecraft player on a server. Reply casually, briefly, and in character."
            .to_string()
    } else {
        cfg.ai_prompt.clone()
    };

    // Build per-user overrides map.
    let user_overrides: HashMap<String, PerUserCfg> = cfg
        .ai_user_overrides
        .iter()
        .map(|o| {
            (
                o.mc_username.to_lowercase(),
                PerUserCfg {
                    model: o.ai_model.clone(),
                    prompt: o.ai_prompt.clone(),
                },
            )
        })
        .collect();

    // Snapshot count and first 5 names before we move the map into LAST_CFG.
    let override_count = user_overrides.len();
    let first_names: Vec<String> = user_overrides.keys().take(5).cloned().collect();

    LAST_CFG.lock().replace(AiCfg {
        api_key: cfg.ai_api_key.clone(),
        default_model,
        default_prompt,
        user_overrides,
    });

    let model_display = if cfg.ai_model.is_empty() {
        "llama-3.3-70b-versatile"
    } else {
        cfg.ai_model.as_str()
    };
    println!(
        "[AI] AI chat enabled. Model: {model_display}. Per-user overrides: {override_count}.",
    );
    if override_count > 0 {
        let suffix = if override_count > 5 { " ..." } else { "" };
        println!("[AI] Override targets: {}{suffix}", first_names.join(", "));
    }
}

/// Called from the chat handler. Returns immediately if AI is disabled or no API key.
/// `mc_username` is the Minecraft in-game name of the message sender.
pub fn capture_message(mc_username: &str, message: &str) {
    let (api_key, model, prompt, sender, msg_text) = {
        let guard = LAST_CFG.lock();
        match guard.as_ref() {
            Some(cfg) => {
                let api_key = cfg.api_key.clone();
                let (model, prompt) = cfg.resolve(mc_username);
                (api_key, model, prompt, mc_username.to_string(), message.to_string())
            }
            None => return,
        }
    };

    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(_) => return,
        };

        rt.block_on(ai_reply(&api_key, &model, &prompt, &sender, &msg_text));
    });
}

async fn ai_reply(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    sender: &str,
    message: &str,
) {
    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            println!("[AI] Failed to build HTTP client: {e}");
            return;
        }
    };

    let url = "https://api.groq.com/openai/v1/chat/completions";
    let payload = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": format!("{} said: {}", sender, message) }
        ],
        "max_tokens": 150,
        "temperature": 0.8,
    });

    let res = match client
        .post(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            println!("[AI] Request failed: {e}");
            return;
        }
    };

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        println!("[AI] Groq API error {status}: {body}");
        return;
    }

    let body: serde_json::Value = match res.json().await {
        Ok(b) => b,
        Err(e) => {
            println!("[AI] Failed to parse JSON response: {e}");
            return;
        }
    };

    let reply = match body["choices"].get(0) {
        Some(choice) => match choice.get("message") {
            Some(msg) => match msg.get("content") {
                Some(content) => match content.as_str() {
                    Some(s) => s.trim(),
                    None => {
                        println!("[AI] Empty reply from model, skipping.");
                        return;
                    }
                },
                None => {
                    println!("[AI] Empty reply from model, skipping.");
                    return;
                }
            },
            None => {
                println!("[AI] Empty reply from model, skipping.");
                return;
            }
        },
        None => {
            println!("[AI] Empty reply from model, skipping.");
            return;
        }
    };

    if reply.is_empty() {
        println!("[AI] Empty reply from model, skipping.");
        return;
    }

    enqueue_reply(reply, &sender).await;
}

async fn enqueue_reply(text: &str, sender: &str) {
    let runner_url = std::env::var("RUNNER_CALLBACK_URL").ok();
    let runner_token = std::env::var("RUNNER_TOKEN").ok();
    let bot_id = std::env::var("BOT_ID").ok();

    let (Some(runner_url), Some(runner_token), Some(bot_id)) =
        (runner_url, runner_token, bot_id)
    else {
        println!(
            "[AI] RUNNER_CALLBACK_URL / RUNNER_TOKEN / BOT_ID not set — cannot enqueue reply."
        );
        return;
    };

    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(_) => return,
    };

    let payload = serde_json::json!({
        "botId": bot_id,
        "action": "chat",
        "sender": sender,
        "text": text,
    });

    match client
        .post(&runner_url)
        .header("x-runner-token", &runner_token)
        .json(&payload)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            println!("[AI] Enqueued reply to {}: {}", sender, text);
        }
        Ok(r) => {
            println!(
                "[AI] Failed to enqueue reply ({}): {:?}",
                r.status().as_u16(),
                r.text().await
            );
        }
        Err(e) => {
            println!("[AI] Failed to send reply enqueue request: {e}");
        }
    }
}
