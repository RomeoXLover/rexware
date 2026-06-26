use serde::{Deserialize, Deserializer, Serialize};
use std::path::Path;

fn yes() -> bool { true }

/// Handles the incoming JSON field `trigger_keywords` which can be either:
/// - a JSON array  e.g. ["123"]  (what the web UI sends)
/// - a JSON string e.g. "123"   (what legacy configs may have sent)
fn deserialize_trigger_keyword<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum RawKeyword {
        Array(Vec<String>),
        String(String),
    }
    match RawKeyword::deserialize(deserializer)? {
        RawKeyword::Array(arr) => {
            Ok(arr.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n"))
        }
        RawKeyword::String(s) => Ok(s),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountCfg {
    pub username: String,
    /// Nome in-game del bot. Lascialo vuoto: viene rilevato automaticamente dal
    /// profilo dopo il login (MSA o SSID). Compila questo campo solo se vuoi
    /// forzare un nome diverso (es. in offline mode).
    #[serde(default)]
    pub your_username: String,
    #[serde(default)]
    pub proxy: Option<String>,
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub uuid: Option<String>,
    #[serde(default)]
    pub ssid: Option<String>,
}

impl AccountCfg {
    pub fn resolved_auth_mode(&self, global: &str) -> String {
        self.auth_mode
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| global.to_string())
            .to_lowercase()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Stealth {
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default = "brand_default")]
    pub brand: String,
    #[serde(default = "auto")]
    pub locale: String,
    #[serde(default = "auto")]
    pub view_distance: String,
    #[serde(default = "auto")]
    pub main_hand: String,
    #[serde(default = "yes")]
    pub smooth_look: bool,
    #[serde(default = "yes")]
    pub human_afk: bool,
    #[serde(default = "yes")]
    pub human_chat: bool,
    #[serde(default = "yes")]
    pub idle_drift: bool,
    #[serde(default = "join_min")]
    pub join_delay_min: f64,
    #[serde(default = "join_max")]
    pub join_delay_max: f64,
    #[serde(default = "jitter")]
    pub message_jitter: f64,
    #[serde(default = "yes")]
    pub packet_spoof: bool,
    #[serde(default = "yes")]
    pub network_jitter: bool,
    #[serde(default = "micro")]
    pub micro_noise: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AiUserOverride {
    pub mc_username: String,
    #[serde(default)]
    pub ai_model: Option<String>,
    #[serde(default)]
    pub ai_prompt: Option<String>,
}

/// One trigger entry: a keyword the bot watches for in whispers, and the
/// sequence of messages it sends back as private whispers (`/msg <user> <msg>`).
/// Each message is spaced by `reply_interval` ticks (~20 ticks/s).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TriggerConfig {
    pub keyword: String,
    pub messages: Vec<String>,
    /// Ticks between each message in the sequence (default 40 ≈ 2 s).
    #[serde(default = "default_reply_interval")]
    pub reply_interval: u64,
}

fn default_reply_interval() -> u64 { 40 }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    pub host: String,
    #[serde(default = "port_default")]
    pub port: u16,
    #[serde(default = "version_default")]
    pub version: String,
    pub accounts: Vec<AccountCfg>,
    #[serde(default = "auth_default")]
    pub auth_mode: String,
    #[serde(default = "auth_cache_default")]
    pub auth_cache: String,
    #[serde(default = "msg_default")]
    pub message: String,
    /// Multiple spam messages; the bot picks one at random each time.
    #[serde(default)]
    pub messages: Vec<String>,
    #[serde(default = "reply_default")]
    pub reply: String,
    /// Ordered command templates run when replying to a trigger. Each entry is
    /// sent as its own chat line. Supports the placeholders `{user}` (the
    /// sender) and `{reply}` (the reply text). When empty the bot falls back to
    /// the legacy `/msg {user} {reply}` behaviour.
    #[serde(default)]
    pub reply_actions: Vec<String>,
    /// Multiple trigger configs. Each entry has its own keyword, message list,
    /// and reply interval. When non-empty this takes priority over the legacy
    /// single trigger_keyword / reply_actions fields.
    #[serde(default)]
    pub trigger_configs: Vec<TriggerConfig>,
    /// Legacy single trigger keyword. Used only when `trigger_configs` is empty.
    #[serde(
        default = "trigger_default",
        alias = "trigger_keywords",
        deserialize_with = "deserialize_trigger_keyword"
    )]
    pub trigger_keyword: String,
    /// Additional reply keywords: if a whisper contains any of these, reply too.
    #[serde(default)]
    pub bulk_reply_keywords: Vec<String>,
    /// Words that trigger a public chat reply (bot says something in general chat).
    #[serde(default)]
    pub bulk_trigger_words: Vec<String>,
    #[serde(default)]
    pub webhook_url: String,
    #[serde(default = "i_message")]
    pub message_interval: u64,
    #[serde(default = "i_reply")]
    pub reply_delay: u64,
    #[serde(default = "i_cooldown")]
    pub reply_cooldown: u64,
    #[serde(default = "i_afk")]
    pub afk_interval: u64,
    #[serde(default = "i_reconnect")]
    pub reconnect_delay: u64,
    /// Seconds to wait after a "Transferring region" kick before reconnecting.
    /// This gives the server's proxy a moment to move us onto the new instance;
    /// if it doesn't, the reconnect (to the same address/account, with no
    /// backoff) makes the proxy route us there.
    #[serde(default = "i_transfer_wait")]
    pub transfer_wait: u64,
    #[serde(default = "i_inactivity")]
    pub inattivita_timeout: u64,
    #[serde(default)]
    pub proxy: String,
    /// AI chat
    #[serde(default)]
    pub ai_enabled: bool,
    #[serde(default)]
    pub ai_api_key: String,
    #[serde(default)]
    pub ai_model: String,
    #[serde(default)]
    pub ai_prompt: String,
    /// Per-user AI overrides — custom model/prompt for specific Minecraft players.
    #[serde(default)]
    pub ai_user_overrides: Vec<AiUserOverride>,
    #[serde(default)]
    pub proxies: Vec<String>,
    #[serde(default = "yes")]
    pub test_proxies: bool,
    #[serde(default)]
    pub require_proxy: bool,
    #[serde(default = "stealth_default")]
    pub stealth: Stealth,
}

fn auto() -> String { "auto".into() }
fn brand_default() -> String { "vanilla".into() }
fn join_min() -> f64 { 2.0 }
fn join_max() -> f64 { 6.0 }
fn jitter() -> f64 { 0.35 }
fn micro() -> f64 { 0.003 }
fn auth_default() -> String { "microsoft".into() }
fn auth_cache_default() -> String { "auth_cache.json".into() }
fn port_default() -> u16 { 25565 }
fn version_default() -> String { "1.21.1".into() }
fn msg_default() -> String { "888 to join unstableSMP".into() }
fn reply_default() -> String { "add me on dc to join - untualab".into() }
fn trigger_default() -> String { "888".into() }
fn i_message() -> u64 { 30 }
fn i_reply() -> u64 { 5 }
fn i_cooldown() -> u64 { 30 }
fn i_afk() -> u64 { 20 }
fn i_reconnect() -> u64 { 60 }
fn i_transfer_wait() -> u64 { 8 }
fn i_inactivity() -> u64 { 300 }

fn stealth_default() -> Stealth {
    Stealth {
        enabled: true,
        brand: brand_default(),
        locale: auto(),
        view_distance: auto(),
        main_hand: auto(),
        smooth_look: true,
        human_afk: true,
        human_chat: true,
        idle_drift: true,
        join_delay_min: join_min(),
        join_delay_max: join_max(),
        message_jitter: jitter(),
        packet_spoof: true,
        network_jitter: true,
        micro_noise: micro(),
    }
}

impl Default for Config {
    fn default() -> Self {
        Config {
            host: "eu.mcpvp.club".into(),
            port: port_default(),
            version: version_default(),
            accounts: (1..=5)
                .map(|i| AccountCfg {
                    username: format!("account{i}@outlook.com"),
                    // Rilevato in automatico dal login: lasciare vuoto.
                    your_username: String::new(),
                    proxy: None,
                    auth_mode: None,
                    access_token: None,
                    uuid: None,
                    ssid: None,
                })
                .collect(),
            auth_mode: auth_default(),
            auth_cache: auth_cache_default(),
            message: msg_default(),
            messages: Vec::new(),
            reply: reply_default(),
            reply_actions: Vec::new(),
            trigger_configs: Vec::new(),
            bulk_reply_keywords: Vec::new(),
            bulk_trigger_words: Vec::new(),
            webhook_url: String::new(),
            trigger_keyword: trigger_default(),
            message_interval: i_message(),
            reply_delay: i_reply(),
            reply_cooldown: i_cooldown(),
            afk_interval: i_afk(),
            reconnect_delay: i_reconnect(),
            transfer_wait: i_transfer_wait(),
            inattivita_timeout: i_inactivity(),
            proxy: String::new(),
            proxies: Vec::new(),
            test_proxies: true,
            require_proxy: false,
            stealth: stealth_default(),
            ai_enabled: false,
            ai_api_key: String::new(),
            ai_model: String::new(),
            ai_prompt: String::new(),
            ai_user_overrides: Vec::new(),
        }
    }
}

impl Config {
    pub fn load_or_create(path: &Path) -> anyhow::Result<Option<Config>> {
        if !path.exists() {
            let def = Config::default();
            std::fs::write(path, serde_json::to_string_pretty(&def)?)?;
            return Ok(None);
        }
        let raw = std::fs::read_to_string(path)?;
        Ok(Some(serde_json::from_str(&raw)?))
    }

    pub fn proxy_for(&self, account: &AccountCfg, index: usize) -> Option<String> {
        // A per-account fixed proxy always wins and is never rotated.
        if let Some(p) = &account.proxy {
            if !p.is_empty() {
                return Some(p.clone());
            }
        }
        if !self.proxies.is_empty() {
            let p = &self.proxies[index % self.proxies.len()];
            if !p.is_empty() {
                return Some(p.clone());
            }
        }
        if !self.proxy.is_empty() {
            return Some(self.proxy.clone());
        }
        None
    }

    /// True when this account is pinned to a single fixed proxy that must not
    /// be rotated away from.
    pub fn account_has_fixed_proxy(&self, account: &AccountCfg) -> bool {
        account.proxy.as_ref().map(|p| !p.is_empty()).unwrap_or(false)
    }

    /// Pick a proxy from the rotating pool using an explicit rotation counter.
    /// Used to obtain a *fresh exit IP* when the server keeps kicking us with
    /// "Transferring region" (an IP-based throttle): reconnecting from the same
    /// IP just earns the same kick, so we step to the next proxy in the pool.
    /// Returns None when there is no usable pool (single/no proxy) so the caller
    /// can fall back to a plain wait-and-retry.
    pub fn proxy_rotated(&self, account: &AccountCfg, rotation: usize) -> Option<String> {
        if self.account_has_fixed_proxy(account) {
            return None;
        }
        if self.proxies.len() > 1 {
            let p = &self.proxies[rotation % self.proxies.len()];
            if !p.is_empty() {
                return Some(p.clone());
            }
        }
        None
    }
}
