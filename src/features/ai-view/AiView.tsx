import { SparklesIcon, ArrowUpIcon, ArrowDownIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { AiSidebar, type AiSelection } from './AiSidebar'
import { ConversationBubble } from './ConversationBubble'
import { ToolFilterBar } from './ToolFilterBar'
import { ToolCallCard, type ToolCallEntry } from './ToolCallCard'
import type { ToolFilterItem } from './ToolFilterBar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { usePanelRef } from 'react-resizable-panels'
import { formatDayTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AiRequestMeta, AiTurn, AiContentBlock, TimelineItem } from '@/types/ai'
import { useAiSessions } from '@/hooks/useAiSessions'

// ─── 工具调用提取 / 配对 ───────────────────────────────────────────

/** 从 tool_result 的 content blocks 中提取纯文本 */
function toolResultText(blocks: AiContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/** 构建 tool_use_id → 结果文本 的映射 */
function buildResultMap(rendered: { turn: AiTurn; requestId: number }[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const { turn } of rendered) {
    for (const block of turn.content) {
      if (block.type === 'tool_result') {
        m.set(block.tool_use_id, toolResultText(block.content))
      }
    }
  }
  return m
}

/** 去重工具集合：从已渲染的 turn 中收集所有 tool_use 的名称和出现次数 */
function collectToolItems(
  rendered: { turn: AiTurn; requestId: number }[],
): ToolFilterItem[] {
  const counts = new Map<string, number>()
  for (const { turn } of rendered) {
    for (const block of turn.content) {
      if (block.type === 'tool_use') {
        counts.set(block.name, (counts.get(block.name) ?? 0) + 1)
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([toolName, count]) => ({ toolName, count }))
}

// ─── 渲染：全部 气泡时间线 ─────────────────────────────────────────

function renderConversation(
  rendered: TimelineItem[],
  selection: AiSelection,
  reqIndex: Map<number, number>,
  isStreamingReq: (requestId: number) => boolean,
  mdSessions: Record<string, boolean>,
  onJumpToProxy: ((requestId: number) => void) | undefined,
  t: ReturnType<typeof useTranslation>['t'],
  requestMetaOf: (requestId: number) => AiRequestMeta | undefined,
): ReactNode {
  if (rendered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('aiView.waiting', '等待归一化数据…')}
      </div>
    )
  }
  let prevRequestId: number | undefined
  let prevTime: string | undefined
  return rendered.map(({ turn, requestId, fingerprint }, i) => {
    const idx = reqIndex.get(requestId)
    const showLabel = !selection.requestId && idx != null
    const isLast = i === rendered.length - 1
    const isNewRequest = requestId !== prevRequestId
    prevRequestId = requestId
    const ts = isNewRequest ? requestMetaOf(requestId)?.startMs : undefined
    const timeLabel = ts != null ? formatDayTime(ts) : undefined
    const showTime = timeLabel != null && timeLabel !== prevTime
    if (timeLabel != null) prevTime = timeLabel
    return (
      <div key={`${selection.sessionId}:${selection.requestId ?? 'all'}:${i}`}>
        {showTime && (
          <div className="mb-1 text-center text-ui-sm tabular-nums text-muted-foreground/70">
            {timeLabel}
          </div>
        )}
        <ConversationBubble
          turn={turn}
          isStreaming={turn.role === 'assistant' && isLast && isStreamingReq(requestId)}
          reqLabel={showLabel ? t('aiSidebar.turnLabel', '轮次 {{n}}', { n: idx }) : undefined}
          onJump={onJumpToProxy ? () => onJumpToProxy(requestId) : undefined}
          defaultView={mdSessions[selection.sessionId] ? 'md' : 'raw'}
          sessionId={selection.sessionId}
          requestId={requestId}
          fingerprint={fingerprint}
        />
      </div>
    )
  })
}

// ─── 渲染：纯对话（移除所有 tool_use / tool_result / tool turn） ────

/** 从 turn 移除 tool_use / tool_result / thinking block，保留纯文本 */
function stripToolBlocks(turn: AiTurn): AiTurn | null {
  if (turn.role === 'tool') return null
  if (turn.content.length > 0 && turn.content.every((b) => b.type === 'tool_result')) return null

  const filtered = turn.content.filter(
    (b) => b.type === 'text' || b.type === 'thinking',
  )
  if (filtered.length === 0) return null

  if (turn.role === 'assistant') {
    return { role: 'assistant', content: filtered }
  }
  return { ...turn, content: filtered }
}

function renderNoTools(
  rendered: TimelineItem[],
  selection: AiSelection,
  reqIndex: Map<number, number>,
  isStreamingReq: (requestId: number) => boolean,
  mdSessions: Record<string, boolean>,
  onJumpToProxy: ((requestId: number) => void) | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): ReactNode {
  const items: ReactNode[] = []
  for (let i = 0; i < rendered.length; i++) {
    const { turn, requestId, fingerprint } = rendered[i]
    const stripped = stripToolBlocks(turn)
    if (!stripped) continue

    const idx = reqIndex.get(requestId)
    const showLabel = !selection.requestId && idx != null
    const isLast = i === rendered.length - 1
    items.push(
      <div key={`nt-${selection.sessionId}:${i}`}>
        <ConversationBubble
          turn={stripped}
          isStreaming={stripped.role === 'assistant' && isLast && isStreamingReq(requestId)}
          reqLabel={showLabel ? t('aiSidebar.turnLabel', '轮次 {{n}}', { n: idx }) : undefined}
          onJump={onJumpToProxy ? () => onJumpToProxy(requestId) : undefined}
          defaultView={mdSessions[selection.sessionId] ? 'md' : 'raw'}
          sessionId={selection.sessionId}
          requestId={requestId}
          fingerprint={fingerprint}
        />
      </div>,
    )
  }
  return items.length > 0 ? items : (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {t('aiView.waiting', '等待归一化数据…')}
    </div>
  )
}

// ─── 渲染：工具卡片（按选中的工具名集合） ────────────────────────────

function renderToolCards(
  rendered: { turn: AiTurn; requestId: number }[],
  selectedTools: Set<string>,
  reqIndex: Map<number, number>,
  _mdSessions: Record<string, boolean>,
  onJumpToProxy: ((requestId: number) => void) | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): ReactNode {
  const resultMap = buildResultMap(rendered)
  const items: ReactNode[] = []

  for (const { turn, requestId } of rendered) {
    if (turn.role !== 'assistant') continue

    const toolsInTurn = turn.content.filter((b) => b.type === 'tool_use')
    const totalToolsInTurn = toolsInTurn.length
    let toolIdx = 0

    for (const block of turn.content) {
      if (block.type !== 'tool_use') continue
      toolIdx++
      if (!selectedTools.has(block.name)) continue

      const result = resultMap.get(block.id) ?? null
      const resultLines = result ? result.split('\n').length : 0
      const entry: ToolCallEntry = {
        requestId,
        stepIndex: toolIdx,
        stepTotal: totalToolsInTurn,
        toolName: block.name,
        input: block.input,
        result,
        resultLines,
      }

      const idx = reqIndex.get(requestId) ?? 0
      items.push(
        <ToolCallCard
          key={`card-${requestId}-${block.id}`}
          entry={entry}
          reqLabel={t('aiSidebar.turnLabel', '轮次 {{n}}', { n: idx })}
          defaultExpanded
          onJump={onJumpToProxy ? () => onJumpToProxy(requestId) : undefined}
        />,
      )
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('aiView.toolCallsSummary', '{{count}} call(s) · {{reqs}} request(s)', { count: 0, reqs: 0 })}
      </div>
    )
  }

  items.push(
    <div key="summary" className="text-center text-ui-2xs text-muted-foreground pt-1 pb-2 border-t border-dashed border-border/50 mx-3">
      {t('aiView.toolCallsSummary', '{{count}} call(s) · {{reqs}} request(s)', {
        count: items.length - 1,
        reqs: new Set(rendered
          .filter(({ turn }) => turn.role === 'assistant' && turn.content.some((b) => b.type === 'tool_use' && selectedTools.has(b.name)))
          .map(({ requestId }) => requestId),
        ).size,
      })}
    </div>,
  )

  return items
}

// ─── 组件 ───────────────────────────────────────────────────────────

interface AiViewProps {
  showSidebar: boolean
  /** 清空流量信号：值递增时联动清空 AI 会话（仅前端移除） */
  clearNonce: number
  /** 点击气泡的跳转钮 → 切到代理视图并定位该请求。 */
  onJumpToProxy?: (requestId: number) => void
  /** 右键复制该轮对应请求的 cURL（使用代理记录的原始请求数据） */
  onCopyCurl?: (requestId: number) => void
  /** 右键导入到新请求编辑器 */
  onImportToEditor?: (requestId: number) => void
}

export function AiView({ showSidebar, clearNonce, onJumpToProxy, onCopyCurl, onImportToEditor }: AiViewProps) {
  const { t } = useTranslation()
  const { sessions, mergedTimeline, requestMetaOf, removeSession, removeRequest, clearAll } = useAiSessions()
  const [selection, setSelection] = useState<AiSelection | null>(null)
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const [isNoTools, setIsNoTools] = useState(false)

  // 会话级 md 渲染开关
  const [mdSessions, setMdSessions] = useState<Record<string, boolean>>({})
  const toggleMdSession = useCallback((sessionId: string) => {
    setMdSessions((prev) => ({ ...prev, [sessionId]: !prev[sessionId] }))
  }, [])

  const aiSidebarPanelRef = usePanelRef()
  useEffect(() => {
    const panel = aiSidebarPanelRef.current
    if (!panel) return
    if (showSidebar) panel.resize('22%')
    else panel.collapse()
  }, [showSidebar])

  const selectedSession = useMemo(
    () => (selection ? sessions.find((s) => s.sessionId === selection.sessionId) ?? null : null),
    [selection, sessions],
  )

  const handleDeleteSession = useCallback((sessionId: string) => {
    removeSession(sessionId)
    setSelection((sel) => (sel?.sessionId === sessionId ? null : sel))
  }, [removeSession])

  const handleDeleteRequest = useCallback((sessionId: string, requestId: number) => {
    const remaining = sessions.find((s) => s.sessionId === sessionId)?.requestIds.filter((rid) => rid !== requestId).length ?? 0
    removeRequest(sessionId, requestId)
    setSelection((sel) => {
      if (sel?.sessionId !== sessionId) return sel
      if (remaining === 0) return null
      return sel.requestId === requestId ? { sessionId } : sel
    })
  }, [removeRequest, sessions])

  // 清空流量信号 → 联动清空 AI 会话（仅前端移除，不通知后端）
  const prevClearNonceRef = useRef(clearNonce)
  useEffect(() => {
    if (clearNonce !== prevClearNonceRef.current) {
      prevClearNonceRef.current = clearNonce
      clearAll()
    }
  }, [clearNonce, clearAll])

  const reqIndex = useMemo(() => {
    const m = new Map<number, number>()
    selectedSession?.requestIds.forEach((rid, i) => m.set(rid, i + 1))
    return m
  }, [selectedSession])

  const rendered = useMemo<TimelineItem[]>(() => {
    if (!selection || !selectedSession) return []
    const tl = mergedTimeline(selection.sessionId)
    const requestId = selection.requestId
    if (requestId) {
      // 单次请求视图：显示截至该请求完成时的累计时间线。
      // 时间线按 requestId 单调递增排列，取 <= 目标值的所有条目。
      return tl.filter((e) => e.requestId <= requestId)
    }
    return tl
  }, [selection, selectedSession, mergedTimeline])

  const toolItems = useMemo(() => collectToolItems(rendered), [rendered])

  // 切换会话/请求时清除工具筛选
  useEffect(() => {
    setSelectedTools(new Set())
    setIsNoTools(false)
  }, [selection])

  const isStreamingReq = (requestId: number): boolean =>
    requestMetaOf(requestId)?.streaming ?? false

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const [atTop, setAtTop] = useState(true)
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    stickToBottom.current = true
    setAtTop(true)
    setAtBottom(true)
  }, [selection])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [rendered, selectedTools, isNoTools])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAtTop(el.scrollTop < 4)
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 4)
  }, [])

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const handleToggleAll = useCallback(() => {
    setSelectedTools(new Set())
    setIsNoTools(false)
  }, [])

  const handleToggleNoTools = useCallback(() => {
    if (isNoTools) {
      setIsNoTools(false)
    } else {
      setIsNoTools(true)
      setSelectedTools(new Set())
    }
  }, [isNoTools])

  const handleToggleTool = useCallback((toolName: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev)
      if (next.has(toolName)) {
        next.delete(toolName)
      } else {
        next.add(toolName)
      }
      return next
    })
    setIsNoTools(false)
  }, [])

  const isAll = !isNoTools && selectedTools.size === 0

  return (
    <>
    <ResizablePanelGroup orientation="horizontal" className="h-full bg-surface-deep">
      <ResizablePanel id="ai-sidebar" defaultSize="22%" minSize="15%" maxSize="40%" collapsible collapsedSize={0} panelRef={aiSidebarPanelRef}>
        <div className="h-full overflow-hidden">
          <AiSidebar sessions={sessions} selection={selection} onSelect={setSelection} onDeleteSession={handleDeleteSession} onDeleteRequest={handleDeleteRequest} onCopyCurl={onCopyCurl} onImportToEditor={onImportToEditor} mdSessions={mdSessions} onToggleMd={toggleMdSession} />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel id="ai-main" defaultSize="78%" minSize="60%">
        {selection && selectedSession ? (
          <div className="flex h-full flex-col">
            {toolItems.length > 0 && (
              <ToolFilterBar
                items={toolItems}
                selectedTools={selectedTools}
                isNoTools={isNoTools}
                onToggleAll={handleToggleAll}
                onToggleNoTools={handleToggleNoTools}
                onToggleTool={handleToggleTool}
              />
            )}
            <div className="relative flex-1 group/chat min-h-0">
            <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto space-y-3 p-4">
              {isAll
                ? renderConversation(rendered, selection, reqIndex, isStreamingReq, mdSessions, onJumpToProxy, t, requestMetaOf)
                : isNoTools
                ? renderNoTools(rendered, selection, reqIndex, isStreamingReq, mdSessions, onJumpToProxy, t)
                : renderToolCards(rendered, selectedTools, reqIndex, mdSessions, onJumpToProxy, t)
              }
            </div>

            {/* 滚到底部 — 右上角，hover 可见 */}
            <div
              className={cn(
                'absolute right-3 top-3 z-10 transition-opacity',
                atBottom ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover/chat:opacity-100 hover:!opacity-100',
              )}
            >
              <button
                type="button"
                onClick={scrollToBottom}
                className="flex items-center justify-center size-8 rounded-full bg-popover/90 border border-border shadow-md text-muted-foreground hover:text-foreground hover:bg-popover transition-colors cursor-pointer"
              >
                <ArrowDownIcon className="size-4" />
              </button>
            </div>

            {/* 滚到顶部 — 右下角，hover 可见 */}
            <div
              className={cn(
                'absolute right-3 bottom-3 z-10 transition-opacity',
                atTop ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover/chat:opacity-100 hover:!opacity-100',
              )}
            >
              <button
                type="button"
                onClick={scrollToTop}
                className="flex items-center justify-center size-8 rounded-full bg-popover/90 border border-border shadow-md text-muted-foreground hover:text-foreground hover:bg-popover transition-colors cursor-pointer"
              >
                <ArrowUpIcon className="size-4" />
              </button>
            </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-deep text-muted-foreground">
            <SparklesIcon className="size-12 text-muted-foreground/30" />
            <p className="text-sm font-medium">{t('view.aiComingSoon', '选中 AI 会话查看对话预览')}</p>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
    </>
  )
}
