pub fn is_allowed_origin(origin: &str, allowed: &[String]) -> bool {
    if origin.is_empty() || origin == "null" {
        return false;
    }
    let Ok(u) = url::Url::parse(origin) else {
        return false;
    };
    if !matches!(u.scheme(), "http" | "https") {
        return false;
    }
    match u.host_str() {
        Some("localhost" | "127.0.0.1" | "::1" | "[::1]") => return true,
        Some(_) => {}
        None => return false,
    }
    let norm = origin.trim_end_matches('/');
    allowed
        .iter()
        .any(|a| a.trim_end_matches('/').eq_ignore_ascii_case(norm))
}

/// Extract "scheme://host[:port]" from a Referer URL, for fallback checks.
pub fn origin_from_referer(referer: &str) -> Option<String> {
    let u = url::Url::parse(referer).ok()?;
    if !matches!(u.scheme(), "http" | "https") {
        return None;
    }
    let host = u.host_str()?;
    let origin = match u.port() {
        Some(p) => format!("{}://{}:{}", u.scheme(), host, p),
        None => format!("{}://{}", u.scheme(), host),
    };
    Some(origin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_allowed_any_port() {
        assert!(is_allowed_origin("http://localhost:3030", &[]));
        assert!(is_allowed_origin("http://127.0.0.1:8080", &[]));
        assert!(is_allowed_origin("http://[::1]:9000", &[]));
    }

    #[test]
    fn other_host_rejected_unless_allowed() {
        assert!(!is_allowed_origin("http://evil.com", &[]));
        assert!(is_allowed_origin(
            "https://ok.example.com",
            &["https://ok.example.com".into()]
        ));
    }

    #[test]
    fn null_origin_rejected() {
        assert!(!is_allowed_origin("null", &[]));
        assert!(!is_allowed_origin("", &[]));
    }

    #[test]
    fn substring_attack_rejected() {
        assert!(!is_allowed_origin("http://localhost.evil.com", &[]));
    }

    #[test]
    fn exotic_scheme_rejected() {
        assert!(!is_allowed_origin("ftp://localhost", &[]));
        assert!(!is_allowed_origin("file:///etc/passwd", &[]));
    }
}
