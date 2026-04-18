use base64::Engine;
use rand::RngCore;
use subtle::ConstantTimeEq;

const TOKEN_BYTES: usize = 32;

pub fn generate_token() -> String {
    let mut buf = [0u8; TOKEN_BYTES];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

pub fn hash_token(token: &str) -> String {
    let hash = blake3::hash(token.as_bytes());
    format!("blake3:{}", hex::encode(hash.as_bytes()))
}

pub fn verify_token(token: &str, stored_hash: &str) -> bool {
    let Some(stored_hex) = stored_hash.strip_prefix("blake3:") else {
        return false;
    };
    let Ok(stored_bytes) = hex::decode(stored_hex) else {
        return false;
    };
    let candidate = blake3::hash(token.as_bytes());
    if stored_bytes.len() != candidate.as_bytes().len() {
        return false;
    }
    candidate.as_bytes().ct_eq(&stored_bytes).into()
}

#[allow(dead_code)]
pub fn redact_token(token: &str) -> String {
    if token.len() < 6 {
        "***".to_string()
    } else {
        format!("{}...", &token[..6])
    }
}
