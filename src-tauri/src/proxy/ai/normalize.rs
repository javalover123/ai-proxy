//! AI 对话的统一中间表示（IR）。
//! provider 无关，OpenAI / Anthropic 归一化后都产出这套结构。
//! serde `camelCase` 与前端 `src/types/ai.ts` 对齐，前端可直接消费。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 内容块：文本 / 思考 / 工具调用 / 工具结果 / 工具定义。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum AiContentBlock {
    Text {
        text: String,
    },
    /// 模型思考过程（Anthropic thinking / Gemini thought / DeepSeek reasoning_content
    /// / Responses reasoning summary）。加密的思考内容（redacted/encrypted）不采集。
    Thinking {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        /// 工具入参；能解析为 JSON 则为对象，否则为原始字符串。
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: Vec<AiContentBlock>,
    },
    /// 请求 `tools[]` 的归一化定义列表。只出现在 `tools_def` 伪 turn 里，
    /// 且该 turn 恒为单块（见 [`AiTurn::tool_defs`]）。
    ToolDefs {
        tools: Vec<AiToolDef>,
    },
}

/// 单个工具定义。四家 provider 的 `tools[]` 形状互不兼容，函数工具归一到
/// `Function`，其余（provider 内置工具）原样落 `Raw`——形状无法归一，
/// 但不丢弃，与 `[ai-coverage]` 同一原则：看不懂的暴露出来，别静默丢。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum AiToolDef {
    /// 函数工具。`parameters` 为 JSON Schema，三家键名不同但值同构：
    /// Anthropic `input_schema` / OpenAI `parameters` / Gemini `parametersJsonSchema`
    /// （Gemini 旧版 `parameters` 是 OpenAPI 3.0 子集方言，此处不做方言转换）。
    Function {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parameters: Option<Value>,
    },
    /// 无法识别为函数工具的项，原样保留：
    /// Anthropic `{type:"web_search_20250305", max_uses:5}`、
    /// OpenAI `{type:"code_interpreter"}` / `{type:"mcp", server_url}`、
    /// Gemini `{googleSearch:{}}` / `{codeExecution:{}}`。
    Raw { json: Value },
}

impl AiContentBlock {
    pub(crate) fn text(text: impl Into<String>) -> Self {
        AiContentBlock::Text { text: text.into() }
    }

    pub(crate) fn thinking(text: impl Into<String>) -> Self {
        AiContentBlock::Thinking { text: text.into() }
    }
}

/// 对话中的一轮。role 与前端一致：system/user/assistant/tool/tools_def。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct AiTurn {
    pub role: String,
    pub content: Vec<AiContentBlock>,
}

impl AiTurn {
    pub(crate) fn new(role: impl Into<String>, content: Vec<AiContentBlock>) -> Self {
        AiTurn {
            role: role.into(),
            content,
        }
    }

    /// tools[] 定义 turn（恒为单个 [`AiContentBlock::ToolDefs`] 块）；空列表返回 None。
    /// 保持伪 role turn 形态是为了继续复用现有管线：指纹、LCP 增量、落库、
    /// 时间线推送全部免费继承，会话中途增删工具自然表现为新 turn。
    pub(crate) fn tool_defs(tools: Vec<AiToolDef>) -> Option<AiTurn> {
        if tools.is_empty() {
            return None;
        }
        Some(AiTurn::new(
            "tools_def",
            vec![AiContentBlock::ToolDefs { tools }],
        ))
    }
}

/// `Value` → 非空字符串（缺失 / 空串 / 非字符串都归 None）。工具描述等可选文本字段用。
pub(crate) fn opt_string(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// OpenAI 系单个工具项 → [`AiToolDef`]。Chat Completions 是
/// `{type:"function", function:{name, description, parameters}}` 嵌套一层，
/// Responses 是 `{type:"function", name, description, parameters}` 平铺；
/// 除嵌套层级外键名完全一致，故两个协议共用此函数。
///
/// `type` 非 `function`（`code_interpreter` / `mcp` / `custom` / `web_search_preview` …）
/// 一律落 `Raw`：这些内置工具各带自己的配置字段，塞进 `Function` 会丢掉它们。
pub(crate) fn openai_tool_def(v: &Value) -> AiToolDef {
    match v.get("type").and_then(Value::as_str) {
        // 缺 type 时按函数工具尝试（API 要求带 type，但代理要容忍不规范客户端）
        None | Some("function") => {}
        Some(_) => return AiToolDef::Raw { json: v.clone() },
    }
    let inner = v.get("function").unwrap_or(v);
    match inner.get("name").and_then(Value::as_str) {
        Some(name) if !name.is_empty() => AiToolDef::Function {
            name: name.to_string(),
            description: opt_string(inner.get("description")),
            parameters: inner.get("parameters").cloned(),
        },
        _ => AiToolDef::Raw { json: v.clone() },
    }
}

/// 传输用：把 turn 里 thinking 的正文剥掉，仅保留占位（text 置空）。
/// 前端据此渲染 thinking 气泡；正文经 `get_ai_thinking` 按需拉取。
/// 流式增量、finalize 快照、`get_ai_session` 统一走此函数，保证两条路一致。
pub(crate) fn strip_thinking(turn: &AiTurn) -> AiTurn {
    let mut stripped = turn.clone();
    for block in &mut stripped.content {
        if let AiContentBlock::Thinking { text } = block {
            text.clear();
        }
    }
    stripped
}

/// 时间线 turn 的传输形态：thinking 正文已剥，fingerprint 作为稳定 turn id
/// （已定稿 turn 有；流式中未落库的 assistant turn 无）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiTimelineTurnDto {
    pub(crate) request_id: u64,
    pub(crate) role: String,
    pub(crate) content: Vec<AiContentBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) fingerprint: Option<u64>,
}

impl AiTimelineTurnDto {
    /// 已定稿 turn：带 fingerprint（供 get_ai_thinking 寻址）。
    pub(crate) fn committed(request_id: u64, fingerprint: u64, turn: &AiTurn) -> Self {
        AiTimelineTurnDto {
            request_id,
            role: turn.role.clone(),
            content: strip_thinking(turn).content,
            fingerprint: Some(fingerprint),
        }
    }

    /// 流式中未落库的 assistant turn：无 fingerprint。
    pub(crate) fn streaming(request_id: u64, turn: &AiTurn) -> Self {
        AiTimelineTurnDto {
            request_id,
            role: turn.role.clone(),
            content: strip_thinking(turn).content,
            fingerprint: None,
        }
    }
}

/// token 用量。字段可选，因不同 provider / 流式阶段提供的信息不同。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_tokens: Option<u64>,
    /// 缓存写入量（Anthropic cache_creation_input_tokens / Bedrock cacheWriteInputTokens）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_tokens: Option<u64>,
    /// 推理 token（OpenAI/DeepSeek completion_tokens_details.reasoning_tokens）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<u64>,
}

impl AiUsage {
    /// 是否所有字段都缺失。usage JSON 存在但无可识别字段时用于过滤，
    /// 避免序列化出空对象 `{}` 误导前端的有值判断。
    pub(crate) fn is_empty(&self) -> bool {
        self.input_tokens.is_none()
            && self.output_tokens.is_none()
            && self.total_tokens.is_none()
            && self.cached_tokens.is_none()
            && self.cache_creation_tokens.is_none()
            && self.reasoning_tokens.is_none()
    }

    /// 简单累加：各字段相加（None 视为 0，任一有值则结果为 Some）。真实计费口径。
    pub(crate) fn accumulate(&mut self, other: &AiUsage) {
        fn add(a: Option<u64>, b: Option<u64>) -> Option<u64> {
            match (a, b) {
                (None, None) => None,
                (x, y) => Some(x.unwrap_or(0) + y.unwrap_or(0)),
            }
        }
        self.input_tokens = add(self.input_tokens, other.input_tokens);
        self.output_tokens = add(self.output_tokens, other.output_tokens);
        self.total_tokens = add(self.total_tokens, other.total_tokens);
        self.cached_tokens = add(self.cached_tokens, other.cached_tokens);
        self.cache_creation_tokens = add(self.cache_creation_tokens, other.cache_creation_tokens);
        self.reasoning_tokens = add(self.reasoning_tokens, other.reasoning_tokens);
    }
}

/// 通用 usage 归一化：兼容 OpenAI Chat Completions (prompt/completion)、
/// Anthropic (input/output)、Responses API (input/output)、Gemini (promptTokenCount/…) 四种命名。
/// 缓存命中走 cache_read 系列 fallback 链，缓存写入走 cache_creation 系列。
pub(crate) fn normalize_usage(usage: &Value) -> AiUsage {
    fn get_u64(v: &Value, keys: &[&str]) -> Option<u64> {
        for k in keys {
            if let Some(val) = v.get(k).and_then(Value::as_u64) {
                return Some(val);
            }
        }
        None
    }

    let input_tokens = get_u64(
        usage,
        &[
            "input_tokens",
            "prompt_tokens",
            "promptTokenCount",
            "inputTokens",
        ],
    );
    let output_tokens = get_u64(
        usage,
        &[
            "output_tokens",
            "completion_tokens",
            "candidatesTokenCount",
            "outputTokens",
        ],
    );
    let total_tokens = get_u64(usage, &["total_tokens", "totalTokens", "totalTokenCount"]);

    let cached_tokens = get_u64(usage, &["cache_read_input_tokens"])
        .or_else(|| {
            get_u64(
                usage,
                &[
                    "cached_tokens",
                    "cachedContentTokenCount",
                    "cacheReadInputTokens",
                ],
            )
        })
        .or_else(|| {
            usage
                .get("input_tokens_details")
                .or_else(|| usage.get("prompt_tokens_details"))
                .and_then(|d| d.get("cached_tokens"))
                .and_then(Value::as_u64)
        });

    let cache_creation_tokens = get_u64(
        usage,
        &["cache_creation_input_tokens", "cacheWriteInputTokens"],
    );

    let reasoning_tokens = usage
        .get("completion_tokens_details")
        .and_then(|d| d.get("reasoning_tokens"))
        .and_then(Value::as_u64);

    AiUsage {
        input_tokens,
        output_tokens,
        total_tokens: total_tokens.or_else(|| match (input_tokens, output_tokens) {
            (None, None) => None,
            (i, o) => Some(i.unwrap_or(0) + o.unwrap_or(0)),
        }),
        cached_tokens,
        cache_creation_tokens,
        reasoning_tokens,
    }
}

/// 把 tool_call 的 arguments 字符串尝试解析为 JSON，失败保留原始字符串。
pub(crate) fn parse_tool_input(raw: &str) -> Value {
    if raw.is_empty() {
        return Value::String(String::new());
    }
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
}

/// 归一化后的完整对话（含 provider / 轮次 / 流式状态 / 元信息）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiConversation {
    pub provider: String,
    pub turns: Vec<AiTurn>,
    pub streaming: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<AiUsage>,
    /// 停止原因，provider 原生值原样透传（OpenAI `stop`/`length`/`tool_calls`、
    /// Anthropic `end_turn`、Gemini `STOP` 等）；流式响应中出现即表示生成定稿。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    /// 首字用时（请求发出 → 首个流式 chunk），仅流式请求有值。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_chunk_ms: Option<u64>,
    /// 总耗时（请求发出 → 流结束），定稿快照注入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// 请求开始时刻（Unix ms），气泡时间戳展示用；每次快照恒注入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_ms: Option<i64>,
}

impl AiConversation {
    /// 构造器：timing 字段（`first_chunk_ms` / `duration_ms`）恒为 `None`，
    /// 由响应侧（`response::AiState`）注入——provider 解析器不感知时间。
    pub(crate) fn new(
        provider: impl Into<String>,
        turns: Vec<AiTurn>,
        streaming: bool,
        model: Option<String>,
        usage: Option<AiUsage>,
        finish_reason: Option<String>,
    ) -> Self {
        AiConversation {
            provider: provider.into(),
            turns,
            streaming,
            model,
            usage,
            finish_reason,
            first_chunk_ms: None,
            duration_ms: None,
            start_ms: None,
        }
    }
}

/// 从响应 conversation 提取会话标题：
/// 第一条 assistant turn 的文本若为 `{"title": "..."}` JSON，返回 title。
/// 供会话表在首请求响应定稿时命名会话。
pub(crate) fn extract_title(conv: &AiConversation) -> Option<String> {
    let turn = conv.turns.iter().find(|t| t.role == "assistant")?;
    let mut text = String::new();
    for block in &turn.content {
        if let AiContentBlock::Text { text: t } = block {
            text.push_str(t);
        }
    }
    let value: serde_json::Value = serde_json::from_str(strip_code_fence(text.trim())).ok()?;
    let title = value.as_object()?.get("title")?.as_str()?.trim();
    (!title.is_empty()).then(|| title.to_string())
}

/// 从请求 messages 的第一条 user turn 提取会话标题（兜底）。
/// 策略：从纯文本块中取第一条有效片段，
/// 而不是识别并过滤注入标签——注入方随时新增标签，黑名单永远追不上。
/// <USER_REQUEST> 内容优先，否则取首个非空文本块。
pub(crate) fn extract_title_from_request(messages: &[AiTurn]) -> Option<String> {
    let turn = messages.iter().find(|t| t.role == "user")?;

    // 拼接所有 text 块
    let mut full_text = String::new();
    for block in &turn.content {
        if let AiContentBlock::Text { text: t } = block {
            full_text.push_str(t);
        }
    }
    let full_text = full_text.trim().to_string();
    if full_text.is_empty() {
        return None;
    }

    // <USER_REQUEST>...</USER_REQUEST> 内容优先
    if let Some(inner) = extract_tag_content(&full_text, "USER_REQUEST") {
        let cleaned = inner.trim().to_string();
        if !cleaned.is_empty() {
            return Some(truncate_at_char_boundary(&cleaned, 50).to_string());
        }
    }

    // 否则取按行拆分后的第一条有效文本
    for line in full_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // 跳过 XML 标签行（包括 <tag> / </tag> / <tag attr> 等）
        if trimmed.starts_with('<') && trimmed.ends_with('>') {
            continue;
        }
        // 跳过 XML 开标签（可能在后续行有闭合）
        if trimmed.starts_with('<') && trimmed.contains('>') {
            // 保守策略：以 < 开头且包含 > 的都视为 XML 行跳过；
            // 真正的用户文本不会以 < 开头（除 <USER_REQUEST> 已处理）
            continue;
        }
        // 跳过常见的注入前缀行
        if trimmed.starts_with('#') || trimmed.starts_with('[') || trimmed.starts_with('`') {
            continue;
        }
        return Some(truncate_at_char_boundary(trimmed, 50).to_string());
    }

    None
}

/// 提取 `<TAG>...</TAG>` 的内部内容（仅当整条消息被此标签包裹时）。
/// 大小写不敏感。
fn extract_tag_content(s: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let s_lower = s.to_lowercase();

    if s_lower.starts_with(&open.to_lowercase()) && s_lower.ends_with(&close.to_lowercase()) {
        let inner = s[open.len()..s.len() - close.len()].trim().to_string();
        return (!inner.is_empty()).then_some(inner);
    }

    // 也尝试带属性的情况：<tag ...>
    if starts_with_tag_ci(s, tag) && s_lower.ends_with(&close.to_lowercase()) {
        let after_open = s.find('>')?;
        let inner = s[after_open + 1..s.len() - close.len()].trim().to_string();
        return (!inner.is_empty()).then_some(inner);
    }

    None
}

/// 大小写不敏感检查 `s` 是否以 `<TAG` 开头（不要求紧接 `>`，兼容属性）。
fn starts_with_tag_ci(s: &str, tag: &str) -> bool {
    let s_lower = s.to_lowercase();
    let prefix = format!("<{}", tag.to_lowercase());
    s_lower.starts_with(&prefix)
}

/// UTF-8 字符边界安全截断：`max_len` 字节以内找最近边界截断。
fn truncate_at_char_boundary(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len {
        return s;
    }
    let mut end = max_len;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// snake_case / kebab-case → camelCase：`prompt_tokens` → `promptTokens`、
/// `finish_reason` → `finishReason`。仅处理 ASCII 标识符。
fn camelize(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut upper_next = false;
    for ch in s.chars() {
        match ch {
            '_' | '-' => upper_next = true,
            c if upper_next => {
                // to_uppercase 对 ASCII 返回单字符大写，对非 ASCII 可能多 char——
                // 但 AI 字段名只有 ASCII，这里走 fast path
                result.extend(c.to_uppercase());
                upper_next = false;
            }
            c => {
                result.push(c);
                upper_next = false;
            }
        }
    }
    result
}

/// 递归收集 JSON 对象的**叶子字段名**（已 camelCase 归一化），不去重。
/// 数组递归元素；对象递归值；原始值（字符串/数字/bool/null）收集父键。
/// `max_depth` 防止无限递归（防御性上限）。
pub(crate) fn collect_leaf_keys(
    value: &Value,
    depth: u32,
    max_depth: u32,
    keys: &mut std::collections::HashSet<String>,
) {
    if depth > max_depth {
        return;
    }
    match value {
        Value::Array(arr) => {
            for item in arr {
                collect_leaf_keys(item, depth + 1, max_depth, keys);
            }
        }
        Value::Object(map) => {
            for (key, val) in map {
                if val.is_object() {
                    collect_leaf_keys(val, depth + 1, max_depth, keys);
                } else if val.is_array() {
                    let arr = val.as_array().unwrap();
                    if arr.is_empty() {
                        keys.insert(camelize(key));
                    } else {
                        collect_leaf_keys(val, depth + 1, max_depth, keys);
                    }
                } else {
                    keys.insert(camelize(key));
                }
            }
        }
        _ => {}
    }
}

/// `serde_json::Value` 上的扩展方法，提供叶子字段名收集能力。
/// 覆盖率巡检用：原始 JSON 与归一化 IR 各自调 `leaf_keys()` 然后做差集。
pub(crate) trait JsonValueExt {
    /// 递归收集所有叶子字段名（camelCase 归一化），去重返回。
    fn leaf_keys(&self) -> std::collections::HashSet<String>;
}

impl JsonValueExt for Value {
    fn leaf_keys(&self) -> std::collections::HashSet<String> {
        let mut keys = std::collections::HashSet::new();
        collect_leaf_keys(self, 0, 20, &mut keys);
        keys
    }
}

/// 剥掉包裹全文的 ``` / ```json 代码栅栏（部分模型会包一层）；不匹配时原样返回。
fn strip_code_fence(s: &str) -> &str {
    let Some(rest) = s.strip_prefix("```").and_then(|r| r.strip_suffix("```")) else {
        return s;
    };
    // 首行可能是语言标记（json 等），跳过到首个换行
    match rest.find('\n') {
        Some(i) => rest[i + 1..].trim(),
        None => rest.trim(),
    }
}
