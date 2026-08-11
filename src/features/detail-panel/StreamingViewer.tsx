import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, ListChecks } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { CopyButton } from '@/components/core/CopyButton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Empty, EmptyTitle } from '@/components/core/Empty'
import type { TrafficEntry } from '@/types/proxy'
import { parseSse, isStreamingContentType, mergeSseMessages, estimateTokens, extractTokenUsage, type SseEvent, type MergeFormat, type MergeResult, type TokenUsage } from '@/lib/sse'


type ViewMode = 'chunks' | 'events' | 'merged'

interface Props {
  entry: TrafficEntry
  onClose?: () => void
}

const MERGE_FORMATS: { value: MergeFormat; labelKey: string }[] = [
  { value: 'openai', labelKey: 'detail.mergeFormatOpenai' },
  { value: 'anthropic', labelKey: 'detail.mergeFormatAnthropic' },
]

export default function StreamingViewer({ entry }: Props) {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewMode>('chunks')
  const [mergeFormat, setMergeFormat] = useState<MergeFormat>('openai')

  const isSse = isStreamingContentType(entry.responseHeaders)
  const chunks = entry.responseChunks ?? []

  const sseEvents = useMemo(() => {
    const body = chunks.join('')
    if (!isSse || !body) return []
    return parseSse(body)
  }, [isSse, chunks])

  const mergedResult = useMemo(() => {
    if (!isSse || sseEvents.length === 0) return null
    return mergeSseMessages(sseEvents, mergeFormat)
  }, [isSse, sseEvents, mergeFormat])

  const tokenUsage = useMemo(() => {
    if (!isSse) return null
    return extractTokenUsage(sseEvents)
  }, [isSse, sseEvents])

  const chunkStats = useMemo(() => {
    let totalBytes = 0
    for (const c of chunks) totalBytes += c.length
    return { count: chunks.length, totalBytes }
  }, [chunks])

  const hasMerged = mergedResult !== null && mergedResult.content.length > 0

  const tabValue = view

  return (
    <Tabs value={tabValue} onValueChange={(v) => setView(v as ViewMode)} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabsList variant="line" className="sticky top-0 z-10 shrink-0 justify-start border-b border-surface-elevated bg-surface-base px-0 rounded-none">
        <Tooltip>
          <TooltipTrigger className="inline-flex">
            <TabsTrigger
              value="chunks"
              className="text-ui-sm"
            >
              {t('detail.streamChunks')}
            </TabsTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
            {chunkStats.count} {t('detail.streamChunks')} · {chunkStats.totalBytes} B
          </TooltipContent>
        </Tooltip>
        {isSse && (
          <Tooltip>
            <TooltipTrigger className="inline-flex">
              <TabsTrigger
                value="events"
                className="text-ui-sm"
              >
                {t('detail.streamEvents')}
              </TabsTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
              {sseEvents.length} {t('detail.streamEvents')}
            </TooltipContent>
          </Tooltip>
        )}
        {isSse && hasMerged && (
          <Tooltip>
            <TooltipTrigger className="inline-flex">
              <TabsTrigger
                value="merged"
                className="text-ui-sm"
              >
                {t('detail.streamMerged')}
              </TabsTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
              {mergedResult!.eventCount} {t('detail.streamEvents')} → {t('detail.streamMerged')}
            </TooltipContent>
          </Tooltip>
        )}
        {/* 合并选项：选中合并 Tab 时显示在同一行 */}
        {view === 'merged' && hasMerged && (
          <div className="ml-auto flex items-center gap-1.5 px-2">
            <span className="flex items-center gap-1 text-ui-xs text-muted-foreground/60">
              <ListChecks className="size-2.5" />
            </span>
            <select
              value={mergeFormat}
              onChange={(e) => setMergeFormat(e.target.value as MergeFormat)}
              className="rounded border-b border-surface-elevated/50 bg-transparent px-1.5 py-0.5 text-ui-xs text-foreground outline-none focus:border-primary"
            >
              {MERGE_FORMATS.map((fmt) => (
                <option key={fmt.value} value={fmt.value}>
                  {t(fmt.labelKey)}
                </option>
              ))}
            </select>
            <span className="text-ui-xs text-muted-foreground/50 tabular-nums">
              {sseEvents.length} · {mergedResult!.content.length} B
            </span>
          </div>
        )}
      </TabsList>

      <TabsContent value="chunks" className="mt-0">
        {chunks.length === 0 ? (
          <Empty><EmptyTitle>{t('detail.noStreamData')}</EmptyTitle></Empty>
        ) : (
          chunks.map((chunk, idx) => (
            <ChunkItem key={idx} index={idx} data={chunk} />
          ))
        )}
      </TabsContent>

      <TabsContent value="events" className="mt-0">
        {sseEvents.length === 0 ? (
          <Empty><EmptyTitle>{t('detail.noSseEvents')}</EmptyTitle></Empty>
        ) : (
          sseEvents.map((evt, idx) => <SseEventItem key={idx} index={idx} event={evt} />)
        )}
      </TabsContent>

      <TabsContent value="merged" className="mt-0">
        {mergedResult ? (
          <MergedView result={mergedResult} tokenUsage={tokenUsage} />
        ) : (
          <Empty><EmptyTitle>{t('detail.noSseEvents')}</EmptyTitle></Empty>
        )}
      </TabsContent>
    </Tabs>
  )
}

// -------------------------------------------------------------------
// MergedView — 合并消息展示
// -------------------------------------------------------------------
function MergedView({ result, tokenUsage }: { result: MergeResult; tokenUsage: TokenUsage | null }) {
  const { t } = useTranslation()
  const estTokens = useMemo(() => estimateTokens(result.content), [result.content])

  return (
    <div className="flex flex-col h-full">
      <div className="relative min-h-0 flex-1 group">
        <Tooltip>
          <TooltipTrigger className="absolute right-1.5 top-1.5 z-10">
            <CopyButton
              text={result.formatted}
              size="sm"
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50 transition-all"
            />
          </TooltipTrigger>
          <TooltipContent side="left" className="bg-popover text-popover-foreground text-ui-sm">
            {t('detail.copyUri')}
          </TooltipContent>
        </Tooltip>
        {/* Token — 右下角固定 */}
        <div className="absolute bottom-1.5 right-2 z-10 flex items-center gap-1.5 rounded bg-background/70 px-1.5 py-0.5 text-ui-xs text-muted-foreground/60 tabular-nums backdrop-blur-sm select-none">
          <span>
            {tokenUsage?.totalTokens != null ? tokenUsage.totalTokens : '\u2248' + estTokens} tokens
          </span>
          {tokenUsage?.totalTokens == null && <span className="text-muted-foreground/40">（估）</span>}
          {tokenUsage?.cachedTokens != null && tokenUsage.cachedTokens > 0 && (
            <>
              <span className="text-muted-foreground/20 mx-0.5">|</span>
              <span className="text-emerald-600 dark:text-emerald-400">缓存读 {tokenUsage.cachedTokens}</span>
            </>
          )}
          {tokenUsage?.cacheCreationTokens != null && tokenUsage.cacheCreationTokens > 0 && (
            <>
              <span className="text-muted-foreground/20 mx-0.5">|</span>
              <span className="text-emerald-600 dark:text-emerald-400">缓存写 {tokenUsage.cacheCreationTokens}</span>
            </>
          )}
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 pb-7 font-mono text-prose-md leading-6 text-foreground/80">{result.formatted}</pre>
      </div>
    </div>
  )
}

// -------------------------------------------------------------------
// ChunkItem
// -------------------------------------------------------------------
function ChunkItem({
  index,
  data,
}: {
  index: number
  data: string
}) {
  const [expanded, setExpanded] = useState(false)
  const trimmed = data.replace(/\n$/, '')
  // Detect [DONE] marker
  const isDone = trimmed.trim() === '[DONE]'

  return (
    <div
      className={`border-b border-surface-elevated/30 transition-colors hover:bg-surface-elevated/10 ${
        isDone ? 'opacity-60' : ''
      }`}>
      {/* Summary line */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-start gap-1.5 px-3 py-1.5 text-left text-prose-md">
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground/60" />
        )}
        <span className="shrink-0 font-medium text-foreground/80">#{index + 1}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{data.length} B</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground/70 font-mono">
          {trimmed.slice(0, 120)}
          {trimmed.length > 120 ? '...' : ''}
        </span>
        {isDone && (
          <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-ui-xs font-medium text-amber-600 dark:text-amber-400">
            [DONE]
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-2 pl-9">
          <ChunkContent data={data} />
        </div>
      )}
    </div>
  )
}

// -------------------------------------------------------------------
// ChunkContent — 显示带复制功能的 chunk 内容
// -------------------------------------------------------------------
function ChunkContent({ data }: { data: string }) {

  return (
    <div className="group relative">
      <span className="absolute right-1 top-1 z-10 opacity-0 group-hover:opacity-100 transition-all">
        <CopyButton
          text={data}
          size="xs"
          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50"
        />
      </span>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded px-3 py-2 font-mono text-prose-sm leading-5 text-foreground/80">{data}</pre>
    </div>
  )
}

// -------------------------------------------------------------------
// SseEventItem
// -------------------------------------------------------------------
function SseEventItem({ index, event }: { index: number; event: SseEvent }) {

  const [expanded, setExpanded] = useState(false)
  const formattedData = useMemo(() => {
    try {
      const parsed = JSON.parse(event.data)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return event.data
    }
  }, [event.data])

  // Detect [DONE] marker
  const isDone = event.data.trim() === '[DONE]'

  return (
    <div
      className={`border-b border-surface-elevated/30 transition-colors hover:bg-surface-elevated/5 ${
        isDone ? 'opacity-50' : ''
      }`}>
      {/* Summary line */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-start gap-1.5 px-3 py-1.5 text-left text-prose-md">
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground/60" />
        )}
        <span className="shrink-0 font-medium text-foreground/80">#{index + 1}</span>
        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-ui-xs font-medium text-foreground">
          {event.event}
        </span>
        {event.id && (
          <span className="shrink-0 text-muted-foreground/70 font-mono tabular-nums">
            id: {event.id}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-muted-foreground/50 font-mono">
          {isDone ? '[DONE]' : event.data.slice(0, 80) + (event.data.length > 80 ? '...' : '')}
        </span>
        {!isDone && event.data.length > 80 && (
          <span className="shrink-0 text-muted-foreground/40 text-ui-xs">
            {event.data.length} B
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && !isDone && (
        <div className="group relative px-3 pb-2 pl-9">
          <span className="absolute right-1 top-1 z-10 opacity-0 group-hover:opacity-100 transition-all">
            <CopyButton
              text={event.data}
              size="xs"
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50"
            />
          </span>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded px-3 py-1 font-mono text-prose-sm leading-5 text-foreground/80">{formattedData}</pre>
        </div>
      )}
    </div>
  )
}
