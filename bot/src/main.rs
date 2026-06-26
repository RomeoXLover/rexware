mod auth;
mod ai_chat;
mod config;
mod handler;
mod log;
mod packet;
mod persona;
mod proxy;
mod report;
mod webhook;
mod world_view;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use azalea::prelude::*;
use parking_lot::Mutex;

use config::Config;
use handler::{handle, RunCtx, TransferPlugin};
use log::{GREEN, RED, YELLOW};
use persona::Persona;

fn config_path() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("feather_config.json")
}

#[tokio::main]
async fn main() {
    if std::env::var_os("RUST_LOG").is_none() {
        std::env::set_var(
            "RUST_LOG",
            "warn,\
             azalea_client::plugins::connection=off,\
             azalea_client::plugins::packet=off,\
             azalea::swarm=off",
        );
    }

    let path = config_path();

    if let Some(raw) = std::env::var_os("BOT_CONFIG_JSON") {
        let raw = raw.to_string_lossy();
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            match std::fs::write(&path, trimmed.as_bytes()) {
                Ok(_) => logln!(GREEN, "[CONFIG] Config injected from BOT_CONFIG_JSON"),
                Err(e) => logln!(RED, "[CONFIG] Failed to write injected config: {e}"),
            }
        }
    }

    let cfg = match Config::load_or_create(&path) {
        Ok(Some(c)) => Arc::new(c),
        Ok(None) => {
            logln!(
                YELLOW,
                "[CONFIG] Created feather_config.json - add your accounts and restart."
            );
            return;
        }
        Err(e) => {
            logln!(RED, "[CONFIG] Error: {e}");
            return;
        }
    };

    if cfg.accounts.is_empty() {
        logln!(RED, "[MAIN] No accounts configured.");
        return;
    }

    // Initialise the world-view HTTP client (best-effort POST of snapshots to
    // the web container's runner API). No-ops when RUNNER_CALLBACK_URL is absent
    // (local runs outside the panel don't need it).
    world_view::init();

    // Initialise AI chat module (best-effort; no-ops when ai_enabled=false).
    ai_chat::init(&cfg);

    logln!(YELLOW, "[MAIN] Starting feather-bot (azalea)");
    logln!(YELLOW, "[MAIN] Accounts configured: {}", cfg.accounts.len());
    logln!(
        YELLOW,
        "[MAIN] Inactivity timeout: {}s",
        cfg.inattivita_timeout
    );

    let address = format!("{}:{}", cfg.host, cfg.port);
    let mut current_address = address.clone();
    let mut index = 0usize;
    let mut backoff = 0u32;
    let mut transfer_attempts = 0usize;
    let mut proxy_override: Option<String> = None;

    loop {
        let mut account_cfg = cfg.accounts[index].clone();
        let mut proxy_raw = proxy_override
            .take()
            .or_else(|| cfg.proxy_for(&account_cfg, index));
        let persona = Persona::derive(&account_cfg.username, &cfg.stealth);

        // Reset per-session state so a failed/transferred previous session
        // doesn't pollute the new one (stale transfer_attempts causes instant
        // proxy rotation with no fair chance to connect).
        transfer_attempts = 0;
        backoff = 0;

        logln!(
            YELLOW,
            "[MANAGER] Starting account {}/{}: {}",
            index + 1,
            cfg.accounts.len(),
            account_cfg.username
        );

        let account = match auth::build(&cfg, &account_cfg).await {
            Ok(a) => a,
            Err(e) => {
                auth::log_unsupported(&e);
                webhook::event(
                    cfg.webhook_url.clone(),
                    &account_cfg.username,
                    webhook::Level::Error,
                    "Login failed",
                    &format!("Could not authenticate `{}`.\n```{e}```", account_cfg.username),
                );
                tokio::time::sleep(Duration::from_secs(cfg.reconnect_delay)).await;
                continue;
            }
        };

        if account_cfg.your_username.trim().is_empty() && !account.username.is_empty() {
            account_cfg.your_username = account.username.clone();
            logln!(
                GREEN,
                "[AUTH] Bot username detected automatically: {}",
                account_cfg.your_username
            );
        }

        if !account.username.is_empty() {
            report::detected_username(&account.username);
        }

        let ctx = Arc::new(RunCtx {
            cfg: cfg.clone(),
            account: account_cfg.clone(),
            persona,
            rotate: AtomicBool::new(false),
            transferring: AtomicBool::new(false),
            transfer_target: Mutex::new(None),
            is_proxy_loop: AtomicBool::new(false),
            connected: AtomicBool::new(false),
            inner: Mutex::new(Default::default()),
        });
        handler::set_current(ctx.clone());

        if let Some(raw) = proxy_raw.clone() {
            if let Some((h, p, _)) = proxy::parse(&raw) {
                logln!(YELLOW, "[PROXY] socks5://{h}:{p}");
            }
            if cfg.test_proxies {
                logln!(YELLOW, "[PROXY] Testing connectivity...");
                match proxy::test(&raw, &cfg.host, cfg.port).await {
                    Ok(t) => logln!(
                        GREEN,
                        "[PROXY] OK - tcp:{} latency:{}ms exit_ip:{}",
                        t.tcp_ok,
                        t.latency_ms,
                        t.exit_ip.unwrap_or_else(|| "n/a".into())
                    ),
                    Err(e) => {
                        logln!(RED, "[PROXY] Test failed: {e}");
                        if cfg.require_proxy {
                            logln!(RED, "[PROXY] require_proxy enabled - rotating account");
                            index = (index + 1) % cfg.accounts.len();
                            tokio::time::sleep(Duration::from_secs(cfg.reconnect_delay)).await;
                            continue;
                        }
                        logln!(YELLOW, "[PROXY] Falling back to direct connection");
                        proxy_raw = None;
                    }
                }
            }
        }

        let result = run_once(&account, &current_address, proxy_raw.as_deref()).await;

        if ctx.connected.load(Ordering::SeqCst) {
            transfer_attempts = 0;
        }

        match result {
            Err(e) => {
                logln!(RED, "[BOT] Error: {e}");
                let who = if account_cfg.your_username.trim().is_empty() {
                    account_cfg.username.clone()
                } else {
                    account_cfg.your_username.clone()
                };
                webhook::event(
                    cfg.webhook_url.clone(),
                    &who,
                    webhook::Level::Error,
                    "Connection error",
                    &format!("`{who}` hit a connection error.\n```{e}```"),
                );
            }
            Ok(_) => {}
        }

        if ctx.transferring.load(Ordering::SeqCst) {
            backoff = 0;
            transfer_attempts += 1;
            let target = ctx.transfer_target.lock().take();
            let connected_this_run = ctx.connected.load(Ordering::SeqCst);
            let is_loop = ctx.is_proxy_loop.load(Ordering::SeqCst);
            if let Some((host, port)) = target {
                if !connected_this_run {
                    transfer_attempts += 1;
                }
                if connected_this_run || transfer_attempts < 2 {
                    current_address = format!("{host}:{port}");
                    // Proxy loops need more time for Velocity to propagate the routing
                    // cookie. Start at transfer_wait and grow; direct server transfers
                    // can use the shorter default.
                    let wait = if is_loop {
                        cfg.transfer_wait.saturating_add((transfer_attempts as u64).saturating_sub(1) * 3)
                            .min(20)
                    } else {
                        cfg.transfer_wait.min(3)
                    };
                    if is_loop {
                        logln!(
                            YELLOW,
                            "[BOT] Transfer loop detected (proxy cookie round-trip) - reconnecting to {current_address} in {wait}s"
                        );
                    } else {
                        logln!(
                            YELLOW,
                            "[BOT] Transfer packet -> reconnecting to {current_address} in {wait}s"
                        );
                    }
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                } else {
                    handler::clear_cookies();
                    current_address = address.clone();
                    match cfg.proxy_rotated(&account_cfg, transfer_attempts) {
                        Some(next) => {
                            if let Some((h, p, _)) = proxy::parse(&next) {
                                logln!(
                                    YELLOW,
                                    "[BOT] Transfer loop #{transfer_attempts} (never joined) - rotating to a fresh proxy socks5://{h}:{p}"
                                );
                            }
                            proxy_override = Some(next);
                            let delay =
                                15u64.min(cfg.transfer_wait + 5);
                            tokio::time::sleep(Duration::from_secs(delay)).await;
                        }
                        None => {
                            if transfer_attempts >= 3 {
                                logln!(
                                    RED,
                                    "[BOT] Too many consecutive Transferring-region kicks with no proxy pool. Moving to next account."
                                );
                                ctx.rotate.store(true, Ordering::SeqCst);
                            }
                            let wait = 12u64.min(cfg.transfer_wait + 4);
                            logln!(
                                YELLOW,
                                "[BOT] Transfer loop #{transfer_attempts} (never joined, no proxy pool) - waiting {wait}s then reconnecting to {current_address}"
                            );
                            tokio::time::sleep(Duration::from_secs(wait)).await;
                        }
                    }
                }
            } else {
                current_address = address.clone();
                match cfg.proxy_rotated(&account_cfg, transfer_attempts) {
                    Some(next) => {
                        if let Some((h, p, _)) = proxy::parse(&next) {
                            logln!(
                                YELLOW,
                                "[BOT] Transferring-region kick #{transfer_attempts} - rotating to a fresh proxy socks5://{h}:{p}"
                            );
                        }
                        proxy_override = Some(next);
                        let delay = 15u64.min(cfg.transfer_wait + 5);
                        tokio::time::sleep(Duration::from_secs(delay)).await;
                    }
                    None => {
                        if transfer_attempts >= 3 {
                            logln!(
                                RED,
                                "[BOT] Too many consecutive Transferring-region kicks with no proxy pool. Moving to next account."
                            );
                            ctx.rotate.store(true, Ordering::SeqCst);
                        }
                        let wait = 12u64.min(cfg.transfer_wait + 4);
                        logln!(
                            YELLOW,
                            "[BOT] Transferring region #{transfer_attempts} (no proxy pool) - waiting {wait}s then reconnecting to {current_address}"
                        );
                        tokio::time::sleep(Duration::from_secs(wait)).await;
                    }
                }
            }
        } else if ctx.rotate.load(Ordering::SeqCst) {
            backoff = 0;
            transfer_attempts = 0;
            handler::clear_cookies();
            current_address = address.clone();
            index = (index + 1) % cfg.accounts.len();
            tokio::time::sleep(Duration::from_secs(2)).await;
        } else {
            backoff += 1;
            transfer_attempts = 0;
            handler::clear_cookies();
            current_address = address.clone();
            let delay = (cfg.reconnect_delay * 2u64.pow(backoff.min(4))).min(600);
            logln!(YELLOW, "[BOT] Disconnected - reconnecting in {delay}s");
            tokio::time::sleep(Duration::from_secs(delay)).await;
        }
    }
}

async fn run_once(
    account: &Account,
    address: &str,
    proxy_raw: Option<&str>,
) -> anyhow::Result<()> {
    let builder = ClientBuilder::new()
        .set_handler(handle)
        .add_plugins(TransferPlugin);
    match proxy_raw {
        Some(raw) => {
            let opts = proxy::build_join_opts(raw);
            let exit = builder
                .start_with_opts(account.clone(), address, opts)
                .await;
            logln!(YELLOW, "[BOT] Session ended: {exit:?}");
        }
        None => {
            let exit = builder.start(account.clone(), address).await;
            logln!(YELLOW, "[BOT] Session ended: {exit:?}");
        }
    }
    Ok(())
}
