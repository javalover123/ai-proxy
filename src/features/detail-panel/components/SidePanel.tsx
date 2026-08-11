import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatBodySize } from '@/lib/format'

export type PanelTab = 'header' | 'query' | 'body' | 'raw' | 'form' | 'stream' | 'cookies' | 'console'

export interface TabDef {
  id: PanelTab
  labelKey: string
}

export default function SidePanel({
  title,
  tab,
  onTabChange,
  tabs,
  children,
  onTitleClick,
  bodySize,
  actions,
  tabCounts,
}: {
  title: string
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  tabs: TabDef[]
  children: ReactNode
  onTitleClick?: () => void
  /** body 字节数，用于标题右侧展示，如 "Response (2.4 KB)"。nil / 0 时不展示。 */
  bodySize?: number | null
  /** 标签栏右侧的操作按钮插槽（如 "Copy for AI"） */
  actions?: ReactNode
  /** tab 计数，key 为 tab id，值为数量（null 表示不显示，0 表示有但为零时不显示） */
  tabCounts?: Partial<Record<PanelTab, number | null>>
}) {
  const { t } = useTranslation()
  const sizeLabel = formatBodySize(bodySize)

  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as PanelTab)} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-0 border-b border-surface-elevated overflow-hidden">
        {onTitleClick ? (
          <span
              onClick={onTitleClick}
              className="px-3 py-1.5 text-xs font-medium text-foreground cursor-pointer hover:bg-surface-elevated/50 rounded transition-colors whitespace-nowrap shrink-0"
            >
              {title}
              {sizeLabel && <span className="ml-0.5 text-muted-foreground font-normal">({sizeLabel})</span>}
            </span>
          ) : (
          <span className="px-3 py-1.5 text-xs font-medium text-foreground whitespace-nowrap shrink-0">
            {title}
            {sizeLabel && <span className="ml-0.5 text-muted-foreground font-normal">({sizeLabel})</span>}
          </span>
        )}
        <TabsList variant="line" className="px-0 rounded-none bg-transparent h-auto min-w-0 overflow-x-auto overflow-y-hidden">
          {tabs.map(x => (
            <TabsTrigger key={x.id} value={x.id} className="relative px-2.5 py-1.5 text-ui-sm whitespace-nowrap">
              {t(x.labelKey)}
              {tabCounts?.[x.id] != null && tabCounts[x.id]! > 0 && (
                <span className="ml-1 text-ui-2xs text-emerald-400 dark:text-emerald-300 tabular-nums">({tabCounts[x.id]})</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {actions && (
          <div className="ml-auto flex shrink-0 items-center pr-1.5">
            {actions}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </Tabs>
  )
}
