use axum::{body::Body, http::StatusCode, response::IntoResponse};
use serde::Deserialize;

#[derive(Deserialize)]
pub(super) struct ProxyQuery {
    url: String,
}

fn is_private_or_loopback_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                // 100.64.0.0/10 shared/CGNAT
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                // fc00::/7 unique local
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // fe80::/10 link local
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

pub(super) async fn proxy_request(
    axum::extract::Query(q): axum::extract::Query<ProxyQuery>,
    _req: axum::http::Request<Body>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Only allow http/https
    if !q.url.starts_with("http://") && !q.url.starts_with("https://") {
        return Err((
            StatusCode::BAD_REQUEST,
            "url must start with http:// or https://".to_string(),
        ));
    }

    // SSRF blocklist: reject private / loopback / link-local targets.
    // Applies when the host is a literal IP, or resolves to one.
    if let Ok(parsed) = url::Url::parse(&q.url) {
        let host = parsed
            .host_str()
            .ok_or((StatusCode::BAD_REQUEST, "missing host".to_string()))?;
        if let Ok(ip) = host.parse::<std::net::IpAddr>() {
            if is_private_or_loopback_ip(ip) {
                return Err((
                    StatusCode::FORBIDDEN,
                    "target address is private/loopback".to_string(),
                ));
            }
        } else {
            // Resolve and reject if any address maps to a private range.
            // Use port 0 as placeholder; we only care about IPs.
            let lookup_host = format!("{host}:0");
            match tokio::net::lookup_host(lookup_host).await {
                Ok(iter) => {
                    for addr in iter {
                        if is_private_or_loopback_ip(addr.ip()) {
                            return Err((
                                StatusCode::FORBIDDEN,
                                "target resolves to private/loopback address".to_string(),
                            ));
                        }
                    }
                }
                Err(e) => {
                    return Err((StatusCode::BAD_GATEWAY, format!("dns lookup failed: {e}")));
                }
            }
        }
    } else {
        return Err((StatusCode::BAD_REQUEST, "invalid url".to_string()));
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("client error: {e}")))?;

    // Forward the request
    let upstream = client
        .get(&q.url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .header("Referer", &q.url)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("upstream error: {e}")))?;

    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    // Build response, stripping frame-blocking headers
    let mut headers = axum::http::HeaderMap::new();
    for (name, value) in upstream.headers() {
        let name_lower = name.as_str().to_lowercase();
        // Strip headers that block iframe embedding
        if name_lower == "x-frame-options"
            || name_lower == "content-security-policy"
            || name_lower == "content-security-policy-report-only"
        {
            continue;
        }
        headers.insert(name.clone(), value.clone());
    }

    let body = upstream
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("read body: {e}")))?;

    Ok((status, headers, body))
}
