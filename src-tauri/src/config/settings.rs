use crate::utils::domain_match;
use log::info;
use rama::error::{BoxError, ErrorContext};
use rama::net::address::ProxyAddress;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::path::PathBuf;

const CONFIG_FILE_NAME: &str = "setting.json";

/// SSL 解密白名单项
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SslWhitelistItem {
    pub domain: String,
    #[serde(default)]
    pub enabled: bool,
}

/// SSL 解密配置
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct SslConfig {
    /// 全局 SSL 解密开关
    #[serde(default)]
    pub enabled: bool,
    /// 域名白名单，每项可单独开关
    #[serde(default)]
    pub whitelist: Vec<SslWhitelistItem>,
}

impl SslConfig {
    /// host 是否命中已启用的 MITM 解密白名单。
    /// 总开关关闭时恒为 false，不再迭代白名单。
    pub fn should_mitm(&self, host: &str) -> bool {
        self.enabled
            && self
                .whitelist
                .iter()
                .any(|item| item.enabled && domain_match::domain_match(&item.domain, host))
    }
}

/// 脚本配置项
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ScriptItem {
    #[serde(default)]
    pub name: String,
    /// 域名匹配规则（支持 * 通配符，如 *.example.com）
    #[serde(default)]
    pub domain: String,
    /// HTTP 方法匹配（大写，如 "GET"）；空串 = any，匹配所有方法
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub enabled: bool,
    /// 脚本文件名（name + ".js" 的 SHA256 前 16 位，后端在保存时自动生成）
    #[serde(default)]
    pub file_name: String,
}

impl ScriptItem {
    /// 该脚本是否对指定 host + method 生效：已启用、有脚本文件、域名与方法均命中。
    /// method 规则为空串 = any；比较大小写不敏感。
    pub fn matches(&self, host: &str, method: &str) -> bool {
        self.enabled
            && !self.file_name.is_empty()
            && domain_match::domain_match(&self.domain, host)
            && (self.method.is_empty() || self.method.eq_ignore_ascii_case(method))
    }
}

/// 脚本配置
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ScriptConfig {
    /// 全局脚本开关
    #[serde(default)]
    pub enabled: bool,
    /// 脚本列表，每项可单独开关
    #[serde(default)]
    pub scripts: Vec<ScriptItem>,
}

/// AI 厂商标识。用于 URL 规则匹配和前端展示。
/// 序列化为小写：`"openai"` / `"openai-responses"` / `"anthropic"` / `"gemini"`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    OpenAI,
    #[serde(rename = "openai-responses")]
    OpenAIResponses,
    Anthropic,
    Gemini,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AiDetectionConfig {
    /// URL glob 规则列表，首条命中即止。
    /// 缺省（配置里无此段）时用内置默认规则播种；显式空数组则尊重用户清空。
    #[serde(default = "default_ai_url_rules")]
    pub url_patterns: Vec<AiUrlRule>,
}

impl Default for AiDetectionConfig {
    fn default() -> Self {
        Self {
            url_patterns: default_ai_url_rules(),
        }
    }
}

impl AiDetectionConfig {
    /// 遍历 url_patterns，首条 domain_match 命中即止。
    /// 候选串 = host + path（host 由调用方通过 ctx.host_str() 统一获取，已含 Host 头回退）。
    /// 返回 (Option<AiProvider>, 命中规则的来源对列表)；未命中为 (None, 空)。
    pub fn compute_hint(&self, host: &str, path: &str) -> (Option<AiProvider>, Vec<AiRuleSource>) {
        let candidate = format!("{host}{path}");
        for rule in &self.url_patterns {
            if rule.url.is_empty() || !rule.enabled {
                continue;
            }
            if domain_match::domain_match(&rule.url, &candidate) {
                return (rule.provider, rule.sources.clone());
            }
        }
        (None, Vec::new())
    }
}

/// 规则内的来源条目：来源名与其会话合并 header 成对。
/// 运行时按序尝试各来源的 merge_header（优先于全局名单），命中即确认该会话的来源。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AiRuleSource {
    /// 来源名（客户端名，如 "Claude Code"）
    #[serde(default)]
    pub name: String,
    /// 该来源的会话合并 header；空白 = 仅标注，不参与分组
    #[serde(default)]
    pub merge_header: String,
}

/// 单条 AI URL 规则
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AiUrlRule {
    /// URL glob，候选串为 host + path（已剥 scheme/query/默认端口）
    #[serde(default)]
    pub url: String,
    /// 命中的 AI 厂商；None → Candidate
    #[serde(default)]
    pub provider: Option<AiProvider>,
    /// 该条规则是否启用，缺省视为启用（兼容旧配置）
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// (来源, 合并头) 对列表。合并头按序参与会话分组（优先于全局），命中即确认来源。
    #[serde(default)]
    pub sources: Vec<AiRuleSource>,
}

/// AI 配置根
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct AiConfig {
    /// AI 检测总开关。关闭时后端完全不做 AI 检测/归一化/推送事件。
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub detection: AiDetectionConfig,
    #[serde(default)]
    pub session: AiSessionConfig,
}

/// AI 会话分组配置
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AiSessionConfig {
    /// 会话标识请求头名单，按顺序取第一个命中的 header 值作为会话标识。
    /// 不写死在分组逻辑中，用户可增删。
    #[serde(default = "default_session_headers")]
    pub session_headers: Vec<String>,
    /// 无 session header 时是否启用消息前缀匹配兜底。
    #[serde(default = "default_true")]
    pub prefix_match_fallback: bool,
    /// 内存会话表上限，超过后按 LRU 淘汰。
    #[serde(default = "default_session_max")]
    pub max_sessions: usize,
}

fn default_session_headers() -> Vec<String> {
    vec![
        "x-claude-code-session-id".to_string(),
        "x-session-id".to_string(),
    ]
}

fn default_session_max() -> usize {
    500
}

impl Default for AiSessionConfig {
    fn default() -> Self {
        Self {
            session_headers: default_session_headers(),
            prefix_match_fallback: true,
            max_sessions: default_session_max(),
        }
    }
}

/// 内置默认 URL 规则（OpenAI/Anthropic 官方 + DeepSeek/Azure/OpenRouter 常见），
/// 作为初始种子写入配置；之后用户可自由增删/启用停用，全部以配置文件为准。
pub(crate) fn default_ai_url_rules() -> Vec<AiUrlRule> {
    vec![
        AiUrlRule {
            url: "api.openai.com/v1/chat/completions".into(),
            provider: Some(AiProvider::OpenAI),
            enabled: true,
            sources: Vec::new(),
        },
        AiUrlRule {
            url: "api.openai.com/v1/responses".into(),
            provider: Some(AiProvider::OpenAIResponses),
            enabled: true,
            sources: Vec::new(),
        },
        AiUrlRule {
            url: "api.anthropic.com/v1/messages".into(),
            provider: Some(AiProvider::Anthropic),
            enabled: true,
            sources: Vec::new(),
        },
        AiUrlRule {
            url: "api.deepseek.com/v1/chat/completions".into(),
            provider: Some(AiProvider::OpenAI),
            enabled: true,
            sources: Vec::new(),
        },
        AiUrlRule {
            url: "*.openai.azure.com/openai/deployments/*/chat/completions".into(),
            provider: Some(AiProvider::OpenAI),
            enabled: true,
            sources: Vec::new(),
        },
        AiUrlRule {
            url: "openrouter.ai/api/v1/chat/completions".into(),
            provider: None,
            enabled: true,
            sources: Vec::new(),
        },
        AiUrlRule {
            url: "generativelanguage.googleapis.com/v1beta/models/*".into(),
            provider: Some(AiProvider::Gemini),
            enabled: true,
            sources: Vec::new(),
        },
        AiUrlRule {
            url: "generativelanguage.googleapis.com/v1alpha/models/*".into(),
            provider: Some(AiProvider::Gemini),
            enabled: true,
            sources: Vec::new(),
        },
    ]
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProxyConfig {
    /// 监听地址（如 "127.0.0.1"）
    #[serde(default)]
    pub listen_host: String,
    /// 监听端口
    #[serde(default)]
    pub listen_port: u16,
    /// 上游代理开关。关闭时忽略下面的地址/端口，请求直连；
    /// 用于临时停用而不必清空已填好的地址。
    #[serde(default = "default_true")]
    pub upstream_proxy_enabled: bool,
    /// 上游代理地址（IP 或域名），留空表示不使用上游代理，请求直连
    #[serde(default)]
    pub upstream_proxy_host: String,
    /// 上游代理端口
    #[serde(default)]
    pub upstream_proxy_port: u16,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            listen_host: "127.0.0.1".to_string(),
            listen_port: 5201,
            upstream_proxy_enabled: true,
            upstream_proxy_host: String::new(),
            upstream_proxy_port: 0,
        }
    }
}

impl ProxyConfig {
    /// 解析上游代理地址，供 `ProxyAddressLayer` 使用。
    ///
    /// 开关关闭或地址为空 → `None`（直连）。地址非法 → 记录警告后同样返回 `None`，
    /// 回落直连而不是让每个请求都失败。
    ///
    /// 地址框以裸主机名/IP 为主，但也容忍用户整段粘贴：
    /// 带 scheme（`http://`、`https://`）时沿用该 scheme，否则按 `http://` 处理；
    /// 地址里已自带端口时以其为准，忽略端口框。
    pub fn upstream_proxy_address(&self) -> Option<ProxyAddress> {
        if !self.upstream_proxy_enabled {
            return None;
        }
        let raw = self.upstream_proxy_host.trim();
        if raw.is_empty() {
            return None;
        }

        let (scheme, rest) = raw.split_once("://").unwrap_or(("http", raw));
        let rest = rest.trim_end_matches('/');
        // 判断是否自带端口：先剥掉 `user:pass@` 凭据，再排除 IPv6 字面量
        // `[::1]` 内部的冒号，只认 `]` 之后的 `:port`。
        let host_part = rest.rsplit_once('@').map_or(rest, |(_, host)| host);
        let has_port = match host_part.rsplit_once(']') {
            Some((_, tail)) => tail.starts_with(':'),
            None => host_part.contains(':'),
        };

        let candidate = if has_port {
            format!("{scheme}://{rest}")
        } else if self.upstream_proxy_port == 0 {
            info!("上游代理端口未配置，忽略上游代理地址 {raw}");
            return None;
        } else {
            format!("{scheme}://{rest}:{}", self.upstream_proxy_port)
        };

        match ProxyAddress::try_from(candidate.as_str()) {
            Ok(addr) => Some(addr),
            Err(err) => {
                info!("上游代理地址 {candidate} 解析失败，回落直连: {err}");
                None
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LogConfig {
    /// 日志级别：trace / debug / info / warn / error
    #[serde(default = "default_level")]
    pub level: String,
    /// 日志存储目录，默认在 data_dir/logs 下
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
    /// 是否输出到控制台
    #[serde(default = "default_true")]
    pub console: bool,
    /// 单个日志文件最大大小（字节），超过后滚动，默认 1GB
    #[serde(default = "default_max_file_size")]
    pub max_file_size: u128,
    /// 日志滚动策略：KeepAll 保留所有 / KeepOne 只保留最新
    #[serde(default = "default_rotation_strategy")]
    pub rotation_strategy: String,
}

fn default_level() -> String {
    "info".to_string()
}

fn default_max_file_size() -> u128 {
    1024 * 1024 * 1024 // 1GB
}

fn default_rotation_strategy() -> String {
    "KeepAll".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            level: default_level(),
            dir: None,
            console: true,
            max_file_size: default_max_file_size(),
            rotation_strategy: default_rotation_strategy(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UiConfig {
    /// 主题模式: "light" / "dark" / "system"
    #[serde(default = "default_theme")]
    pub theme: String,
    /// 界面语言: "en" / "zh" / "system"
    #[serde(default = "default_language")]
    pub language: String,
    /// 内容字号档位: "small" / "normal" / "large"（仅影响数据内容区，不影响 UI 骨架）
    #[serde(default = "default_prose_font_size")]
    pub prose_font_size: String,
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_language() -> String {
    "system".to_string()
}

fn default_prose_font_size() -> String {
    "normal".to_string()
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            language: default_language(),
            prose_font_size: default_prose_font_size(),
        }
    }
}

impl UiConfig {
    pub fn tray_locale(&self) -> &str {
        if self.language == "zh" { "zh" } else { "en" }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Settings {
    /// 代理配置
    #[serde(default)]
    pub proxy: ProxyConfig,
    /// SSL 解密配置
    #[serde(default)]
    pub ssl: SslConfig,
    /// 脚本配置
    #[serde(default)]
    pub script: ScriptConfig,
    /// 日志配置
    #[serde(default)]
    pub log: LogConfig,
    /// UI 配置
    #[serde(default)]
    pub ui: UiConfig,
    /// AI 流量检测配置
    #[serde(default)]
    pub ai: AiConfig,
    #[serde(default)]
    pub persistence: Option<bool>,
    /// 数据保留天数（0 = 永久保留），默认 30 天
    #[serde(default = "default_retention_days")]
    pub retention_days: u32,
}

fn default_retention_days() -> u32 {
    30
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            proxy: ProxyConfig::default(),
            ssl: SslConfig::default(),
            script: ScriptConfig::default(),
            log: LogConfig::default(),
            ui: UiConfig::default(),
            ai: AiConfig::default(),
            persistence: Some(false),
            retention_days: default_retention_days(),
        }
    }
}

impl Settings {
    /// Load config from data_dir/setting.json.
    /// Creates the file with defaults if it doesn't exist.
    pub(crate) fn load_from_path(dir: &Path) -> Result<Settings, BoxError> {
        let config_path = dir.join(CONFIG_FILE_NAME);

        if !config_path.exists() {
            let default = Settings::default();
            let content = serde_json::to_string_pretty(&default)
                .context("Failed to serialize default settings")?;
            std::fs::write(&config_path, content).context("Failed to write default config file")?;
            info!("Created default config at {}", config_path.display());
        }

        info!("Loading configuration from {}", config_path.display());
        let content =
            std::fs::read_to_string(&config_path).context("Failed to read config file")?;
        let mut settings: Settings = serde_json::from_str(&content).context("json parse error")?;
        settings.resolve_log_dir(dir);
        info!("Configuration loaded successfully");
        Ok(settings)
    }

    pub(crate) fn save_to_path(&self, dir: &Path) -> Result<(), BoxError> {
        let config_path = dir.join(CONFIG_FILE_NAME);
        let content = serde_json::to_string_pretty(self).context("Failed to serialize settings")?;
        std::fs::write(&config_path, content).context("Failed to write config file")?;
        info!("Configuration saved to {}", config_path.display());
        Ok(())
    }

    fn resolve_log_dir(&mut self, data_dir: &Path) {
        let resolved: PathBuf = match &self.log.dir {
            None => data_dir.join("logs"),
            Some(dir) => {
                let path = Path::new(dir);
                if !path.is_absolute() {
                    data_dir.join(path)
                } else {
                    path.to_path_buf()
                }
            }
        };
        self.log.dir = Some(resolved.to_string_lossy().into_owned());
        std::fs::create_dir_all(&resolved).unwrap_or_else(|e| {
            log::error!(
                "Failed to create log directory {}: {}",
                resolved.display(),
                e
            );
        });
    }
}

/// 从 AI 规则 URL 提取域名部分（首个 `/` 之前）。
fn ai_rule_host(url: &str) -> &str {
    url.split('/').next().unwrap_or("")
}

/// AI 检测依赖 MITM 解密：启用 AI 检测时联动 SSL 配置——打开总开关，
/// 并确保每条启用规则的域名被已启用的白名单项覆盖：
/// 已有同名项则启用之；被已启用的通配项覆盖则跳过；否则追加新项。
/// AI 检测未启用时不做任何改动。
pub fn sync_ssl_for_ai(ssl: &mut SslConfig, ai: &AiConfig) {
    if !ai.enabled {
        return;
    }
    ssl.enabled = true;
    for rule in ai.detection.url_patterns.iter().filter(|r| r.enabled) {
        let host = ai_rule_host(rule.url.trim());
        if host.is_empty() {
            continue;
        }
        // 同名项（忽略大小写）→ 启用，不重复添加
        if let Some(item) = ssl
            .whitelist
            .iter_mut()
            .find(|w| w.domain.eq_ignore_ascii_case(host))
        {
            item.enabled = true;
            continue;
        }
        // 具体域名已被启用的通配项覆盖 → 跳过（host 自带通配符时无法判定覆盖，直接追加）
        let covered = !host.contains(['*', '?'])
            && ssl
                .whitelist
                .iter()
                .any(|w| w.enabled && domain_match::domain_match(&w.domain, host));
        if !covered {
            ssl.whitelist.push(SslWhitelistItem {
                domain: host.to_string(),
                enabled: true,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy_cfg(host: &str, port: u16) -> ProxyConfig {
        ProxyConfig {
            upstream_proxy_host: host.to_string(),
            upstream_proxy_port: port,
            ..Default::default()
        }
    }

    /// 地址留空 / 仅空白 / 端口为 0 都视为未配置，回落直连。
    #[test]
    fn upstream_proxy_unset_means_direct() {
        assert!(proxy_cfg("", 7890).upstream_proxy_address().is_none());
        assert!(proxy_cfg("   ", 7890).upstream_proxy_address().is_none());
        assert!(proxy_cfg("127.0.0.1", 0).upstream_proxy_address().is_none());
    }

    /// 开关关闭时忽略已填好的地址，回落直连（地址不必清空）。
    #[test]
    fn upstream_proxy_disabled_ignores_address() {
        let mut cfg = proxy_cfg("127.0.0.1", 7890);
        assert!(cfg.upstream_proxy_address().is_some());
        cfg.upstream_proxy_enabled = false;
        assert!(cfg.upstream_proxy_address().is_none());
    }

    /// 裸主机/IP + 端口框：按 http:// 组装。
    #[test]
    fn upstream_proxy_host_and_port() {
        let addr = proxy_cfg("127.0.0.1", 7890)
            .upstream_proxy_address()
            .expect("valid address");
        assert_eq!(addr.to_string(), "http://127.0.0.1:7890");

        let addr = proxy_cfg(" proxy.local ", 3128)
            .upstream_proxy_address()
            .expect("valid address");
        assert_eq!(addr.to_string(), "http://proxy.local:3128");
    }

    /// 整段粘贴时容错：scheme 沿用，地址自带端口则忽略端口框。
    #[test]
    fn upstream_proxy_accepts_pasted_forms() {
        for (host, port, expected) in [
            ("http://127.0.0.1:8888", 7890, "http://127.0.0.1:8888"),
            (
                "https://proxy.local:8443/",
                7890,
                "https://proxy.local:8443",
            ),
            ("127.0.0.1:8888", 7890, "http://127.0.0.1:8888"),
            ("[::1]:8888", 7890, "http://[::1]:8888"),
            // IPv6 字面量不带端口时仍取端口框，内部冒号不误判为端口
            ("[::1]", 7890, "http://[::1]:7890"),
            // 凭据里的冒号同样不误判为端口
            (
                "http://u:p@proxy.local",
                7890,
                "http://u:p@proxy.local:7890",
            ),
        ] {
            let addr = proxy_cfg(host, port)
                .upstream_proxy_address()
                .unwrap_or_else(|| panic!("{host} should parse"));
            assert_eq!(addr.to_string(), expected, "input: {host}");
        }
    }

    /// 非法地址回落直连，而不是让每个请求都失败。
    #[test]
    fn upstream_proxy_invalid_falls_back_to_direct() {
        assert!(
            proxy_cfg("http://", 7890)
                .upstream_proxy_address()
                .is_none()
        );
        assert!(
            proxy_cfg("127.0.0.1:notaport", 7890)
                .upstream_proxy_address()
                .is_none()
        );
    }
}
