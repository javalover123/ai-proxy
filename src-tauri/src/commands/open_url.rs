use rama::net::Protocol;
use rama::net::uri::Uri;
use tauri::command;

/// True when `url` is an absolute http(s) or mailto target with no CR/LF.
pub(crate) fn is_allowed_open_url(url: &str) -> bool {
    if url.bytes().any(|b| b == b'\n' || b == b'\r' || b == 0) {
        return false;
    }
    if is_mailto(url) {
        return true;
    }
    Uri::parse(url)
        .ok()
        .and_then(|u| u.scheme().cloned())
        .is_some_and(|s| s == Protocol::HTTP || s == Protocol::HTTPS)
}

fn is_mailto(url: &str) -> bool {
    let Some((scheme, _)) = url.split_once(':') else {
        return false;
    };
    scheme.eq_ignore_ascii_case("mailto")
}

/// 用系统默认处理器打开 URL（仅 http/https/mailto）
#[command]
pub fn open_url(url: &str) -> Result<(), String> {
    if !is_allowed_open_url(url) {
        return Err("URL scheme is not allowed".into());
    }
    open::that(url).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_http_https_mailto() {
        assert!(is_allowed_open_url("https://example.com/path"));
        assert!(is_allowed_open_url("http://example.com"));
        assert!(is_allowed_open_url("mailto:a@b.com"));
        assert!(is_allowed_open_url("MAILTO:a@b.com"));
    }

    #[test]
    fn rejects_dangerous_or_broken() {
        assert!(!is_allowed_open_url("javascript:alert(1)"));
        assert!(!is_allowed_open_url("file:///etc/passwd"));
        assert!(!is_allowed_open_url("mailto:a@b.com\nbcc:x@y.com"));
        assert!(!is_allowed_open_url(
            "https://example.com\nhttps://evil.test"
        ));
    }
}
