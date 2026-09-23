//! OpenAI Responses API 归一化（请求 input[] + 非流式响应 output[] + 流式 SSE）。
//!
//! Chat Completions（/v1/chat/completions）使用 messages[]，Responses（/v1/responses）
//! 使用 input[]；两者在请求体结构、响应结构、SSE 事件类型上完全不同。
//! 参考 claude-tap SSEReassembler._accumulate() 的 Responses API 流式重组逻辑。

use std::collections::BTreeMap;

use serde_json::Value;

use super::normalize::{
    AiContentBlock, AiConversation, AiTurn, AiUsage, normalize_usage, openai_tool_def,
    parse_tool_input,
};
use super::{AiProtocol, StreamState};

// ══════════════════════════════════════════════════════════════════════════════
// 协议实现
// ══════════════════════════════════════════════════════════════════════════════

pub(crate) struct OpenAiResponsesProtocol;

impl AiProtocol for OpenAiResponsesProtocol {
    /// 解析 Responses API 请求体（`input[]` + 顶层 `instructions` + `tools[]`）。
    fn parse_request(&self, body: &Value) -> Option<Vec<AiTurn>> {
        let p = body;
        let input = p.get("input")?.as_array()?;
        if input.is_empty() {
            return None;
        }

        let mut turns: Vec<AiTurn> = Vec::new();

        if let Some(instructions) = p.get("instructions").and_then(Value::as_str)
            && !instructions.is_empty()
        {
            turns.push(AiTurn::new(
                "system",
                vec![AiContentBlock::text(instructions)],
            ));
        }

        if let Some(t) = p
            .get("tools")
            .and_then(Value::as_array)
            .and_then(|ts| AiTurn::tool_defs(ts.iter().map(openai_tool_def).collect()))
        {
            turns.push(t);
        }

        for m in input {
            let role_raw = m.get("role").and_then(Value::as_str).unwrap_or("user");
            let role = match role_raw {
                "system" | "user" | "assistant" | "tool" => role_raw,
                _ => "user",
            };
            let content = m.get("content");

            // Responses `input[]` 用无 role 的 typed item 承载工具流量
            // （`function_call` / `function_call_output`），与 Chat Completions 的
            // role:"assistant" + tool_calls / role:"tool" 完全不同。需先按 type 分派，
            // 否则它们会落进下面 `_ => text("")` 变成空 user 气泡。
            match m.get("type").and_then(Value::as_str) {
                Some("function_call") => {
                    let id = m
                        .get("call_id")
                        .or_else(|| m.get("id"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let name = m
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let args = m.get("arguments").and_then(Value::as_str).unwrap_or("");
                    turns.push(AiTurn::new(
                        "assistant",
                        vec![AiContentBlock::ToolUse {
                            id,
                            name,
                            input: parse_tool_input(args),
                        }],
                    ));
                    continue;
                }
                Some("function_call_output") => {
                    let tool_use_id = m
                        .get("call_id")
                        .or_else(|| m.get("id"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let inner = m
                        .get("output")
                        .and_then(Value::as_str)
                        .map(|s| vec![AiContentBlock::text(s)])
                        .unwrap_or_else(|| vec![AiContentBlock::text("")]);
                    turns.push(AiTurn::new(
                        "tool",
                        vec![AiContentBlock::ToolResult {
                            tool_use_id,
                            content: inner,
                        }],
                    ));
                    continue;
                }
                _ => {}
            }

            if role == "tool" {
                let inner = match content {
                    Some(Value::String(s)) => vec![AiContentBlock::text(s.clone())],
                    Some(Value::Array(arr)) => {
                        let texts: Vec<AiContentBlock> = arr
                            .iter()
                            .filter(|b| {
                                matches!(
                                    b.get("type").and_then(Value::as_str),
                                    Some("input_text" | "output_text")
                                )
                            })
                            .filter_map(|b| {
                                b.get("text")
                                    .and_then(Value::as_str)
                                    .map(AiContentBlock::text)
                            })
                            .collect();
                        if texts.is_empty() {
                            vec![AiContentBlock::text("")]
                        } else {
                            texts
                        }
                    }
                    _ => vec![AiContentBlock::text("")],
                };
                let tool_use_id = m
                    .get("tool_call_id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                turns.push(AiTurn::new(
                    role,
                    vec![AiContentBlock::ToolResult {
                        tool_use_id,
                        content: inner,
                    }],
                ));
                continue;
            }

            let blocks: Vec<AiContentBlock> = match content {
                Some(Value::String(s)) => vec![AiContentBlock::text(s.clone())],
                Some(Value::Array(arr)) => {
                    let texts: Vec<AiContentBlock> = arr
                        .iter()
                        .filter_map(|b| {
                            let t = b.get("type").and_then(Value::as_str)?;
                            if t == "input_text" || t == "output_text" {
                                b.get("text")
                                    .and_then(Value::as_str)
                                    .map(AiContentBlock::text)
                            } else {
                                None
                            }
                        })
                        .collect();
                    if texts.is_empty() {
                        vec![AiContentBlock::text("")]
                    } else {
                        texts
                    }
                }
                _ => vec![AiContentBlock::text("")],
            };

            turns.push(AiTurn::new(role, blocks));
        }
        Some(turns)
    }

    /// 解析非流式 Responses API 响应体（`object: "response"`，含 `output[]` + `usage`）。
    fn parse_response_body(&self, body: &Value) -> Option<AiConversation> {
        let p = body;
        if p.get("object").and_then(Value::as_str) != Some("response") {
            return None;
        }

        let output = p.get("output").and_then(Value::as_array)?;
        let mut blocks: Vec<AiContentBlock> = Vec::new();
        for item in output {
            let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
            match item_type {
                "message" => {
                    if let Some(arr) = item.get("content").and_then(Value::as_array) {
                        for c in arr {
                            if matches!(
                                c.get("type").and_then(Value::as_str),
                                Some("output_text" | "input_text")
                            ) && let Some(t) = c.get("text").and_then(Value::as_str)
                            {
                                blocks.push(AiContentBlock::text(t));
                            }
                        }
                    }
                }
                "function_call" | "tool_use" => {
                    blocks.push(AiContentBlock::ToolUse {
                        id: item
                            .get("id")
                            .or_else(|| item.get("call_id"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        name: item
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        input: item
                            .get("arguments")
                            .or_else(|| item.get("input"))
                            .cloned()
                            .unwrap_or(Value::Object(Default::default())),
                    });
                }
                "reasoning" => {
                    let summary = reasoning_summary_text(item);
                    if !summary.is_empty() {
                        blocks.push(AiContentBlock::thinking(summary));
                    }
                }
                _ => {}
            }
        }

        if blocks.is_empty() {
            blocks.push(AiContentBlock::text(""));
        }

        Some(AiConversation::new(
            "openai",
            vec![AiTurn::new("assistant", blocks)],
            false,
            p.get("model").and_then(Value::as_str).map(String::from),
            p.get("usage").map(normalize_usage),
            p.get("status").and_then(Value::as_str).map(String::from),
        ))
    }

    fn create_stream_state(&self) -> Box<dyn StreamState> {
        Box::new(OpenAiResponsesStreamState::default())
    }
}

/// reasoning item 的 summary[] 文本拼接（加密的 encrypted_content 不采集）。
fn reasoning_summary_text(item: &Value) -> String {
    item.get("summary")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter(|s| s.get("type").and_then(Value::as_str) == Some("summary_text"))
                .filter_map(|s| s.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

// ══════════════════════════════════════════════════════════════════════════════
// 流式 SSE 状态机
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Default)]
struct OpenAiOutputItem {
    item_type: String,
    /// message 正文 / reasoning summary 的累积文本。
    text: String,
    tool_id: String,
    tool_name: String,
    tool_arguments: String,
}

#[derive(Default)]
struct OpenAiResponsesStreamState {
    model: Option<String>,
    status: Option<String>,
    usage: Option<AiUsage>,
    done: bool,
    output_items: BTreeMap<i64, OpenAiOutputItem>,
}

impl StreamState for OpenAiResponsesStreamState {
    fn apply(&mut self, event: &str, data: &Value) {
        let p = data;
        match event {
            "response.created" => {
                let r = p.get("response");
                if self.model.is_none() {
                    self.model = r
                        .and_then(|r| r.get("model"))
                        .and_then(Value::as_str)
                        .map(String::from);
                }
                self.status = r
                    .and_then(|r| r.get("status"))
                    .and_then(Value::as_str)
                    .map(String::from);
            }
            "response.output_item.added" => {
                let idx = p.get("output_index").and_then(Value::as_i64).unwrap_or(0);
                let item_type = p
                    .get("item")
                    .and_then(|i| i.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.output_items.entry(idx).or_insert(OpenAiOutputItem {
                    item_type,
                    ..Default::default()
                });
            }
            "response.output_text.delta" => {
                let delta = p.get("delta").and_then(Value::as_str).unwrap_or("");
                let idx = p.get("output_index").and_then(Value::as_i64).unwrap_or(0);
                self.output_items
                    .entry(idx)
                    .or_insert_with(|| OpenAiOutputItem {
                        item_type: "message".to_string(),
                        ..Default::default()
                    })
                    .text
                    .push_str(delta);
            }
            "response.output_item.done" => {
                let idx = p.get("output_index").and_then(Value::as_i64).unwrap_or(0);
                if let Some(item) = p.get("item") {
                    let entry = self.output_items.entry(idx).or_default();
                    if entry.text.is_empty()
                        && let Some(content) = item.get("content").and_then(Value::as_array)
                    {
                        entry.text = content
                            .iter()
                            .filter(|c| {
                                matches!(
                                    c.get("type").and_then(Value::as_str),
                                    Some("output_text" | "input_text")
                                )
                            })
                            .filter_map(|c| c.get("text").and_then(Value::as_str))
                            .collect::<Vec<_>>()
                            .join("");
                    }
                    if let Some(t) = item.get("type").and_then(Value::as_str) {
                        entry.item_type = t.to_string();
                    }
                    if entry.item_type == "function_call" {
                        entry.tool_id = item
                            .get("id")
                            .or_else(|| item.get("call_id"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        entry.tool_name = item
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        entry.tool_arguments = item
                            .get("arguments")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                    }
                    if entry.item_type == "reasoning" {
                        entry.text = reasoning_summary_text(item);
                    }
                }
            }
            "response.completed" | "response.done" | "response.incomplete" | "response.failed" => {
                let r = p.get("response");
                if let Some(r) = r {
                    if let Some(s) = r.get("status").and_then(Value::as_str) {
                        self.status = Some(s.to_string());
                    }
                    if let Some(m) = r.get("model").and_then(Value::as_str) {
                        self.model = Some(m.to_string());
                    }
                    if let Some(u) = r.get("usage") {
                        self.usage = Some(normalize_usage(u));
                    }
                    if let Some(output) = r.get("output").and_then(Value::as_array)
                        && !output.is_empty()
                    {
                        for (i, o) in output.iter().enumerate() {
                            let idx = i as i64;
                            let entry = self.output_items.entry(idx).or_default();
                            merge_terminal_output_item(entry, o);
                        }
                    }
                }
                if self.usage.is_none()
                    && let Some(u) = p.get("usage")
                {
                    self.usage = Some(normalize_usage(u));
                }
                self.done = true;
            }
            "response.error" => {
                self.status = Some("failed".to_string());
                self.done = true;
            }
            _ => {}
        }
    }

    fn snapshot(&self) -> AiConversation {
        let mut blocks: Vec<AiContentBlock> = Vec::new();
        for item in self.output_items.values() {
            match item.item_type.as_str() {
                "message" => {
                    if !item.text.is_empty() {
                        blocks.push(AiContentBlock::text(item.text.clone()));
                    }
                }
                "reasoning" => {
                    if !item.text.is_empty() {
                        blocks.push(AiContentBlock::thinking(item.text.clone()));
                    }
                }
                "function_call" => {
                    let input = if item.tool_arguments.is_empty() {
                        Value::Object(Default::default())
                    } else {
                        serde_json::from_str(&item.tool_arguments)
                            .unwrap_or_else(|_| Value::String(item.tool_arguments.clone()))
                    };
                    blocks.push(AiContentBlock::ToolUse {
                        id: item.tool_id.clone(),
                        name: item.tool_name.clone(),
                        input,
                    });
                }
                _ => {}
            }
        }
        if blocks.is_empty() {
            blocks.push(AiContentBlock::text(""));
        }
        AiConversation::new(
            "openai",
            vec![AiTurn::new("assistant", blocks)],
            !self.done,
            self.model.clone(),
            self.usage.clone(),
            self.status.clone(),
        )
    }

    fn finalize(&mut self) -> Option<&'static str> {
        let term = match self.status.as_deref() {
            Some("completed") => None,
            _ => Some("error"),
        };
        self.done = true;
        term
    }
}

fn merge_terminal_output_item(entry: &mut OpenAiOutputItem, item: &Value) {
    if let Some(t) = item.get("type").and_then(Value::as_str) {
        entry.item_type = t.to_string();
    }
    if entry.item_type == "message"
        && let Some(content) = item.get("content").and_then(Value::as_array)
    {
        entry.text = content
            .iter()
            .filter(|c| {
                matches!(
                    c.get("type").and_then(Value::as_str),
                    Some("output_text" | "input_text")
                )
            })
            .filter_map(|c| c.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("");
    }
    if entry.item_type == "reasoning" {
        entry.text = reasoning_summary_text(item);
    }
    if entry.item_type == "function_call" {
        entry.tool_id = item
            .get("id")
            .or_else(|| item.get("call_id"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        entry.tool_name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        entry.tool_arguments = item
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
    }
}
