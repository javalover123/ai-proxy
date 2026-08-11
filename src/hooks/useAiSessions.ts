import { useState, useRef, useCallback, useEffect } from 'react'
import type { AiContentBlock, AiConversation, AiSessionState, AiTurn, AiUsage } from '@/types/ai'
import { subscribeAiEvents, type AiEvent } from './aiEventBus'

/** 空 usage */
const EMPTY_USAGE: AiUsage = {}

/** sessions 窗口上限：超出后 LRU 淘汰最久未访问的会话 */
const MAX_SESSIONS = 50

/** 单会话内保留的请求（对话）条数上限：超出后 FIFO 丢最旧一条。
 *  配合 turn 对象内化，把单会话内存从 O(N²) 压到 O(N)（内容共享 + 指针有界）。 */
const MAX_CONV_PER_SESSION = 500

/**
 * 单个 content block 是否相等——利用协议自带的唯一标识做 O(1) 判定：
 * tool_use.id / tool_result.tool_use_id 由服务端生成且全局唯一，客户端回放时
 * 原样带回，id 相同即同一次调用，无需深比较 input/content 大对象。
 */
function sameBlock(a: AiContentBlock, b: AiContentBlock): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'text':
      return a.text === (b as Extract<AiContentBlock, { type: 'text' }>).text
    case 'thinking':
      return a.text === (b as Extract<AiContentBlock, { type: 'thinking' }>).text
    case 'tool_use': {
      const bb = b as Extract<AiContentBlock, { type: 'tool_use' }>
      // 极少数解析不到 id 时（空串）退化为 input 比对
      if (!a.id) return a.name === bb.name && JSON.stringify(a.input) === JSON.stringify(bb.input)
      return a.id === bb.id && a.name === bb.name
    }
    case 'tool_result':
      return a.tool_use_id === (b as Extract<AiContentBlock, { type: 'tool_result' }>).tool_use_id
  }
}

/**
 * 内化专用的严格相等：role + 逐 block 全等（**含 thinking**，与 sameTurn 不同）。
 * 只有内容逐字节等价才复用对象，保证 conversationOf 展示内容零变化。
 * sameBlock 对 text/thinking 比 text、对 tool_use 比 id/name、对 tool_result 比 tool_use_id，
 * 均为 O(1)，可安全用于流式热路径。
 */
function internableTurn(a: AiTurn, b: AiTurn): boolean {
  if (a === b) return true
  if (a.role !== b.role) return false
  if (a.content.length !== b.content.length) return false
  return a.content.every((blk, i) => sameBlock(blk, b.content[i]))
}

/** LCP 比较忽略 thinking：客户端回放历史时可能剥掉思考内容（如 reasoning_content
 *  不回放），计入会让同一 turn 前后形状不同、时间线在该处断链重复。 */
function comparableBlocks(turn: AiTurn): AiContentBlock[] {
  return turn.content.filter((b) => b.type !== 'thinking')
}

/** 两个 turn 是否相等：role + 逐 block 比较（忽略 thinking），任一不匹配即短路。
 *  用于 mergedTimeline 的 LCP 去重——不依赖 internableTurn 是否成功，始终正确。 */
function sameTurn(a: AiTurn, b: AiTurn): boolean {
  if (a === b) return true
  if (a.role !== b.role) return false
  const ca = comparableBlocks(a)
  const cb = comparableBlocks(b)
  if (ca.length !== cb.length) return false
  return ca.every((blk, i) => sameBlock(blk, cb[i]))
}

/** 将 sid 移到 LRU 数组末尾（标记为最近访问）。 */
function touchLru(order: string[], sid: string) {
  const idx = order.indexOf(sid)
  if (idx !== -1) {
    order.splice(idx, 1)
  }
  order.push(sid)
}

/**
 * 消费后端 `ai_normalized` / `ai_session` 事件，维护 `Map<sessionId, AiSessionState>`。
 * 与 useProxyEvents 并列独立，不依赖/污染 TrafficEntry。
 *
 * 两层去重：
 * - 内化层（internableTurn）：事件到达时，与前一条请求的 turns 逐条深比较，
 *   内容相同则复用旧 JS 对象——省内存，单会话从 O(N²) 压到 O(N)。
 * - 渲染层（mergedTimeline → sameTurn LCP深比较）：按 requestIds 顺序，每条
 *   请求的完整 turns 与已合并结果求最长公共前缀，只追加超出部分。渲染去重
 *   不依赖内化是否成功，始终正确。」
 */
export function useAiSessions() {
  const sessionsRef = useRef<Map<string, AiSessionState>>(new Map())
  /** requestId → sessionId，便于 AiNormalized 快速定位所属会话 */
  const reqToSessionRef = useRef<Map<number, string>>(new Map())
  /** LRU 淘汰：记录 sessionId 访问顺序，越靠后越新 */
  const lruOrderRef = useRef<string[]>([])
  const [, setTick] = useState(0)

  // rAF 合批：流式高频 AiNormalized 落同一帧刷新
  const rafRef = useRef<number | null>(null)
  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      setTick((t) => t + 1)
    })
  }, [])

  /** 单会话内保留最近 MAX_CONV_PER_SESSION 条，FIFO 丢最旧并清关联索引。
   *  被丢对话引用的共享 turn 对象若仍被新对话引用则自然存活，不影响内化。 */
  const capConversations = useCallback((sess: AiSessionState) => {
    while (sess.requestIds.length > MAX_CONV_PER_SESSION) {
      const oldest = sess.requestIds[0]
      sess.requestIds = sess.requestIds.slice(1)
      reqToSessionRef.current.delete(oldest)
      const conv = { ...sess.conversations }
      delete conv[oldest]
      sess.conversations = conv
    }
  }, [])

  /** 淘汰最久未访问的会话，同步清理关联索引。 */
  const evictIfNeeded = useCallback(() => {
    if (sessionsRef.current.size <= MAX_SESSIONS) return
    const evictId = lruOrderRef.current.shift()
    if (!evictId) return
    const sess = sessionsRef.current.get(evictId)
    if (sess) {
      for (const rid of sess.requestIds) {
        reqToSessionRef.current.delete(rid)
      }
    }
    sessionsRef.current.delete(evictId)
  }, [])

  useEffect(() => {
    const handle = (event: AiEvent) => {
      const map = sessionsRef.current

      if (event.type === 'ai_session') {
        const prev = map.get(event.session_id)
        map.set(event.session_id, {
          sessionId: event.session_id,
          scopeHost: event.scope_host,
          // 后端某次事件缺 title 字段时不闪回旧值
          title: event.title ?? prev?.title,
          requestIds: event.request_ids,
          usageTotal: event.usage_total ?? EMPTY_USAGE,
          matchReason: event.match_reason,
          // 来源归属同 title：缺省时保留已确认的值
          source: event.source ?? prev?.source,
          conversations: prev?.conversations ?? {},
        })
        for (const rid of event.request_ids) {
          reqToSessionRef.current.set(rid, event.session_id)
        }
        touchLru(lruOrderRef.current, event.session_id)
        evictIfNeeded()
      } else {
        // ai_normalized：request_turns + assistant 回复拼接为完整对话
        const sid = event.session_id
        reqToSessionRef.current.set(event.id, sid)
        let sess = map.get(sid)
        if (!sess) {
          // AiNormalized 先于 AiSession 到达时的占位
          sess = {
            sessionId: sid,
            scopeHost: '',
            requestIds: [event.id],
            usageTotal: EMPTY_USAGE,
            matchReason: '',
            conversations: {},
          }
          map.set(sid, sess)
        }

        // 拼接：request_turns（历史前缀）+ assistant 回复 turns
        const rawTurns = [...(event.request_turns ?? []), ...event.conversation.turns]

        // 结构共享（内化）：与前一条请求的 turns 逐条比较，
        // 内容相同的 turn 复用旧 JS 对象，重复历史文本只存一份，
        // 单会话内存从 O(N²) 降到 O(N)。
        const prevRid = sess.requestIds.length > 0
          ? sess.requestIds[sess.requestIds.length - 1]
          : undefined
        const prevTurns = prevRid != null ? sess.conversations[prevRid]?.turns : undefined
        const turns = prevTurns
          ? rawTurns.map((t, i) =>
              i < prevTurns.length && internableTurn(t, prevTurns[i]) ? prevTurns[i] : t,
            )
          : rawTurns

        const fullConv: AiConversation = { ...event.conversation, turns }
        sess.conversations = { ...sess.conversations, [event.id]: fullConv }
        if (!sess.requestIds.includes(event.id)) {
          sess.requestIds = [...sess.requestIds, event.id]
        }
        capConversations(sess)
        touchLru(lruOrderRef.current, sid)
        evictIfNeeded()
      }
      scheduleUpdate()
    }
    return subscribeAiEvents(handle)
  }, [scheduleUpdate, evictIfNeeded, capConversations])

  const sessions = Array.from(sessionsRef.current.values())

  /**
   * 增量前缀合并时间线：按 requestIds 顺序遍历各请求的完整 turns，
   * 用 LCP（最长公共前缀）深比较去重。不依赖 internableTurn 的 JS 引用共享——
   * 即使事件乱序导致内化未命中，LCP 也保证同一 turn 不重复入列。
   *
   * 依赖后端前缀分组的不变量：同会话内后一次请求的 messages 是前一次的严格扩展，
   * 因此每个 turn 在合并结果中按内容不多不少只出现一次。
   */
  const mergedTimeline = useCallback(
    (sessionId: string): { turn: AiTurn; requestId: number }[] => {
      const sess = sessionsRef.current.get(sessionId)
      if (!sess) return []

      const result: { turn: AiTurn; requestId: number }[] = []
      for (const rid of sess.requestIds) {
        const turns = sess.conversations[rid]?.turns
        if (!turns) continue
        // LCP：跳过已存在于 result 中的前缀 turn
        let p = 0
        const max = Math.min(result.length, turns.length)
        while (p < max && sameTurn(result[p].turn, turns[p])) p++
        // 增量更新：已存在的索引位原地替换（处理流式同一 turn 内容变化）；
        // 新索引位追加。避免 push-only 导致的同 turn 多版本残留。
        for (let i = p; i < turns.length; i++) {
          if (i < result.length) {
            // internableTurn 为 true → 复用旧引用（省内存），否则用新内容+新 requestId
            if (!internableTurn(result[i].turn, turns[i])) {
              result[i] = { turn: turns[i], requestId: rid }
            }
          } else {
            result.push({ turn: turns[i], requestId: rid })
          }
        }
      }
      return result
    },
    [],
  )

  /** 前端移除整个会话（不通知后端；同会话后续新流量会让其重新出现） */
  const removeSession = useCallback((sessionId: string) => {
    const sess = sessionsRef.current.get(sessionId)
    if (!sess) return
    for (const rid of sess.requestIds) {
      reqToSessionRef.current.delete(rid)
    }
    sessionsRef.current.delete(sessionId)
    // 从 LRU 列表中移除
    const lruIdx = lruOrderRef.current.indexOf(sessionId)
    if (lruIdx !== -1) lruOrderRef.current.splice(lruIdx, 1)
    scheduleUpdate()
  }, [scheduleUpdate])

  /** 前端移除会话内单次请求；删空后连同会话一起移除 */
  const removeRequest = useCallback((sessionId: string, requestId: number) => {
    const sess = sessionsRef.current.get(sessionId)
    if (!sess) return
    reqToSessionRef.current.delete(requestId)
    const rest = sess.requestIds.filter((rid) => rid !== requestId)
    if (rest.length === 0) {
      sessionsRef.current.delete(sessionId)
      const lruIdx = lruOrderRef.current.indexOf(sessionId)
      if (lruIdx !== -1) lruOrderRef.current.splice(lruIdx, 1)
    } else {
      sess.requestIds = rest
      const conversations = { ...sess.conversations }
      delete conversations[requestId]
      sess.conversations = conversations
    }
    scheduleUpdate()
  }, [scheduleUpdate])

  /** 某请求的归一化对话 */
  const conversationOf = useCallback((requestId: number): AiConversation | undefined => {
    const sid = reqToSessionRef.current.get(requestId)
    if (!sid) return undefined
    return sessionsRef.current.get(sid)?.conversations[requestId]
  }, [])

  /** 清空所有 AI 会话（前端状态；不通知后端，同 clear 流量一致） */
  const clearAll = useCallback(() => {
    sessionsRef.current.clear()
    reqToSessionRef.current.clear()
    lruOrderRef.current = []
    scheduleUpdate()
  }, [scheduleUpdate])

  return { sessions, conversationOf, mergedTimeline, removeSession, removeRequest, clearAll }
}
