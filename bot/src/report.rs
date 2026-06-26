use serde_json::json;

// Reports back to the website's runner API. When the panel launches a bot it
// injects RUNNER_CALLBACK_URL (…/api/runner/callback), RUNNER_TOKEN and BOT_ID
// into the container (see docker.server.ts). We use those to tell the site the
// in-game username we detected from the authenticated profile, so the dashboard
// knows whose skin/bust to render.

/// Derive the identity endpoint (…/api/runner/identity) from the callback URL.
fn identity_url() -> Option<String> {
    let cb = std::env::var("RUNNER_CALLBACK_URL").ok()?;
    let cb = cb.trim();
    if cb.is_empty() {
        return None;
    }
    Some(cb.replace("/callback", "/identity"))
}

/// Fire-and-forget POST of the detected in-game username for this bot. No-ops
/// when not running under the panel (env vars absent), so local runs are fine.
pub fn detected_username(username: &str) {
    let url = match identity_url() {
        Some(u) => u,
        None => return,
    };
    let bot_id = match std::env::var("BOT_ID") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return,
    };
    let token = std::env::var("RUNNER_TOKEN").unwrap_or_default();
    let username = username.to_string();

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let _ = client
            .post(&url)
            .header("x-runner-token", token)
            .json(&json!({ "botId": bot_id, "mcUsername": username }))
            .send()
            .await;
    });
}

/// Fire-and-forget POST of the bot's lifecycle status to the callback URL.
/// Tells the panel the bot is "running" (or "stopped"/"error") so the dashboard
/// reflects the correct status without requiring a polling loop.
pub fn report_status(status: &str) {
    let cb = match std::env::var("RUNNER_CALLBACK_URL") {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => return,
    };
    let run_id = match std::env::var("RUN_ID") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return,
    };
    let bot_id = match std::env::var("BOT_ID") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return,
    };
    let token = std::env::var("RUNNER_TOKEN").unwrap_or_default();
    let status = status.to_string();
    let run_id_clone = run_id.clone();
    let bot_id_clone = bot_id.clone();
    let token_clone = token.clone();

    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .ok();
        let client = match client {
            Some(c) => c,
            None => return,
        };
        let _ = client
            .post(&cb)
            .header("x-runner-token", token_clone)
            .json(&json!({
                "runId": run_id_clone,
                "botId": bot_id_clone,
                "status": status,
            }))
            .send()
            .await;
    });
}
