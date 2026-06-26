use azalea::prelude::*;

use crate::config::{AccountCfg, Config};
use crate::log::{RED, YELLOW};
use crate::logln;

pub async fn build(cfg: &Config, account: &AccountCfg) -> anyhow::Result<Account> {
    let mode = account.resolved_auth_mode(&cfg.auth_mode);
    match mode.as_str() {
        "offline" => {
            logln!(YELLOW, "[AUTH] Offline mode: {}", account.your_username);
            Ok(Account::offline(&account.username))
        }
        "microsoft" | "msa" | "" => build_microsoft(cfg, account).await,
        "token" | "access_token" => build_token(account),
        "ssid" | "session" => build_ssid(account).await,
        other => Err(anyhow::anyhow!("auth_mode sconosciuta: {other}")),
    }
}

/// Login Microsoft (MSA) con cache su disco.
///
/// Usiamo `azalea_auth::auth` invece di `Account::microsoft` perche' ci permette
/// di scegliere DOVE salvare la cache (`cfg.auth_cache`). La cache di default di
/// azalea sta in `~/.minecraft/azalea-auth.json`, che pero' dentro un container
/// effimero NON viene persistito: il bot rifarebbe il login a ogni riavvio.
/// Salvandola nella working dir (persistita) i profili MSA restano salvati e il
/// login interattivo serve UNA sola volta per account.
///
/// In piu' lo username in-game lo prendiamo dal profilo restituito dal login:
/// l'utente NON deve piu' scriverlo a mano nella config.
async fn build_microsoft(cfg: &Config, account: &AccountCfg) -> anyhow::Result<Account> {
    logln!(YELLOW, "[AUTH] Microsoft mode: {}", account.username);

    let cache_file = {
        let raw = cfg.auth_cache.trim();
        if raw.is_empty() {
            None
        } else {
            // Path relativo -> risolto sulla working dir (persistita), cosi' la
            // cache sopravvive ai riavvii del container.
            let p = std::path::Path::new(raw);
            if p.is_absolute() {
                Some(p.to_path_buf())
            } else {
                Some(
                    std::env::current_dir()
                        .unwrap_or_else(|_| std::path::PathBuf::from("."))
                        .join(p),
                )
            }
        }
    };

    if let Some(p) = &cache_file {
        logln!(YELLOW, "[AUTH] Using auth cache: {}", p.display());
    }

    // La cache key e' un identificatore arbitrario per ritrovare l'account nella
    // cache: usiamo l'email/username della config.
    let result = azalea_auth::auth(
        &account.username,
        azalea_auth::AuthOpts {
            cache_file,
            ..Default::default()
        },
    )
    .await
    .map_err(|e| anyhow::anyhow!("Microsoft auth failed: {e}"))?;

    let name = result.profile.name.clone();
    let uuid = result.profile.id;
    logln!(YELLOW, "[AUTH] Microsoft OK: {name} ({uuid})");

    Ok(Account {
        username: name,
        access_token: Some(std::sync::Arc::new(parking_lot::Mutex::new(
            result.access_token,
        ))),
        uuid: Some(uuid),
        account_opts: azalea::AccountOpts::Microsoft {
            email: account.username.clone(),
        },
        certs: std::sync::Arc::new(parking_lot::Mutex::new(None)),
    })
}

fn build_token(account: &AccountCfg) -> anyhow::Result<Account> {
    let token = account
        .access_token
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("auth_mode=token richiede 'access_token'"))?;
    let uuid_str = account
        .uuid
        .clone()
        .ok_or_else(|| anyhow::anyhow!("auth_mode=token richiede 'uuid'"))?;
    let uuid = uuid::Uuid::parse_str(&uuid_str)
        .map_err(|e| anyhow::anyhow!("invalid uuid: {e}"))?;

    logln!(YELLOW, "[AUTH] Token mode: {}", account.your_username);

    Ok(Account {
        username: account.username.clone(),
        access_token: Some(std::sync::Arc::new(parking_lot::Mutex::new(token))),
        uuid: Some(uuid),
        account_opts: azalea::AccountOpts::Microsoft {
            email: account.username.clone(),
        },
        certs: std::sync::Arc::new(parking_lot::Mutex::new(None)),
    })
}

// client_id pubblico del launcher ufficiale di Minecraft.
const MC_CLIENT_ID: &str = "00000000402b5328";
const MC_REDIRECT: &str = "https://login.live.com/oauth20_desktop.srf";
const MC_SCOPE: &str = "service::user.auth.xboxlive.com::MBI_SSL";

/// Autentica tramite SSID.
///
/// Il campo `ssid` in `feather_config.json` puo' contenere:
///   1. un MINECRAFT ACCESS TOKEN (JWT, inizia con "eyJ") -> e' gia' il token
///      finale: lo usiamo direttamente, niente scambio Xbox/MSA;
///   2. un ACCESS TOKEN MSA (inizia con "EwA") -> scambiato con la catena
///      Xbox -> Minecraft;
///   3. un COOKIE di sessione Microsoft -> scambiato prima in access token MSA
///      e poi nella catena Xbox -> Minecraft.
async fn build_ssid(account: &AccountCfg) -> anyhow::Result<Account> {
    let ssid = account
        .ssid
        .clone()
        .filter(|s| !s.is_empty())
        .map(|s| s.split_whitespace().collect::<String>()) // rimuove eventuali spazi
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!("auth_mode=ssid requires the 'ssid' field (token or cookie)")
        })?;

    logln!(YELLOW, "[AUTH] SSID mode: {}", account.your_username);

    // reqwest senza redirect automatici: ci serve leggere il Location del 302.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;

    // CASO 1: il valore e' gia' un Minecraft access token (JWT). E' il caso
    // tipico dei tool di estrazione SSID: il token contiene gia' profilo e
    // UUID, quindi saltiamo del tutto lo scambio Xbox/MSA che altrimenti
    // fallirebbe (il JWT non e' un RpsTicket valido per Xbox Live).
    if ssid.starts_with("eyJ") {
        logln!(YELLOW, "[AUTH] 'ssid' recognized as a Minecraft access token (JWT).");
        return build_from_minecraft_token(&client, account, ssid).await;
    }

    // CASO 2/3: access token MSA oppure cookie da scambiare.
    let msa_token = if ssid.starts_with("EwA") {
        logln!(YELLOW, "[AUTH] 'ssid' interpreted as an MSA access token.");
        ssid.clone()
    } else {
        logln!(YELLOW, "[AUTH] Exchanging SSID cookie -> MSA access token...");
        exchange_ssid_cookie(&client, &ssid).await?
    };

    logln!(YELLOW, "[AUTH] Exchanging access token -> Minecraft token...");

    // L'endpoint XBL richiede il prefisso "d=" per i token di app custom.
    let msa_token_prefixed = if msa_token.starts_with("d=") {
        msa_token.clone()
    } else {
        format!("d={msa_token}")
    };

    let mc_token_resp = azalea_auth::get_minecraft_token(&client, &msa_token_prefixed)
        .await
        .map_err(|e| anyhow::anyhow!("MSA->Minecraft token exchange failed: {e}"))?;

    build_from_minecraft_token(&client, account, mc_token_resp.minecraft_access_token).await
}

/// Costruisce l'Account partendo da un Minecraft access token gia' valido.
/// Recupera il profilo (nome + UUID) dall'API Minecraft; se la chiamata di rete
/// fallisce, prova a leggere il profilo direttamente dal payload del JWT.
async fn build_from_minecraft_token(
    client: &reqwest::Client,
    account: &AccountCfg,
    minecraft_access_token: String,
) -> anyhow::Result<Account> {
    logln!(YELLOW, "[AUTH] Fetching Minecraft profile...");

    let (name, uuid) = match azalea_auth::get_profile(client, &minecraft_access_token).await {
        Ok(profile) => (profile.name, profile.id),
        Err(e) => {
            logln!(
                YELLOW,
                "[AUTH] get_profile failed ({e}), reading profile from token..."
            );
            profile_from_jwt(&minecraft_access_token)
                .ok_or_else(|| anyhow::anyhow!("unable to derive profile from token: {e}"))?
        }
    };

    logln!(YELLOW, "[AUTH] SSID OK: {name} ({uuid})");

    Ok(Account {
        username: name,
        access_token: Some(std::sync::Arc::new(parking_lot::Mutex::new(
            minecraft_access_token,
        ))),
        uuid: Some(uuid),
        account_opts: azalea::AccountOpts::Microsoft {
            email: account.username.clone(),
        },
        certs: std::sync::Arc::new(parking_lot::Mutex::new(None)),
    })
}

/// Estrae (nome, UUID) dal payload di un Minecraft access token JWT.
/// Il payload contiene `pfd: [{ id, name }]` con l'UUID del profilo (senza
/// trattini) e il nome utente.
fn profile_from_jwt(token: &str) -> Option<(String, uuid::Uuid)> {
    let payload_b64 = token.split('.').nth(1)?;
    let bytes = base64_url_decode(payload_b64)?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;

    let entry = json.get("pfd")?.as_array()?.first()?;
    let name = entry.get("name")?.as_str()?.to_string();
    let id_raw = entry.get("id")?.as_str()?;
    let uuid = uuid::Uuid::parse_str(id_raw).ok()?;
    Some((name, uuid))
}

/// Decodifica base64url (senza padding) come usato nei JWT.
/// Implementazione manuale per non aggiungere dipendenze al grafo crypto.
fn base64_url_decode(input: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'-' => Some(62),
            b'_' => Some(63),
            _ => None,
        }
    }

    let chars: Vec<u8> = input
        .bytes()
        .filter(|&c| c != b'=' && !c.is_ascii_whitespace())
        .collect();

    let mut out = Vec::with_capacity(chars.len() * 3 / 4);
    for chunk in chars.chunks(4) {
        let mut buf = [0u8; 4];
        let mut n = 0;
        for (i, &c) in chunk.iter().enumerate() {
            buf[i] = val(c)?;
            n += 1;
        }
        if n >= 2 {
            out.push((buf[0] << 2) | (buf[1] >> 4));
        }
        if n >= 3 {
            out.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if n == 4 {
            out.push((buf[2] << 6) | buf[3]);
        }
    }
    Some(out)
}

/// Scambia un cookie di sessione Microsoft (SSID) per un access token MSA.
///
/// Chiama l'endpoint OAuth implicit (`response_type=token`) inviando il cookie
/// di autenticazione. Se il cookie e' valido, Microsoft risponde con un 302 il
/// cui header `Location` contiene `#access_token=...` nel fragment.
async fn exchange_ssid_cookie(
    client: &reqwest::Client,
    ssid: &str,
) -> anyhow::Result<String> {
    let authorize_url = format!(
        "https://login.live.com/oauth20_authorize.srf\
         ?client_id={MC_CLIENT_ID}\
         &redirect_uri={MC_REDIRECT}\
         &scope={MC_SCOPE}\
         &response_type=token\
         &prompt=none"
    );

    // Il cookie puo' essere fornito come valore puro oppure come "NOME=valore".
    // Microsoft usa il cookie "__Host-MSAAUTH" / "MSPOK" a seconda del flusso;
    // accettiamo entrambe le forme: se contiene '=' lo usiamo cosi' com'e',
    // altrimenti lo incapsuliamo nel cookie di sessione classico.
    let cookie_header = if ssid.contains('=') {
        ssid.to_string()
    } else {
        format!("__Host-MSAAUTH={ssid}")
    };

    let resp = client
        .get(&authorize_url)
        .header(reqwest::header::COOKIE, cookie_header)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("authorize request failed: {e}"))?;

    let status = resp.status();
    let location = resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let location = location.ok_or_else(|| {
        anyhow::anyhow!(
            "cookie SSID non valido o scaduto: nessun redirect (status {status}). \
             Verifica di aver copiato il cookie corretto e che non sia scaduto."
        )
    })?;

    // L'access token e' nel fragment: ...#access_token=XXXX&token_type=...
    let fragment = url::Url::parse(&location)
        .ok()
        .and_then(|u| u.fragment().map(|f| f.to_string()))
        .ok_or_else(|| {
            anyhow::anyhow!("redirect without fragment, SSID login failed: {location}")
        })?;

    let access_token = fragment
        .split('&')
        .find_map(|kv| kv.strip_prefix("access_token="))
        .map(|t| urlencoding_decode(t))
        .ok_or_else(|| {
            anyhow::anyhow!("access_token assente nel redirect SSID")
        })?;

    Ok(access_token)
}

/// Decodifica percent-encoding minimale (sufficiente per i token OAuth).
fn urlencoding_decode(s: &str) -> String {
    url::form_urlencoded::parse(format!("x={s}").as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| s.to_string())
}

pub fn log_unsupported(e: &anyhow::Error) {
    logln!(RED, "[AUTH] {e}");
}
