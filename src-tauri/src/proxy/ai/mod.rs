//! 后端 AI 语义归一化引擎。

use serde_json::Value;

pub(crate) mod anthropic;
pub(crate) mod gemini;
pub(crate) mod normalize;
pub(crate) mod openai;
pub(crate) mod openai_responses;
pub(crate) mod request;
pub(crate) mod response;
pub(crate) mod session;

pub(crate) use normalize::{AiConversation, AiTimelineTurnDto, AiTurn, AiUsage};

/// AI 协议完整接口。新增协议只需实现此 trait + 在 Provider 加一个变体。
pub(crate) trait AiProtocol {
    /// 解析非流式请求体 → turns。
    fn parse_request(&self, root: &Value) -> Option<Vec<AiTurn>>;
    /// 解析非流式响应体 → conversation。
    fn parse_response_body(&self, root: &Value) -> Option<AiConversation>;
    /// 创建流式 SSE 状态机。
    fn create_stream_state(&self) -> Box<dyn StreamState>;
}

/// 流式 SSE 状态机接口。各协议自行实现，`SseFramer` 只做帧切分。
pub(crate) trait StreamState: Send {
    /// 消纳一个已分帧的 SSE event。
    fn apply(&mut self, event: &str, root: &Value);
    /// 当前累积的归一化对话快照。
    fn snapshot(&self) -> AiConversation;
    /// 流结束定稿。返回 `Some("error")` 表示流没以 provider 的终止事件收尾
    /// （如 Anthropic 没收到 `message_stop`、或中途 `event: error`），
    /// 上层据此把 `terminated` 置为 `"error"`，避免把半截流当干净完成。
    fn finalize(&mut self) -> Option<&'static str>;
}

// ══════════════════════════════════════════════════════════════════════════════
// Provider 枚举
// ══════════════════════════════════════════════════════════════════════════════

/// AI provider 类别，变体自带协议实现。
/// 新增协议时：实现 AiProtocol → 加一个枚举变体 → 编译器保证所有 match 点全覆盖。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Provider {
    /// OpenAI Chat Completions（/v1/chat/completions，`messages[]` + `choices[]`）
    OpenAiChat,
    /// OpenAI Responses（/v1/responses，`input[]` + `output[]`）
    OpenAiResponses,
    /// Anthropic Messages（/v1/messages，`system` + `messages[]` + content blocks）
    Anthropic,
    /// Google Gemini（`contents[]` + `candidates[]`）
    Gemini,
}

impl Provider {
    /// 获取协议实现。新增变体时编译器报错 → 补上对应行。
    fn protocol(self) -> &'static dyn AiProtocol {
        use anthropic::AnthropicProtocol;
        use gemini::GeminiProtocol;
        use openai::OpenAiChatProtocol;
        use openai_responses::OpenAiResponsesProtocol;
        match self {
            Provider::OpenAiChat => &OpenAiChatProtocol,
            Provider::OpenAiResponses => &OpenAiResponsesProtocol,
            Provider::Anthropic => &AnthropicProtocol,
            Provider::Gemini => &GeminiProtocol,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Provider::OpenAiChat | Provider::OpenAiResponses => "openai",
            Provider::Anthropic => "anthropic",
            Provider::Gemini => "gemini",
        }
    }

    /// 解析请求体为 turns。
    pub(crate) fn parse_request(self, root: &Value) -> Vec<AiTurn> {
        self.protocol().parse_request(root).unwrap_or_default()
    }

    /// 解析非流式响应体为 conversation。
    pub(crate) fn parse_response_body(self, root: &Value) -> Option<AiConversation> {
        self.protocol().parse_response_body(root)
    }

    /// 创建流式 SSE 状态机。
    pub(crate) fn create_stream_state(self) -> Box<dyn StreamState> {
        self.protocol().create_stream_state()
    }
}

impl From<crate::config::AiProvider> for Provider {
    fn from(p: crate::config::AiProvider) -> Self {
        match p {
            crate::config::AiProvider::OpenAI => Provider::OpenAiChat,
            crate::config::AiProvider::OpenAIResponses => Provider::OpenAiResponses,
            crate::config::AiProvider::Anthropic => Provider::Anthropic,
            crate::config::AiProvider::Gemini => Provider::Gemini,
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// 测试：tools[] 归一化（四协议形状各异，共同产出 tools_def turn + AiToolDef 列表）
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tool_def_tests {
    use super::normalize::{AiContentBlock, AiToolDef};
    use super::*;
    use serde_json::json;

    /// 从解析结果里取出 tools_def turn 的工具列表；无该 turn 返回 None。
    fn tool_defs(provider: Provider, body: &Value) -> Option<Vec<AiToolDef>> {
        let turns = provider.parse_request(body);
        let turn = turns.iter().find(|t| t.role == "tools_def")?;
        // 该 turn 恒为单个 ToolDefs 块（AiTurn::tool_defs 的不变量）
        assert_eq!(turn.content.len(), 1, "tools_def turn 必须恰好一个块");
        match &turn.content[0] {
            AiContentBlock::ToolDefs { tools } => Some(tools.clone()),
            other => panic!("tools_def turn 的块应为 ToolDefs，实际为 {other:?}"),
        }
    }

    fn func(name: &str, description: Option<&str>, parameters: Option<Value>) -> AiToolDef {
        AiToolDef::Function {
            name: name.to_string(),
            description: description.map(str::to_string),
            parameters,
        }
    }

    #[test]
    fn anthropic_function_and_builtin() {
        let body = json!({
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [
                {
                    "name": "get_weather",
                    "description": "  Get the weather  ",
                    "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}}
                },
                // 显式 custom 也是函数工具
                {"type": "custom", "name": "calc", "input_schema": {"type": "object"}},
                // 内置工具：带专属配置字段，整项原样保留
                {"type": "web_search_20250305", "name": "web_search", "max_uses": 5}
            ]
        });
        let defs = tool_defs(Provider::Anthropic, &body).expect("应有 tools_def turn");
        assert_eq!(
            defs,
            vec![
                func(
                    "get_weather",
                    Some("Get the weather"),
                    Some(json!({"type": "object", "properties": {"city": {"type": "string"}}}))
                ),
                func("calc", None, Some(json!({"type": "object"}))),
                AiToolDef::Raw {
                    json: json!({"type": "web_search_20250305", "name": "web_search", "max_uses": 5})
                },
            ]
        );
    }

    #[test]
    fn openai_chat_nested_function_and_builtin() {
        let body = json!({
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "hi"}
            ],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Get the weather",
                        "parameters": {"type": "object"}
                    }
                },
                {"type": "code_interpreter"},
                // 缺 type 的不规范客户端：仍按函数工具解析
                {"function": {"name": "legacy"}}
            ]
        });
        let defs = tool_defs(Provider::OpenAiChat, &body).expect("应有 tools_def turn");
        assert_eq!(
            defs,
            vec![
                func(
                    "get_weather",
                    Some("Get the weather"),
                    Some(json!({"type": "object"}))
                ),
                AiToolDef::Raw {
                    json: json!({"type": "code_interpreter"})
                },
                func("legacy", None, None),
            ]
        );
    }

    #[test]
    fn openai_responses_flat_function_and_mcp() {
        let body = json!({
            "input": [{"role": "user", "content": "hi"}],
            "tools": [
                {
                    "type": "function",
                    "name": "get_weather",
                    "description": "Get the weather",
                    "parameters": {"type": "object"}
                },
                {"type": "mcp", "server_label": "docs", "server_url": "https://example.test/mcp"}
            ]
        });
        let defs = tool_defs(Provider::OpenAiResponses, &body).expect("应有 tools_def turn");
        assert_eq!(
            defs,
            vec![
                func(
                    "get_weather",
                    Some("Get the weather"),
                    Some(json!({"type": "object"}))
                ),
                AiToolDef::Raw {
                    json: json!({"type": "mcp", "server_label": "docs", "server_url": "https://example.test/mcp"})
                },
            ]
        );
    }

    #[test]
    fn gemini_declarations_expand_and_builtin() {
        let body = json!({
            "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
            "tools": [
                {
                    "functionDeclarations": [
                        {
                            "name": "get_weather",
                            "description": "Get the weather",
                            "parametersJsonSchema": {"type": "object"}
                        },
                        // 旧版键名：parameters（OpenAPI 3.0 方言，不做转换）
                        {"name": "calc", "parameters": {"type": "OBJECT"}}
                    ]
                },
                {"googleSearch": {}}
            ]
        });
        let defs = tool_defs(Provider::Gemini, &body).expect("应有 tools_def turn");
        assert_eq!(
            defs,
            vec![
                func(
                    "get_weather",
                    Some("Get the weather"),
                    Some(json!({"type": "object"}))
                ),
                func("calc", None, Some(json!({"type": "OBJECT"}))),
                AiToolDef::Raw {
                    json: json!({"googleSearch": {}})
                },
            ]
        );
    }

    #[test]
    fn gemini_accepts_snake_case_declarations() {
        let body = json!({
            "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
            "tools": [{"function_declarations": [{"name": "calc"}]}]
        });
        let defs = tool_defs(Provider::Gemini, &body).expect("应有 tools_def turn");
        assert_eq!(defs, vec![func("calc", None, None)]);
    }

    #[test]
    fn empty_tools_yields_no_turn() {
        for (provider, body) in [
            (
                Provider::Anthropic,
                json!({"messages": [{"role": "user", "content": "hi"}], "tools": []}),
            ),
            (
                Provider::OpenAiChat,
                json!({"messages": [{"role": "user", "content": "hi"}], "tools": []}),
            ),
            (
                Provider::OpenAiResponses,
                json!({"input": [{"role": "user", "content": "hi"}], "tools": []}),
            ),
            (
                Provider::Gemini,
                json!({"contents": [{"role": "user", "parts": [{"text": "hi"}]}], "tools": []}),
            ),
        ] {
            assert!(
                tool_defs(provider, &body).is_none(),
                "{provider:?}: 空 tools 不应产出 tools_def turn"
            );
        }
    }

    /// tools_def 排在系统提示词之后、首条对话消息之前（四协议一致）。
    #[test]
    fn tools_def_sits_between_system_and_first_message() {
        let anthropic = json!({
            "system": "sys",
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [{"name": "t", "input_schema": {}}]
        });
        let chat = json!({
            "messages": [{"role": "system", "content": "sys"}, {"role": "user", "content": "hi"}],
            "tools": [{"type": "function", "function": {"name": "t"}}]
        });
        let responses = json!({
            "instructions": "sys",
            "input": [{"role": "user", "content": "hi"}],
            "tools": [{"type": "function", "name": "t"}]
        });
        let gemini = json!({
            "systemInstruction": {"parts": [{"text": "sys"}]},
            "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
            "tools": [{"functionDeclarations": [{"name": "t"}]}]
        });
        for (provider, body) in [
            (Provider::Anthropic, anthropic),
            (Provider::OpenAiChat, chat),
            (Provider::OpenAiResponses, responses),
            (Provider::Gemini, gemini),
        ] {
            let roles: Vec<String> = provider
                .parse_request(&body)
                .into_iter()
                .map(|t| t.role)
                .collect();
            assert_eq!(roles, vec!["system", "tools_def", "user"], "{provider:?}");
        }
    }

    /// 旧库行（tools_def 内容为 JSON 文本块）仍能反序列化为 Text——
    /// 不做迁移的前提就是老行照旧可读。
    #[test]
    fn legacy_text_rows_still_deserialize() {
        let legacy = r#"[{"type":"text","text":"[{\"name\":\"t\"}]"}]"#;
        let blocks: Vec<AiContentBlock> = serde_json::from_str(legacy).expect("旧行应可反序列化");
        assert!(matches!(blocks.as_slice(), [AiContentBlock::Text { .. }]));
    }

    /// ToolDefs 块序列化/反序列化往返（落库 → 读回的实际路径）。
    #[test]
    fn tool_defs_block_round_trips() {
        let block = AiContentBlock::ToolDefs {
            tools: vec![
                func("t", Some("d"), Some(json!({"type": "object"}))),
                AiToolDef::Raw {
                    json: json!({"googleSearch": {}}),
                },
            ],
        };
        let json_text = serde_json::to_string(&block).expect("序列化");
        assert_eq!(
            json_text,
            r#"{"type":"tool_defs","tools":[{"kind":"function","name":"t","description":"d","parameters":{"type":"object"}},{"kind":"raw","json":{"googleSearch":{}}}]}"#
        );
        let back: AiContentBlock = serde_json::from_str(&json_text).expect("反序列化");
        assert_eq!(back, block);
    }
}
