//! Anthropic Messages 归一化（请求 messages+system + 非流式响应 + 流式 SSE）。
//! 语义镜像前端 `src/lib/ai/providers/anthropic.ts`。

use std::collections::BTreeMap;

use serde_json::Value;

use super::normalize::{
    AiContentBlock, AiConversation, AiToolDef, AiTurn, AiUsage, normalize_usage, opt_string,
};
use super::{AiProtocol, StreamState};

// ══════════════════════════════════════════════════════════════════════════════
// 协议实现
// ══════════════════════════════════════════════════════════════════════════════

pub(crate) struct AnthropicProtocol;

impl AiProtocol for AnthropicProtocol {
    /// 解析请求体（顶层 `system` + `messages[]`，含 tool_use/tool_result block + tools 定义）。
    fn parse_request(&self, body: &Value) -> Option<Vec<AiTurn>> {
        let p = body;
        let messages = p.get("messages")?.as_array()?;
        if messages.is_empty() {
            return None;
        }
        let mut turns: Vec<AiTurn> = Vec::new();

        // 顶层 system → system turn（系统提示词排在 tools 定义之前）
        if let Some(system) = p.get("system") {
            let sys_text = match system {
                Value::String(s) => s.clone(),
                Value::Array(arr) => blocks_to_text(arr),
                _ => String::new(),
            };
            if !sys_text.is_empty() {
                turns.push(AiTurn::new("system", vec![AiContentBlock::text(sys_text)]));
            }
        }

        // tools[] 定义 → tools_def turn
        if let Some(t) = p
            .get("tools")
            .and_then(Value::as_array)
            .and_then(|ts| AiTurn::tool_defs(ts.iter().map(anthropic_tool_def).collect()))
        {
            turns.push(t);
        }

        for m in messages {
            let role_raw = m.get("role").and_then(Value::as_str).unwrap_or("user");
            let role = match role_raw {
                "user" | "assistant" | "tool" => role_raw,
                _ => "user",
            };
            match m.get("content") {
                Some(Value::Array(arr)) => {
                    let mut blocks: Vec<AiContentBlock> = Vec::new();
                    for b in arr {
                        match b.get("type").and_then(Value::as_str) {
                            Some("text") => {
                                if let Some(t) = b.get("text").and_then(Value::as_str) {
                                    blocks.push(AiContentBlock::text(t));
                                }
                            }
                            // 多轮工具链会回放 thinking block，与响应侧同口径捕获；
                            // redacted_thinking（加密）落入 `_` 丢弃
                            Some("thinking") => {
                                if let Some(t) = b.get("thinking").and_then(Value::as_str) {
                                    blocks.push(AiContentBlock::thinking(t));
                                }
                            }
                            Some("tool_use") => {
                                blocks.push(AiContentBlock::ToolUse {
                                    id: b
                                        .get("id")
                                        .and_then(Value::as_str)
                                        .unwrap_or("")
                                        .to_string(),
                                    name: b
                                        .get("name")
                                        .and_then(Value::as_str)
                                        .unwrap_or("")
                                        .to_string(),
                                    input: b
                                        .get("input")
                                        .cloned()
                                        .unwrap_or(Value::Object(Default::default())),
                                });
                            }
                            Some("tool_result") => {
                                let inner = match b.get("content") {
                                    Some(Value::String(s)) => vec![AiContentBlock::text(s.clone())],
                                    Some(Value::Array(cb)) => {
                                        let texts: Vec<AiContentBlock> = cb
                                            .iter()
                                            .filter(|c| {
                                                c.get("type").and_then(Value::as_str)
                                                    == Some("text")
                                            })
                                            .filter_map(|c| {
                                                c.get("text")
                                                    .and_then(Value::as_str)
                                                    .map(AiContentBlock::text)
                                            })
                                            .collect();
                                        if texts.is_empty() {
                                            vec![AiContentBlock::text(
                                                b.get("content")
                                                    .map(|c| c.to_string())
                                                    .unwrap_or_default(),
                                            )]
                                        } else {
                                            texts
                                        }
                                    }
                                    _ => vec![AiContentBlock::text("")],
                                };
                                blocks.push(AiContentBlock::ToolResult {
                                    tool_use_id: b
                                        .get("tool_use_id")
                                        .and_then(Value::as_str)
                                        .unwrap_or("")
                                        .to_string(),
                                    content: inner,
                                });
                            }
                            _ => {}
                        }
                    }
                    if blocks.is_empty() {
                        blocks.push(AiContentBlock::text(""));
                    }
                    turns.push(AiTurn::new(role, blocks));
                }
                Some(Value::String(s)) => {
                    if role == "tool" {
                        let tool_use_id = m
                            .get("tool_call_id")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        turns.push(AiTurn::new(
                            role,
                            vec![AiContentBlock::ToolResult {
                                tool_use_id,
                                content: vec![AiContentBlock::text(s.clone())],
                            }],
                        ));
                    } else {
                        turns.push(AiTurn::new(role, vec![AiContentBlock::text(s.clone())]));
                    }
                }
                _ => {
                    turns.push(AiTurn::new(role, vec![AiContentBlock::text("")]));
                }
            }
        }
        Some(turns)
    }

    /// 解析非流式响应体（`type: message`，含 `content[]` + `usage`）。
    fn parse_response_body(&self, body: &Value) -> Option<AiConversation> {
        let p = body;
        if p.get("type").and_then(Value::as_str) != Some("message") {
            return None;
        }
        let content = p.get("content")?.as_array()?;

        let mut blocks: Vec<AiContentBlock> = Vec::new();
        for b in content {
            match b.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(t) = b.get("text").and_then(Value::as_str) {
                        blocks.push(AiContentBlock::text(t));
                    }
                }
                // extended thinking；redacted_thinking（加密）不采集
                Some("thinking") => {
                    if let Some(t) = b.get("thinking").and_then(Value::as_str) {
                        blocks.push(AiContentBlock::thinking(t));
                    }
                }
                Some("tool_use") => {
                    blocks.push(AiContentBlock::ToolUse {
                        id: b
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        name: b
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        input: b
                            .get("input")
                            .cloned()
                            .unwrap_or(Value::Object(Default::default())),
                    });
                }
                _ => {}
            }
        }
        if blocks.is_empty() {
            blocks.push(AiContentBlock::text(""));
        }

        // 完整 usage 过通用归一化：input/output 之外把 cache_read 也捕获
        let usage = p
            .get("usage")
            .map(normalize_usage)
            .filter(|u| !u.is_empty());

        Some(AiConversation::new(
            "anthropic",
            vec![AiTurn::new("assistant", blocks)],
            false,
            p.get("model").and_then(Value::as_str).map(String::from),
            usage,
            p.get("stop_reason")
                .and_then(Value::as_str)
                .map(String::from),
        ))
    }

    fn create_stream_state(&self) -> Box<dyn StreamState> {
        Box::new(AnthropicStreamState::default())
    }
}

/// 从 content block 数组拼接纯文本。
fn blocks_to_text(blocks: &[Value]) -> String {
    blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("")
}

/// Anthropic 单个工具项 → [`AiToolDef`]。
/// 函数工具形如 `{name, description, input_schema}`（`type` 缺省或 `"custom"`）；
/// 带其他 `type` 的是内置工具（`web_search_20250305` / `text_editor_20250124` /
/// `computer_20241022` …），各自带专属配置字段，整项落 `Raw` 不做归一。
fn anthropic_tool_def(v: &Value) -> AiToolDef {
    match v.get("type").and_then(Value::as_str) {
        None | Some("custom") => {}
        Some(_) => return AiToolDef::Raw { json: v.clone() },
    }
    match v.get("name").and_then(Value::as_str) {
        Some(name) if !name.is_empty() => AiToolDef::Function {
            name: name.to_string(),
            description: opt_string(v.get("description")),
            parameters: v.get("input_schema").cloned(),
        },
        _ => AiToolDef::Raw { json: v.clone() },
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// 流式 SSE 状态机
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Default, Clone, Copy, PartialEq)]
enum AnthropicBlockKind {
    #[default]
    Text,
    Thinking,
    Tool,
}

#[derive(Default)]
struct AnthropicBlock {
    kind: AnthropicBlockKind,
    /// text / thinking 的累积正文。
    text: String,
    tool_id: String,
    tool_name: String,
    partial_json: String,
}

#[derive(Default)]
struct AnthropicStreamState {
    model: Option<String>,
    /// `message_start` 的完整 usage（input + cache_read 口径）；
    /// output 走 `message_delta` 增量，snapshot 时经 [`Self::current_usage`] 合并。
    base_usage: Option<AiUsage>,
    output_tokens: Option<u64>,
    stop_reason: Option<String>,
    saw_message_stop: bool,
    blocks: BTreeMap<i64, AnthropicBlock>,
}

impl AnthropicStreamState {
    /// base usage + 累计 output 合并出当前 usage 快照。
    fn current_usage(&self) -> Option<AiUsage> {
        let mut usage = self.base_usage.clone();
        if let Some(ot) = self.output_tokens {
            let u = usage.get_or_insert_default();
            u.output_tokens = Some(ot);
            u.total_tokens = Some(u.input_tokens.unwrap_or(0) + ot);
        }
        usage
    }
}

impl StreamState for AnthropicStreamState {
    fn apply(&mut self, event: &str, data: &Value) {
        let p = data;
        match event {
            "message_start" => {
                let msg = p.get("message");
                self.model = msg
                    .and_then(|m| m.get("model"))
                    .and_then(Value::as_str)
                    .map(String::from);
                self.base_usage = msg
                    .and_then(|m| m.get("usage"))
                    .map(normalize_usage)
                    .filter(|u| !u.is_empty());
            }
            "content_block_start" => {
                let idx = p.get("index").and_then(Value::as_i64).unwrap_or(0);
                let cb = p.get("content_block");
                match cb.and_then(|c| c.get("type")).and_then(Value::as_str) {
                    Some("tool_use") => {
                        self.blocks.insert(
                            idx,
                            AnthropicBlock {
                                kind: AnthropicBlockKind::Tool,
                                tool_id: cb
                                    .and_then(|c| c.get("id"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_string(),
                                tool_name: cb
                                    .and_then(|c| c.get("name"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_string(),
                                ..Default::default()
                            },
                        );
                    }
                    Some("text") => {
                        self.blocks.insert(
                            idx,
                            AnthropicBlock {
                                kind: AnthropicBlockKind::Text,
                                text: cb
                                    .and_then(|c| c.get("text"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_string(),
                                ..Default::default()
                            },
                        );
                    }
                    Some("thinking") => {
                        self.blocks.insert(
                            idx,
                            AnthropicBlock {
                                kind: AnthropicBlockKind::Thinking,
                                text: cb
                                    .and_then(|c| c.get("thinking"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_string(),
                                ..Default::default()
                            },
                        );
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                let idx = p.get("index").and_then(Value::as_i64).unwrap_or(0);
                let delta = p.get("delta");
                match delta.and_then(|d| d.get("type")).and_then(Value::as_str) {
                    Some("text_delta") => {
                        if let Some(t) = delta.and_then(|d| d.get("text")).and_then(Value::as_str) {
                            // or_default → kind 默认 Text
                            self.blocks.entry(idx).or_default().text.push_str(t);
                        }
                    }
                    Some("thinking_delta") => {
                        if let Some(t) = delta
                            .and_then(|d| d.get("thinking"))
                            .and_then(Value::as_str)
                        {
                            self.blocks
                                .entry(idx)
                                .or_insert_with(|| AnthropicBlock {
                                    kind: AnthropicBlockKind::Thinking,
                                    ..Default::default()
                                })
                                .text
                                .push_str(t);
                        }
                    }
                    Some("input_json_delta") => {
                        if let Some(j) = delta
                            .and_then(|d| d.get("partial_json"))
                            .and_then(Value::as_str)
                        {
                            self.blocks
                                .entry(idx)
                                .or_insert_with(|| AnthropicBlock {
                                    kind: AnthropicBlockKind::Tool,
                                    ..Default::default()
                                })
                                .partial_json
                                .push_str(j);
                        }
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(ot) = p
                    .get("usage")
                    .and_then(|u| u.get("output_tokens"))
                    .and_then(Value::as_u64)
                {
                    self.output_tokens = Some(ot);
                }
                if let Some(sr) = p
                    .get("delta")
                    .and_then(|d| d.get("stop_reason"))
                    .and_then(Value::as_str)
                {
                    self.stop_reason = Some(sr.to_string());
                }
            }
            "message_stop" => {
                self.saw_message_stop = true;
            }
            _ => {}
        }
    }

    fn snapshot(&self) -> AiConversation {
        let mut blocks: Vec<AiContentBlock> = Vec::new();
        for b in self.blocks.values() {
            match b.kind {
                AnthropicBlockKind::Tool => {
                    let input = if b.partial_json.is_empty() {
                        serde_json::Value::Object(Default::default())
                    } else {
                        serde_json::from_str(&b.partial_json)
                            .unwrap_or_else(|_| Value::String(b.partial_json.clone()))
                    };
                    blocks.push(AiContentBlock::ToolUse {
                        id: b.tool_id.clone(),
                        name: b.tool_name.clone(),
                        input,
                    });
                }
                AnthropicBlockKind::Thinking => {
                    if !b.text.is_empty() {
                        blocks.push(AiContentBlock::thinking(b.text.clone()));
                    }
                }
                AnthropicBlockKind::Text => {
                    if !b.text.is_empty() {
                        blocks.push(AiContentBlock::text(b.text.clone()));
                    }
                }
            }
        }
        if blocks.is_empty() {
            blocks.push(AiContentBlock::text(""));
        }
        AiConversation::new(
            "anthropic",
            vec![AiTurn::new("assistant", blocks)],
            !self.saw_message_stop,
            self.model.clone(),
            self.current_usage(),
            self.stop_reason.clone(),
        )
    }

    fn finalize(&mut self) -> Option<&'static str> {
        // 没收到 message_stop 说明流没干净收尾（中途 event: error 被吞、或断流），
        // 别再把半截流伪装成干净完成。
        (!self.saw_message_stop).then_some("error")
    }
}
