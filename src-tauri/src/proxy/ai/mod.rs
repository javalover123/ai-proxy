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
    /// 流结束：标记定稿。
    fn finalize(&mut self);
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
