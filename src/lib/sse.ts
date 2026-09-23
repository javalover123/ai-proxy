export interface SseEvent {
  event: string;
  id?: string;
  retry?: number;
  data: string;
}

export function parseSse(body: string): SseEvent[] {
  const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const events: SseEvent[] = [];
  let current: Partial<SseEvent> = {};

  for (const line of lines) {
    if (line === "") {
      if (current.data !== undefined) {
        events.push({
          event: current.event || "message",
          id: current.id,
          retry: current.retry,
          data: current.data.replace(/\n$/, ""),
        });
      }
      current = {};
      continue;
    }

    if (line.startsWith(":")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      if (line.trim() === "data") {
        current.data = `${current.data || ""}\n`;
      }
      continue;
    }

    const fieldName = line.slice(0, colonIdx);
    const fieldValue = line.slice(colonIdx + 1);
    const value = fieldValue.startsWith(" ") ? fieldValue.slice(1) : fieldValue;

    switch (fieldName) {
      case "event":
        current.event = value;
        break;
      case "data":
        current.data = `${(current.data || "") + value}\n`;
        break;
      case "id":
        current.id = value;
        break;
      case "retry":
        current.retry = parseInt(value, 10);
        break;
    }
  }

  if (current.data !== undefined) {
    events.push({
      event: current.event || "message",
      id: current.id,
      retry: current.retry,
      data: current.data.replace(/\n$/, ""),
    });
  }

  return events;
}

export function isStreamingContentType(headers: Record<string, string> | null | undefined): boolean {
  if (!headers) return false;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "content-type" && v.toLowerCase().includes("text/event-stream")) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 合并消息 — 将多个 SSE 事件聚合成一条完整内容
// ---------------------------------------------------------------------------

export type MergeFormat = "openai" | "anthropic";

export interface MergeResult {
  /** 合并后的纯文本内容 */
  content: string;
  /** 可用于展示的格式化内容（如 JSON） */
  formatted: string;
  /** 合并涉及的 SSE 事件总数 */
  eventCount: number;
}

// ---------------------------------------------------------------------------
// Token 用量 — 从响应中解析
// ---------------------------------------------------------------------------

export interface TokenUsage {
  /** 提示 tokens */
  promptTokens?: number;
  /** 补全 tokens */
  completionTokens?: number;
  /** 总 tokens */
  totalTokens?: number;
  /** 缓存命中 tokens（Anthropic cache_read_input_tokens / OpenAI prompt_tokens_details.cached_tokens） */
  cachedTokens?: number;
  /** 缓存写入 tokens（Anthropic cache_creation_input_tokens） */
  cacheCreationTokens?: number;
}

/**
 * 从 SSE 事件列表中提取 token 用量信息。
 * - OpenAI：最后一个 chunk 通常包含 usage 字段
 * - Anthropic：input_tokens 在 message_start、output_tokens 在 message_delta，需跨事件聚合
 */
export function extractTokenUsage(events: SseEvent[]): TokenUsage | null {
  // 尝试 Anthropic 跨事件聚合
  let anthropicInput: number | undefined;
  let anthropicOutput: number | undefined;
  let anthropicCachedTokens: number | undefined;
  let anthropicCacheCreationTokens: number | undefined;
  for (const evt of events) {
    try {
      const p = JSON.parse(evt.data);
      if (!p || typeof p !== "object") continue;
      if (p.type === "message_start" && p.message?.usage?.input_tokens != null) {
        anthropicInput = p.message.usage.input_tokens;
        anthropicCachedTokens = p.message.usage.cache_read_input_tokens;
        anthropicCacheCreationTokens = p.message.usage.cache_creation_input_tokens;
      }
      if (p.type === "message_delta" && p.usage?.output_tokens != null) {
        anthropicOutput = p.usage.output_tokens;
      }
    } catch {}
  }
  if (anthropicInput != null || anthropicOutput != null) {
    return {
      promptTokens: anthropicInput,
      completionTokens: anthropicOutput,
      totalTokens: (anthropicInput ?? 0) + (anthropicOutput ?? 0),
      cachedTokens: anthropicCachedTokens,
      cacheCreationTokens: anthropicCacheCreationTokens,
    };
  }

  // OpenAI 末 chunk usage
  for (let i = events.length - 1; i >= 0; i--) {
    const data = events[i].data.trim();
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object" && parsed.usage) {
        const usage = parsed.usage;
        const details = usage.prompt_tokens_details;
        return {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          cachedTokens: details?.cached_tokens ?? undefined,
        };
      }
    } catch {}
  }
  return null;
}

/**
 * 尝试解析一条 SSE event.data 为 OpenAI chat completion chunk，
 * 返回 delta.content；解析失败返回 null。
 *
 * OpenAI SSE chunk 示例：
 *   {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}
 *   {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{},"index":0}]}
 *   {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}
 */
function extractOpenAIContent(data: string): string | null {
  // 跳过 [DONE] 标记
  if (data.trim() === "[DONE]") return null;

  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;

    const choices = parsed.choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;

    const delta = choices[0]?.delta;
    if (!delta || typeof delta !== "object") return null;

    const content = delta.content;
    if (typeof content !== "string") return null;

    return content;
  } catch {
    return null;
  }
}

/**
 * 从 Anthropic SSE event 中提取 text_delta 文本。
 * content_block_delta: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
 */
function extractAnthropicDelta(evt: SseEvent): string | null {
  try {
    const p = JSON.parse(evt.data);
    if (p?.type !== "content_block_delta") return null;
    const delta = p?.delta;
    if (delta?.type !== "text_delta" || typeof delta.text !== "string") return null;
    return delta.text;
  } catch {
    return null;
  }
}

/**
 * 从 OpenAI SSE event.data 中提取 tool_call arguments 增量文本。
 * 返回值是每个 tool_call 的 name + arguments JSON 片段，方便在 merged 视图中格式化展示。
 */
function extractOpenAIToolCallText(data: string): string | null {
  if (data.trim() === "[DONE]") return null;
  try {
    const p = JSON.parse(data);
    const toolCalls = p?.choices?.[0]?.delta?.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
    const parts: string[] = [];
    for (const tc of toolCalls) {
      if (tc.function?.arguments) {
        const prefix = tc.function.name ? `${tc.function.name}: ` : "";
        parts.push(prefix + tc.function.arguments);
      }
    }
    return parts.length > 0 ? parts.join("") : null;
  } catch {
    return null;
  }
}

/**
 * 将 SSE 事件列表按指定格式合并为一条消息。
 *
 * @param events  SSE 事件列表
 * @param format  目标格式（'openai' | 'anthropic'）
 * @returns       合并结果，events 为空时返回 null
 */
export function mergeSseMessages(events: SseEvent[], format: MergeFormat): MergeResult | null {
  if (events.length === 0) return null;

  if (format === "openai") {
    const parts: string[] = [];
    const toolParts: string[] = [];
    for (const evt of events) {
      const content = extractOpenAIContent(evt.data);
      if (content !== null) parts.push(content);
      const toolText = extractOpenAIToolCallText(evt.data);
      if (toolText !== null) toolParts.push(toolText);
    }
    let content = parts.join("");
    // 如果有 tool_call 数据，追加到 merged 内容后
    if (toolParts.length > 0) {
      const toolSection = `\n\n--- TOOL CALLS ---\n${toolParts.join("")}`;
      content += toolSection;
    }
    return { content, formatted: content, eventCount: events.length };
  }

  if (format === "anthropic") {
    const parts: string[] = [];
    for (const evt of events) {
      const block = extractAnthropicDelta(evt);
      if (block !== null) parts.push(block);
    }
    const content = parts.join("");
    return { content, formatted: content, eventCount: events.length };
  }

  return null;
}

/**
 * 粗略估算文本的 token 数（OpenAI cl100k_base 近似）。
 * CJK 字符约 1 token / 1.5 字符，ASCII 约 1 token / 4 字符。
 * 仅用于展示参考，非精确计数。
 */
export function estimateTokens(text: string): number {
  let cjkCount = 0;
  let asciiCount = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana/Katakana
      (code >= 0xac00 && code <= 0xd7af) // Hangul
    ) {
      cjkCount++;
    } else {
      asciiCount++;
    }
  }
  return Math.max(1, Math.ceil(cjkCount / 1.5 + asciiCount / 4));
}
