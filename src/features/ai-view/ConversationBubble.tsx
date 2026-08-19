import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, WrenchIcon, FileTextIcon, ExternalLinkIcon, CodeIcon, TextIcon, BrainIcon } from 'lucide-react'
import { type AiTurn, type AiContentBlock } from '@/types/ai'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { isLikelyMarkdown, isJsonObject } from '@/lib/markdown'
import { MarkdownContent } from '@/components/markdown/MarkdownContent'
import { CopyButton } from '@/components/core/CopyButton'

/** 把单个 content block 拼成可复制的纯文本 */
function blockToText(block: AiContentBlock): string {
  if (block.type === 'text') return block.text
  if (block.type === 'thinking') return `[thinking]\n${block.text}`
  if (block.type === 'tool_use') {
    let input = ''
    try { input = JSON.stringify(block.input, null, 2) } catch { input = String(block.input) }
    return `[tool_use] ${block.name}\n${input}`
  }
  if (block.type === 'tool_result') {
    return `[tool_result]\n${block.content.map(blockToText).join('\n')}`
  }
  return ''
}

/** 把整个 turn 拼成可复制的纯文本（tools_def 输出美化后的 JSON） */
function turnToText(turn: AiTurn): string {
  if (turn.role === 'tools_def') {
    const raw = turn.content[0]?.type === 'text' ? turn.content[0].text : ''
    try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
  }
  return turn.content.map(blockToText).join('\n')
}

interface ConversationBubbleProps {
  turn: AiTurn
  isStreaming: boolean
  /** 可选：标注该轮来自哪次请求（合并时间线用，如 "#2"） */
  reqLabel?: string
  /** 可选：点击跳转到代理视图定位该请求 */
  onJump?: () => void
  /** 会话级默认视图：raw 原文（默认）/ md 渲染 */
  defaultView?: 'md' | 'raw'
  /** thinking 按需取：会话 id（有值时才能取） */
  sessionId?: string
  /** thinking 按需取：请求 id */
  requestId?: number
  /** thinking 按需取：turn 的稳定 id（已定稿才有） */
  fingerprint?: number
}

/** 顶层 text block：检测命中且当前视图为 md 时走 Markdown 渲染；
 *  JSON 对象/数组自动美化，md 模式走语法高亮代码块，raw 模式走 <pre>。 */
function TextBlock({ text, showMd, inverted }: { text: string; showMd: boolean; inverted: boolean }) {
  const isMd = useMemo(() => isLikelyMarkdown(text), [text])

  // JSON 检测：仅对象/数组命中，且 >= 8 字符（排除 {}、[] 等无意义空对象）
  const formattedJson = useMemo(() => {
    const s = text.trim()
    if (s.length < 8) return null
    if (s[0] !== '{' && s[0] !== '[') return null
    try {
      const parsed = JSON.parse(s)
      if (typeof parsed === 'object' && parsed !== null) {
        return JSON.stringify(parsed, null, 2)
      }
    } catch {}
    return null
  }, [text])

  if (showMd && isMd) {
    return <MarkdownContent text={text} variant={inverted ? 'inverted' : 'default'} />
  }

  if (formattedJson) {
    if (showMd) {
      // 包裹为 fenced code block，复用 Streamdown Shiki 语法高亮
      const fence = formattedJson.includes('```') ? '````' : '```'
      return (
        <MarkdownContent
          text={`${fence}json\n${formattedJson}\n${fence}`}
          variant={inverted ? 'inverted' : 'default'}
        />
      )
    }
    // raw 模式：美化后的纯文本
    return <pre className="whitespace-pre-wrap break-words font-mono text-prose-sm">{formattedJson}</pre>
  }

  return <span>{text}</span>
}

/** 单个 content block 的渲染 */
function ContentBlock({
  block,
  showMd,
  headerActions,
  fetchedThinkingText,
  onLoadThinking,
  thinkingLoading,
}: {
  block: AiContentBlock
  showMd: boolean
  headerActions?: React.ReactNode
  /** thinking 按需取：该块对应的正文（已拉取则非空）。 */
  fetchedThinkingText?: string
  /** thinking 按需取：展开且无正文时触发拉取。 */
  onLoadThinking?: () => void
  thinkingLoading?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  if (block.type === 'text') {
    return <TextBlock text={block.text} showMd={showMd} inverted={false} />
  }

  if (block.type === 'thinking') {
    const displayText = fetchedThinkingText ?? block.text
    const isEmpty = displayText === ''
    const isMd = isLikelyMarkdown(displayText)
    return (
      <div className="mt-1.5 rounded-lg border border-sky-500/20 bg-sky-500/5 overflow-hidden">
        <button
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-ui-sm font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 transition-colors"
          onClick={() => {
            const next = !expanded
            setExpanded(next)
            if (next && isEmpty && onLoadThinking) onLoadThinking()
          }}
        >
          {expanded ? <ChevronDown className="size-3 flex-shrink-0" /> : <ChevronRight className="size-3 flex-shrink-0" />}
          <BrainIcon className="size-3 flex-shrink-0" />
          <span className="truncate flex-1">{t('aiView.thinking', '思考过程')}</span>
          <CopyButton
            text={displayText}
            size="xs"
            className="inline-flex items-center p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
          />
          {headerActions}
        </button>
        {expanded && (
          <div className="max-h-48 overflow-y-auto border-t border-sky-500/15 px-3 py-2 text-prose-sm text-foreground/70">
            {isEmpty ? (
              <span className="text-muted-foreground/60">
                {thinkingLoading
                  ? t('aiView.thinkingLoading', '加载中…')
                  : t('aiView.thinkingEmpty', '思考内容定稿后可查看')}
              </span>
            ) : showMd && isMd ? (
              <MarkdownContent text={displayText} variant="default" />
            ) : (
              <span className="whitespace-pre-wrap break-words">{displayText}</span>
            )}
          </div>
        )}
      </div>
    )
  }

  if (block.type === 'tool_use') {
    const toolUseText = `[tool_use] ${block.name}\n${JSON.stringify(block.input, null, 2)}`
    return (
      <div className="mt-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden">
        <button
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-ui-sm font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="size-3 flex-shrink-0" /> : <ChevronRight className="size-3 flex-shrink-0" />}
          <WrenchIcon className="size-3 flex-shrink-0" />
          <span className="truncate flex-1">{block.name}</span>
          <CopyButton
            text={toolUseText}
            size="xs"
            className="inline-flex items-center p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
          />
          {headerActions}
        </button>
        {expanded && (
          <pre className="max-h-48 overflow-y-auto border-t border-amber-500/15 px-3 py-2 text-prose-sm font-mono text-foreground/80 whitespace-pre-wrap break-all">{JSON.stringify(block.input, null, 2)}</pre>
        )}
      </div>
    )
  }

  if (block.type === 'tool_result') {
    const toolResultText = `[tool_result]\n${block.content.map(blockToText).join('\n')}`
    return (
      <div className="mt-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
        <button
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-ui-sm font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="size-3 flex-shrink-0" /> : <ChevronRight className="size-3 flex-shrink-0" />}
          <FileTextIcon className="size-3 flex-shrink-0" />
          <span className="truncate flex-1">tool result</span>
          <CopyButton
            text={toolResultText}
            size="xs"
            className="inline-flex items-center p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
          />
          {headerActions}
        </button>
        {expanded && (
          <div className="max-h-48 overflow-y-auto border-t border-emerald-500/15 px-3 py-2 text-prose-md">
            {block.content.map((innerBlock, i) => (
              <ContentBlock key={i} block={innerBlock} showMd={showMd} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return null
}

/** tool 角色气泡：默认折叠，展开后渲染子内容 */
function ToolTurn({ turn, showMd }: { turn: AiTurn; showMd: boolean }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 text-left text-ui-sm font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="size-3 flex-shrink-0" /> : <ChevronRight className="size-3 flex-shrink-0" />}
        <WrenchIcon className="size-3 flex-shrink-0" />
        <span>tool</span>
      </button>
      {expanded && (
        <div className="mt-1.5 border-t border-emerald-500/15 pt-1.5 text-prose-md">
          {turn.content.map((block, j) => (
            <ContentBlock key={j} block={block} showMd={showMd} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 对话气泡：role 决定对齐与配色，内部渲染 content blocks */
export function ConversationBubble({ turn, isStreaming, reqLabel, onJump, defaultView = 'raw', sessionId, requestId, fingerprint }: ConversationBubbleProps) {
  const { t } = useTranslation()
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [systemExpanded, setSystemExpanded] = useState(false)

  // md 能力：递归检测所有 text block（包括 tool_result 内部的）
  const mdCapable = useMemo(() => {
    const check = (blocks: AiContentBlock[]): boolean =>
      blocks.some((b) => {
        if (b.type === 'text') return isLikelyMarkdown(b.text) || isJsonObject(b.text)
        if (b.type === 'tool_result') return check(b.content)
        return false
      })
    return check(turn.content)
  }, [turn])
  // 气泡级覆盖：null = 跟随会话级 defaultView；会话级切换时清除覆盖
  const [override, setOverride] = useState<'md' | 'raw' | null>(null)
  useEffect(() => {
    setOverride(null)
  }, [defaultView])
  const view = override ?? defaultView
  const showMd = mdCapable && view === 'md'
  const contentRef = useRef<HTMLDivElement>(null)

  // thinking 按需取：turn 级拉取一次，按出现顺序填充各 thinking 块。
  const [thinkingTexts, setThinkingTexts] = useState<string[] | null>(null)
  const [thinkingLoading, setThinkingLoading] = useState(false)
  const loadThinking = () => {
    if (thinkingTexts !== null || thinkingLoading) return
    if (sessionId == null || requestId == null || fingerprint == null) return
    setThinkingLoading(true)
    invoke<string[]>('get_ai_thinking', { sessionId, requestId, fingerprint })
      .then((texts) => setThinkingTexts(texts))
      .catch(() => setThinkingTexts([]))
      .finally(() => setThinkingLoading(false))
  }
  const thinkingOrdinals = useMemo(() => {
    const m = new Map<number, number>()
    let n = 0
    turn.content.forEach((b, i) => {
      if (b.type === 'thinking') {
        m.set(i, n)
        n++
      }
    })
    return m
  }, [turn])

  const copyText = useMemo(() => {
    if (showMd && contentRef.current) {
      const headers = Array.from(contentRef.current.querySelectorAll<HTMLElement>('[data-streamdown="code-block-header"]'))
      headers.forEach((h) => (h.style.visibility = 'hidden'))
      const text = contentRef.current.innerText.replace(/▌\s*$/, '')
      headers.forEach((h) => (h.style.visibility = ''))
      return text
    }
    return turnToText(turn)
  }, [showMd, turn])

  // 检测是否「纯工具」气泡：只有 tool_use / tool_result，没有 text block
  const toolsOnly = useMemo(() => {
    if (turn.content.length === 0) return false
    return turn.content.every((b) => b.type === 'tool_use' || b.type === 'tool_result')
  }, [turn])

  // 内联到工具行尾部的操作按钮（复制 + 跳转代理）
  const headerActions = useMemo(() => {
    if (!toolsOnly) return undefined
    return (
      <span className="inline-flex items-center gap-0.5 ml-auto" onClick={(e) => e.stopPropagation()}>
        {onJump && (
          <Tooltip>
            <TooltipTrigger className="inline-flex">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onJump() }}
                className="inline-flex items-center p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
              >
                <ExternalLinkIcon className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
              {t('aiView.jumpToProxy', '在代理中查看')}
            </TooltipContent>
          </Tooltip>
        )}
        <CopyButton
          text={copyText}
          size="xs"
          className="inline-flex items-center p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
        />
      </span>
    )
  }, [toolsOnly, onJump, copyText, t])
  const isUser = turn.role === 'user'
  const isSystem = turn.role === 'system'
  const isToolsDef = turn.role === 'tools_def'
  const isTool = turn.role === 'tool'

  // 除 assistant（模型响应）外，system / tools_def / tool 都是客户端随请求发出的，统一靠右
  const alignClass = turn.role === 'assistant' ? 'justify-start' : 'justify-end'

  let bubbleClass: string
  if (isUser) {
    bubbleClass = 'bg-ai-user-bubble text-ai-user-bubble-text'
  } else if (isSystem) {
    bubbleClass = 'bg-surface-base/50 text-muted-foreground text-prose-md'
  } else if (isToolsDef) {
    bubbleClass = 'bg-violet-500/5 border border-violet-500/15 text-foreground'
  } else if (isTool) {
    bubbleClass = 'bg-emerald-500/5 border border-emerald-500/15 text-foreground'
  } else {
    bubbleClass = 'bg-background text-foreground'
  }

  /** 获取 system turn 纯文本（用于折叠标题） */
  const systemPreview = isSystem
    ? turn.content[0]?.type === 'text'
      ? turn.content[0].text.slice(0, 60) + (turn.content[0].text.length > 60 ? '...' : '')
      : 'system'
    : ''

  return (
    <div className={`group flex ${alignClass}`}>
      <div className={`relative max-w-[80%] rounded-xl px-4 py-2.5 text-prose-xl ${bubbleClass}`}>
        {!toolsOnly && (
          <CopyButton
            text={copyText}
            size="sm"
            className={`absolute top-1.5 right-1.5 z-10 rounded-md p-1 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity cursor-pointer ${
              isUser
                ? 'text-white/80 hover:bg-white/15'
                : 'text-muted-foreground bg-surface-base/40 hover:bg-surface-base/80'
            }`}
          />
        )}
        {mdCapable && !toolsOnly && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOverride(view === 'md' ? 'raw' : 'md')
            }}
            className={`absolute top-1.5 right-8 z-10 rounded-md p-1 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity cursor-pointer ${
              isUser ? 'text-white/80 hover:bg-white/15' : 'text-muted-foreground bg-surface-base/40 hover:bg-surface-base/80'
            }`}
          >
            {view === 'md' ? <CodeIcon className="size-3.5" /> : <TextIcon className="size-3.5" />}
          </button>
        )}
        {!toolsOnly && (reqLabel || onJump) && (
          <div className={`mb-1 flex items-center gap-1 text-ui-2xs font-mono ${isUser ? 'text-white/60' : 'text-muted-foreground/50'}`}>
            {reqLabel && <span>{reqLabel}</span>}
            {onJump && (
              <button
                type="button"
                title={t('aiView.jumpToProxy', '在代理中查看')}
                onClick={(e) => { e.stopPropagation(); onJump() }}
                className="inline-flex items-center opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
              >
                <ExternalLinkIcon className="size-3" />
              </button>
            )}
          </div>
        )}
        {/* system 特殊渲染：可折叠 */}
        {isSystem ? (
          <div>
            <button
              className="flex w-full items-center gap-1.5 text-left text-ui-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setSystemExpanded(!systemExpanded)}
            >
              {systemExpanded ? <ChevronDown className="size-3 flex-shrink-0" /> : <ChevronRight className="size-3 flex-shrink-0" />}
              <span className="italic">💬 {systemPreview}</span>
            </button>
            {systemExpanded && (
              <div ref={contentRef} className="mt-1.5 border-t border-border/30 pt-1.5 text-prose-md whitespace-pre-wrap break-words">
                {turn.content.map((block, j) => (
                  block.type === 'text' ? <TextBlock key={j} text={block.text} showMd={showMd} inverted={false} /> : <ContentBlock key={j} block={block} showMd={showMd} />
                ))}
              </div>
            )}
          </div>
        ) : isToolsDef ? (
          /* tools_def 特殊渲染：可折叠的工具列表 */
          <div>
            {(() => {
              const toolsText = turn.content[0]?.type === 'text' ? turn.content[0].text : ''
              let toolCount = 0
              let parsed: any[] | null = null
              if (toolsText) {
                try { parsed = JSON.parse(toolsText); toolCount = Array.isArray(parsed) ? parsed.length : 0 } catch {}
              }
              return (
                <button
                  className="flex w-full items-center gap-1.5 text-left text-ui-sm font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 transition-colors"
                  onClick={() => setToolsExpanded(!toolsExpanded)}
                >
                  {toolsExpanded ? <ChevronDown className="size-3 flex-shrink-0" /> : <ChevronRight className="size-3 flex-shrink-0" />}
                  <span>🔩 Tools{toolCount > 0 ? ` (${toolCount})` : ''}</span>
                </button>
              )
            })()}
            {/*
              tools_def 折叠后展示：text block 走 TextBlock（让工具描述也享受 md），
              完整 JSON 格式化展示保持纯文本不动
            */}
            {toolsExpanded && (() => {
              const toolsText = turn.content[0]?.type === 'text' ? turn.content[0].text : ''
              let formatted = toolsText
              try { formatted = JSON.stringify(JSON.parse(toolsText), null, 2) } catch {}
              return (
                <div ref={contentRef} className="mt-1.5 max-h-64 overflow-y-auto border-t border-violet-500/15 pt-1.5">
                  {turn.content.map((block, j) =>
                    block.type === 'text' ? (
                      <TextBlock key={j} text={block.text} showMd={showMd} inverted={false} />
                    ) : (
                      <ContentBlock key={j} block={block} showMd={showMd} />
                    ),
                  )}
                  <details className="mt-1">
                    <summary className="text-ui-xs text-muted-foreground/60 cursor-pointer">查看原始 JSON</summary>
                    <pre className="mt-1 text-prose-xs font-mono text-foreground/70 whitespace-pre-wrap break-all">{formatted}</pre>
                  </details>
                </div>
              )
            })()}
          </div>
        ) : isTool ? (
          /* tool 特殊渲染：默认折叠，展开后才渲染子内容 */
          <ToolTurn turn={turn} showMd={showMd} />
        ) : (
          <div ref={contentRef}>
            {turn.content.map((block, j) => {
              if (block.type === 'text') {
                return <TextBlock key={j} text={block.text} showMd={showMd} inverted={isUser} />
              }
              if (block.type === 'thinking') {
                const ordinal = thinkingOrdinals.get(j) ?? 0
                return (
                  <ContentBlock
                    key={j}
                    block={block}
                    showMd={showMd}
                    headerActions={j === 0 ? headerActions : undefined}
                    fetchedThinkingText={thinkingTexts?.[ordinal]}
                    onLoadThinking={loadThinking}
                    thinkingLoading={thinkingLoading}
                  />
                )
              }
              return <ContentBlock key={j} block={block} showMd={showMd} headerActions={j === 0 ? headerActions : undefined} />
            })}
            {isStreaming && turn.role === 'assistant' && (
              <span className="animate-pulse">▌</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

