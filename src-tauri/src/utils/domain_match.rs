/// 域名/URL 通配符匹配：pattern 支持 `*`（匹配任意字节序列）和 `?`（匹配任意单个字符）。
/// pattern 为空字符串时匹配所有。
/// 大小写不敏感（匹配前两端 lowercase）。也支持含路径的 pattern，如 `*.example.com/api/*`。
///
use rama::utils::thirdparty::wildcard;
pub fn domain_match(pattern: &str, host: &str) -> bool {
    if pattern.is_empty() {
        return true;
    }
    let p = pattern.to_lowercase();
    let h = host.to_lowercase();
    wildcard::Wildcard::new(p.as_bytes())
        .map(|wc| wc.is_match(h.as_bytes()))
        .unwrap_or(false)
}

/// 从用户输入的 URL 提取匹配候选串，供规则命中测试使用：
/// - match_path=false → 仅 host（TLS 白名单 / 脚本运行时语义）
/// - match_path=true  → host + path（与 compute_ai_hint 的候选串构造一致）
///
/// 输入容忍缺 scheme（自动补 https://）；解析失败返回 None。
pub fn url_candidate(url: &str, match_path: bool) -> Option<String> {
    let input = url.trim();
    if input.is_empty() {
        return None;
    }
    // 用户输入常省略 scheme，补 https:// 统一解析
    let normalized = if input.contains("://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let uri: rama::net::uri::Uri = normalized.parse().ok()?;
    let host = uri.host_str()?;
    Some(if match_path {
        format!("{host}{}", uri.path_or_root())
    } else {
        host.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_candidate_host_only() {
        // 完整 URL：剥 scheme / 路径 / query
        assert_eq!(
            url_candidate("https://api.openai.com/v1/chat?stream=true", false).as_deref(),
            Some("api.openai.com")
        );
        // 缺 scheme 的随手输入
        assert_eq!(
            url_candidate("api.openai.com/v1/chat", false).as_deref(),
            Some("api.openai.com")
        );
        // 端口剥离（SNI / 运行时 host 均不带端口）
        assert_eq!(
            url_candidate("my-gw.local:8080/v1", false).as_deref(),
            Some("my-gw.local")
        );
    }

    #[test]
    fn url_candidate_host_and_path() {
        assert_eq!(
            url_candidate("https://api.openai.com/v1/chat?stream=true", true).as_deref(),
            Some("api.openai.com/v1/chat")
        );
        // 裸域名 → path_or_root 补 "/"，与 compute_ai_hint 运行时一致
        assert_eq!(
            url_candidate("api.openai.com", true).as_deref(),
            Some("api.openai.com/")
        );
    }

    #[test]
    fn url_candidate_invalid() {
        assert_eq!(url_candidate("", false), None);
        assert_eq!(url_candidate("   ", false), None);
        assert_eq!(url_candidate("://", false), None);
    }
}
