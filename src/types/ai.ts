/** AI 对话统一中间表示（IR），镜像后端 `src-tauri/src/proxy/ai/normalize.rs`。
 *  前端不再本地解析，仅消费后端 `AiNormalized` / `AiSession` 事件后展示。 */

/** 内容块；text / thinking / tool_use / tool_result */
export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: AiContentBlock[] }

export interface AiTurn {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'tools_def'
  content: AiContentBlock[]
}

/** 时间线条目：渲染用（去重后的 turn + 其归属请求）。fingerprint 为稳定 turn id，供按需拉取 thinking。 */
export interface TimelineItem {
  turn: AiTurn
  requestId: number
  fingerprint?: number
}

/** 后端 get_ai_session / ai_timeline 事件返回的时间线条目（thinking 已剥正文，fingerprint 定位） */
export interface AiTimelineTurnDto {
  requestId: number
  role: AiTurn['role']
  content: AiContentBlock[]
  fingerprint?: number
}

export interface AiUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  /** 缓存命中（cache read）token 数 */
  cachedTokens?: number
  /** 缓存写入（cache creation）token 数 */
  cacheCreationTokens?: number
  /** 推理 token 数（completion_tokens_details.reasoning_tokens） */
  reasoningTokens?: number
}

export interface AiConversation {
  provider: 'openai' | 'anthropic'
  turns: AiTurn[]
  streaming: boolean
  model?: string
  usage?: AiUsage
  /** 停止原因，provider 原生值透传（stop / end_turn / STOP 等），可区分正常结束、截断、工具调用 */
  finishReason?: string
  /** 首字用时 ms（请求发出 → 首个流式 chunk），仅流式请求有值 */
  firstChunkMs?: number
  /** 总耗时 ms（请求发出 → 流结束），定稿后有值 */
  durationMs?: number
  /** 请求开始时刻 Unix ms（代理收到请求），气泡时间戳用；每次快照恒有 */
  startMs?: number
}

/** 镜像后端 AiProvider 枚举 */
export type AiProvider = 'openai' | 'openai-responses' | 'anthropic' | 'gemini'

export function isAiProvider(s: string): s is AiProvider {
  return s === 'openai' || s === 'openai-responses' || s === 'anthropic' || s === 'gemini'
}

/** 前端会话状态：由 useAiSessions 从 list_ai_sessions + AI 事件累积。 */
export interface AiSessionState {
  sessionId: string
  scopeHost: string
  /** 会话标题：后端从首请求响应的 {"title": "..."} 提取，无则回退 scopeHost */
  title?: string
  /** 组内请求 id，有序 */
  requestIds: number[]
  usageTotal: AiUsage
  /** 归组依据：`header:<name>` / `prefix` / `new` / `usage` */
  matchReason: string
  /** 来源归属（客户端名）：后端按命中的合并头确认，无则缺省 */
  source?: string
  /** 每个请求 id → 该次归一化元信息（不含 turns，轻量；turns 走 timeline 单独拉取） */
  requests: Record<number, AiRequestMeta>
}

/** 单次请求的归一化元信息（不含 turns） */
export interface AiRequestMeta {
  id: number
  streaming: boolean
  model?: string
  finishReason?: string
  firstChunkMs?: number
  durationMs?: number
  startMs?: number
  usage?: AiUsage
}

/** 后端 list_ai_sessions 返回的会话摘要（requests 为数组） */
export interface AiSessionSummary {
  sessionId: string
  scopeHost: string
  title?: string
  source?: string
  matchReason: string
  requestIds: number[]
  usageTotal: AiUsage
  requests: AiRequestMeta[]
}
