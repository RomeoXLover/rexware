use azalea::JoinOpts;
use std::net::ToSocketAddrs;
use std::time::{Duration, Instant};
use tokio::time::timeout;
use tokio_socks::tcp::Socks5Stream;

pub fn parse(raw: &str) -> Option<(String, u16, Option<(String, String)>)> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("socks5://{raw}")
    };
    let rest = with_scheme.splitn(2, "://").nth(1)?;

    let (creds, hostport) = match rest.rsplit_once('@') {
        Some((c, hp)) => (Some(c), hp),
        None => (None, rest),
    };

    let (host, port) = hostport.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;

    let auth = creds.and_then(|c| {
        c.split_once(':')
            .map(|(u, p)| (u.to_string(), p.to_string()))
    });

    Some((host.to_string(), port, auth))
}

pub fn build_join_opts(raw: &str) -> JoinOpts {
    let opts = JoinOpts::default();
    let Some((host, port, auth)) = parse(raw) else {
        return opts;
    };

    let addr = match (host.as_str(), port).to_socket_addrs() {
        Ok(mut it) => match it.next() {
            Some(a) => a,
            None => return opts,
        },
        Err(_) => return opts,
    };

    let user_key = auth.map(|(u, p)| {
        socks5_impl::protocol::handshake::password_method::UserKey::new(u, p)
    });
    let proxy = azalea::protocol::connect::Proxy::new(addr, user_key);
    opts.proxy(proxy)
}

#[derive(Debug, Clone)]
pub struct ProxyTest {
    pub tcp_ok: bool,
    pub latency_ms: u128,
    pub exit_ip: Option<String>,
}

pub async fn test(raw: &str, target_host: &str, target_port: u16) -> anyhow::Result<ProxyTest> {
    let Some((host, port, auth)) = parse(raw) else {
        anyhow::bail!("invalid proxy format");
    };
    let proxy_addr = format!("{host}:{port}");
    let target = format!("{target_host}:{target_port}");

    let started = Instant::now();
    let connect = async {
        match &auth {
            Some((u, p)) => {
                Socks5Stream::connect_with_password(
                    proxy_addr.as_str(),
                    target.as_str(),
                    u.as_str(),
                    p.as_str(),
                )
                .await
            }
            None => Socks5Stream::connect(proxy_addr.as_str(), target.as_str()).await,
        }
    };

    let tcp_ok = match timeout(Duration::from_secs(10), connect).await {
        Ok(Ok(_stream)) => true,
        Ok(Err(e)) => anyhow::bail!("SOCKS5 connection failed: {e}"),
        Err(_) => anyhow::bail!("proxy connection timeout"),
    };
    let latency_ms = started.elapsed().as_millis();
    let exit_ip = exit_ip(raw).await.ok();

    Ok(ProxyTest {
        tcp_ok,
        latency_ms,
        exit_ip,
    })
}

async fn exit_ip(raw: &str) -> anyhow::Result<String> {
    let url = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("socks5://{raw}")
    };
    let proxy = reqwest::Proxy::all(&url)?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .build()?;
    let ip = client
        .get("https://api.ipify.org")
        .timeout(Duration::from_secs(10))
        .send()
        .await?
        .text()
        .await?;
    Ok(ip.trim().to_string())
}
