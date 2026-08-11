import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { VList, type VListHandle } from 'virtua'
import { useTranslation } from 'react-i18next'
import { ArrowDownIcon, ArrowUpIcon, RefreshCwIcon, PencilIcon, LockKeyholeIcon, LockKeyholeOpenIcon } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { CopyButton } from '@/components/core/CopyButton'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { GripDots } from '@/components/icons'
import { Empty, EmptyTitle } from '@/components/core/Empty'
import { Badge } from '@/components/ui/badge'
import type { TrafficEntry } from '@/types/proxy'
import { statusCategory, formatDuration, formatTime, formatCurl } from '@/lib/format'
import { METHOD_BG_COLORS } from '@/lib/http-constants'
import { cn } from '@/lib/utils'

const METHOD_COLOR_VAR = (method: string) => {
  const v = (METHOD_BG_COLORS as Record<string, string>)[method.toUpperCase()]
  return v ?? 'var(--badge-get)'
}

export type ListEntry = TrafficEntry
export type SortOrder = 'desc' | 'asc'
export type SortColumn = ColKey | null
type ColKey = 'id' | 'url' | 'method' | 'status' | 'duration' | 'time' | 'ssl'
const COLS: ColKey[] = ['id', 'url', 'method', 'status', 'duration', 'time', 'ssl']
const DEFAULT_WIDTHS: Record<ColKey, number> = {
  id: 9,
  url: 32,
  method: 9,
  status: 9,
  duration: 9,
  time: 15,
  ssl: 8,
}
const MIN_PCT = 5
const MAX_PCT = 40

function useColumnResize() {
  const [columnWidths, setColumnWidths] = useState<Record<ColKey, number>>(DEFAULT_WIDTHS)
  const [draggingCol, setDraggingCol] = useState<ColKey | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const liveWidths = useRef(DEFAULT_WIDTHS)
  const dragStart = useRef<{ col: ColKey; startX: number; startPct: number } | null>(null)
  if (!draggingCol) liveWidths.current = columnWidths

  const onPointerDown = useCallback((colKey: ColKey, e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingCol(colKey)
    dragStart.current = { col: colKey, startX: e.clientX, startPct: liveWidths.current[colKey] }
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current || !gridRef.current) return
    const { col, startX, startPct } = dragStart.current
    const gridWidth = gridRef.current.offsetWidth
    if (!gridWidth) return
    const deltaPct = ((e.clientX - startX) / gridWidth) * 100
    const newPct = Math.round(Math.max(MIN_PCT, Math.min(MAX_PCT, startPct + deltaPct)))
    liveWidths.current = { ...liveWidths.current, [col]: newPct }
    const template = COLS.map(c => `${liveWidths.current[c]}%`).join(' ')
    gridRef.current.style.setProperty('--grid-cols', template)
  }, [])

  const onPointerUp = useCallback(() => {
    if (!dragStart.current) return
    setColumnWidths({ ...liveWidths.current })
    setDraggingCol(null)
    dragStart.current = null
  }, [])

  const isDragging = draggingCol !== null
  return {
    gridRef,
    columnWidths,
    draggingCol,
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}

const Grip = ({
  className,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  className?: string
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
}) => (
  <span
    className={cn(
      'absolute -right-1.5 top-0 h-full w-3 flex items-center justify-center cursor-col-resize z-20 opacity-0 group-hover/grid:opacity-100 transition-opacity',
      className
    )}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}>
    <GripDots className="text-current pointer-events-none" />
  </span>
)

interface Props {
  entries: ListEntry[]
  selectedId: number | null
  onSelectEntry: (id: number) => void
  sortColumn: SortColumn
  sortOrder: SortOrder
  onSortChange: (column: SortColumn, order: SortOrder) => void
  onResendRequest: (entry: TrafficEntry) => void
  onEditRequest: (entry: TrafficEntry) => void
  /** 跳转定位：目标请求 id 与自增 nonce（由 AI 视图触发）。 */
  scrollToId?: number
  scrollNonce?: number
}

export default function RequestList({
  entries,
  selectedId,
  onSelectEntry,
  sortColumn,
  sortOrder,
  onSortChange,
  onResendRequest,
  onEditRequest,
  scrollToId,
  scrollNonce,
}: Props) {
  const { t } = useTranslation()
  const {
    gridRef,
    columnWidths,
    draggingCol,
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = useColumnResize()

  const [listKey, setListKey] = useState(0)
  const listRef = useRef<VListHandle>(null)
  const lastScrollNonce = useRef<number | undefined>(undefined)

  useEffect(() => {
    setListKey(k => k + 1)
  }, [sortColumn, sortOrder])

  // 跳转定位：滚动到目标行居中。清域名过滤等会异步改变 entries，故依赖 entries
  // 重试，直到目标行出现再消费 nonce；找不到（如流量已清空）则静默不滚动。
  useEffect(() => {
    if (scrollToId == null || scrollNonce == null) return
    if (scrollNonce === lastScrollNonce.current) return
    const idx = entries.findIndex(e => e.id === scrollToId)
    const list = listRef.current
    if (idx >= 0 && list) {
      list.scrollToIndex(idx, { align: 'center' })
      lastScrollNonce.current = scrollNonce
    }
  }, [scrollNonce, scrollToId, entries])

  const handleSortClick = useCallback(
    (col: ColKey) => {
      if (sortColumn === col) return onSortChange(col, sortOrder === 'desc' ? 'asc' : 'desc')
      onSortChange(col, 'desc')
    },
    [sortColumn, sortOrder, onSortChange]
  )

  const gridTemplate = useMemo(() => COLS.map(c => `${columnWidths[c]}%`).join(' '), [columnWidths])
  const totalColPct = useMemo(
    () => Object.values(columnWidths).reduce((s, w) => s + w, 0),
    [columnWidths]
  )
  const rowStyle = useMemo(
    () =>
      ({
        gridTemplateColumns: 'var(--grid-cols)',
        minWidth: `${totalColPct}%`,
      }) as React.CSSProperties,
    [totalColPct]
  )

  const renderHeaderCell = (col: ColKey, labelKey: string, extraClasses: string = '') => (
    <div className={`group px-2 py-1.5 text-left relative min-w-0 ${extraClasses}`}>
      <Grip
        className={
          draggingCol === col
            ? 'text-primary'
            : 'text-muted-foreground/25 hover:text-muted-foreground/70'
        }
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={e => onPointerDown(col, e)}
      />
      <span className="inline-flex items-center gap-0.5 max-w-full">
        <span className="truncate min-w-0">{t(labelKey)}</span>
        <button
          type="button"
          className={cn(
            'inline-flex items-center p-0 leading-none cursor-pointer shrink-0 transition-opacity',
            sortColumn === col
              ? 'opacity-100 text-foreground'
              : 'opacity-0 group-hover:opacity-100 text-muted-foreground'
          )}
          onClick={() => handleSortClick(col)}>
          <SortIcon column={col} active={sortColumn === col} order={sortOrder} />
        </button>
      </span>
    </div>
  )

  return (
    <div
      ref={gridRef}
      className={`h-full bg-surface-deep flex flex-col overflow-auto ${isDragging ? 'select-none' : ''}`}
      style={
        {
          cursor: isDragging ? 'col-resize' : '',
          '--grid-cols': gridTemplate,
        } as React.CSSProperties
      }>
      <div
        className="group/grid grid shrink-0 z-10 bg-surface-base/50 text-ui-xs font-bold text-muted-foreground tracking-wide border-b border-surface-elevated overflow-hidden h-7"
        style={rowStyle}>
        {renderHeaderCell('id', 'requestList.id', 'font-normal')}
        {renderHeaderCell('url', 'requestList.url')}
        {renderHeaderCell('method', 'requestList.method')}
        {renderHeaderCell('status', 'requestList.status')}
        {renderHeaderCell('duration', 'requestList.duration')}
        {renderHeaderCell('time', 'requestList.time')}
        {renderHeaderCell('ssl', 'requestList.ssl')}
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Empty>
            <EmptyTitle>{t('requestList.emptyTitle')}</EmptyTitle>
          </Empty>
        </div>
      ) : (
        <VList key={listKey} ref={listRef} className="flex-1 min-h-0">
          {entries.map((entry, i) => (
            <ContextMenu key={entry.id || i}>
              <ContextMenuTrigger>
                <div
                  className={cn(
                    'grid text-prose-md border-b border-surface-elevated/50 cursor-pointer transition-colors hover:bg-surface-elevated/50 list-item-base',
                    entry.id === selectedId && 'list-item-selected'
                  )}
                  style={{
                    ...rowStyle,
                    borderLeftWidth: 3,
                  }}
                  onClick={() => onSelectEntry(entry.id)}>
                  <div className="px-2 py-2 min-w-0 tabular-nums text-ui-xs text-muted-foreground text-left">
                    {entry.requestNumber}
                  </div>
                  <div className="px-2 py-2 text-foreground/80 font-mono min-w-0 overflow-hidden">
                    <Tooltip>
                      <TooltipTrigger className="block w-full min-w-0 text-left">
                        <span className="block truncate">{entry.uri}</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-[500px] bg-popover text-popover-foreground font-mono text-ui-sm">
                        {entry.uri}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="px-2 py-2 min-w-0 overflow-hidden whitespace-nowrap">
                    <Badge
                      className="rounded font-semibold uppercase"
                      style={{
                        color: METHOD_COLOR_VAR(entry.method),
                        background: `color-mix(in oklch, ${METHOD_COLOR_VAR(entry.method)} 10%, transparent)`,
                        borderColor: `color-mix(in oklch, ${METHOD_COLOR_VAR(entry.method)} 20%, transparent)`,
                      }}>
                      {entry.method}
                    </Badge>
                  </div>
                  <div className="px-2 py-2 min-w-0 overflow-hidden whitespace-nowrap">
                    <Badge
                      className="rounded font-semibold"
                      style={{ color: `var(--badge-${statusCategory(entry.status)})` }}>
                      {entry.status != null && (
                        <span
                          className="inline-block size-1.5 rounded-full shrink-0 bg-current"
                        />
                      )}
                      {entry.status ?? t('requestList.pending')}
                    </Badge>
                  </div>
                  <div className="px-2 py-2 min-w-0 overflow-hidden whitespace-nowrap text-muted-foreground">
                    {formatDuration(entry.durationMs)}
                  </div>
                  <div className="px-2 py-2 min-w-0 overflow-hidden whitespace-nowrap text-muted-foreground/60 text-left">
                    {formatTime(entry.requestTimestamp)}
                  </div>
                  <div className="px-2 py-2 min-w-0 overflow-hidden flex items-center justify-center">
                    {entry.decrypted === false ? (
                      <LockKeyholeIcon className="size-3.5 text-muted-foreground/70 shrink-0" />
                    ) : entry.decrypted === true ? (
                      <LockKeyholeOpenIcon className="size-3.5 text-emerald-500 shrink-0" />
                    ) : null}
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="text-xs min-w-36">
                <ContextMenuItem onClick={() => onEditRequest(entry)}>
                  <PencilIcon className="size-3.5" />
                  <span>{t('requestList.edit')}</span>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onResendRequest(entry)}>
                  <RefreshCwIcon className="size-3.5" />
                  <span>{t('requestList.repeat')}</span>
                </ContextMenuItem>
                <ContextMenuItem>
                  <CopyButton
                    text={formatCurl({ method: entry.method, url: entry.uri, headers: entry.requestHeaders, body: entry.requestBody })}
                    label={t('requestList.copyCurl')}
                    size="xs"
                    className="w-full"
                  />
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </VList>
      )}

    </div>
  )
}

function SortIcon({
  column: _c,
  active,
  order,
}: {
  column: ColKey
  active: boolean
  order: SortOrder
}) {
  if (!active) return <ArrowDownIcon className="inline size-3 shrink-0" />
  return order === 'asc' ? (
    <ArrowUpIcon className="inline size-3 shrink-0" />
  ) : (
    <ArrowDownIcon className="inline size-3 shrink-0" />
  )
}
