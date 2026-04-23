use axum::http::StatusCode;
use std::path::PathBuf;

/// Expand a leading `~` to `$HOME` (if present) and canonicalize the path.
/// Maps any filesystem error to a `(BAD_REQUEST, "invalid path: …")` tuple
/// suitable for returning directly from an axum handler.
pub(super) fn expand_and_canonicalize(raw: &str) -> Result<PathBuf, (StatusCode, String)> {
    let expanded = if let Some(rest) = raw.strip_prefix('~') {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        format!("{home}{rest}")
    } else {
        raw.to_string()
    };
    std::fs::canonicalize(&expanded)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid path: {e}")))
}
