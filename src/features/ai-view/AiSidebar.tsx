import {
  BarChart3Icon,
  ChevronDown,
  ChevronRight,
  CodeIcon,
  MessageSquareIcon,
  SquareArrowOutUpRightIcon,
  TerminalIcon,
  TextIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import i18n from "@/i18n";
import { formatDuration, formatTokenCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AiSessionState, AiUsage } from "@/types/ai";

import { TokenValue } from "./TokenValue";
import { UsageStatsDialog } from "./UsageStatsDialog";

/** 选中项：仅 sessionId = 选中会话头（合并时间线）；带 requestId = 选中单次请求 */
export interface AiSelection {
  sessionId: string;
  requestId?: number;
}

interface AiSidebarProps {
  sessions: AiSessionState[];
  selection: AiSelection | null;
  onSelect: (sel: AiSelection) => void;
  onDeleteSession: (sessionId: string) => void;
  onDeleteRequest: (sessionId: string, requestId: number) => void;
  /** 复制该请求的 cURL（右键菜单项） */
  onCopyCurl?: (requestId: number) => void;
  /** 导入到编辑器（右键菜单项） */
  onImportToEditor?: (requestId: number) => void;
  /** sessionId → 是否 md 渲染 */
  mdSessions: Record<string, boolean>;
  onToggleMd: (sessionId: string) => void;
}

/** 悬浮弹窗统一样式：popover 底色 + 两列网格（标签 | 右对齐值） */
const TIP_CLASS = "bg-popover text-popover-foreground border border-border";
const TIP_GRID = "grid grid-cols-[auto_auto] gap-x-5 gap-y-1 text-ui-sm py-0.5";

/** Token 用量行组（Prompt/Completion/Cache Read/Write/Total）；缓存行无值时隐藏 */
function UsageRows({ usage }: { usage: AiUsage }) {
  const locale = i18n.language?.startsWith("zh") ? "zh" : "en";
  return (
    <>
      <span className="text-muted-foreground">Input</span>
      <span className="text-right font-mono tabular-nums">{formatTokenCount(usage.inputTokens, locale)}</span>
      <span className="text-muted-foreground">Output</span>
      <span className="text-right font-mono tabular-nums">{formatTokenCount(usage.outputTokens, locale)}</span>
      {usage.reasoningTokens != null && (
        <>
          <span className="text-muted-foreground">Reasoning</span>
          <span className="text-right font-mono tabular-nums">{formatTokenCount(usage.reasoningTokens, locale)}</span>
        </>
      )}
      {usage.cachedTokens != null && (
        <>
          <span className="text-muted-foreground">Cache Read</span>
          <span className="text-right font-mono tabular-nums">{formatTokenCount(usage.cachedTokens, locale)}</span>
        </>
      )}
      {usage.cacheCreationTokens != null && (
        <>
          <span className="text-muted-foreground">Cache Write</span>
          <span className="text-right font-mono tabular-nums">
            {formatTokenCount(usage.cacheCreationTokens, locale)}
          </span>
        </>
      )}
      <span className="font-semibold text-violet-400">Total</span>
      <span className="text-right font-mono tabular-nums font-semibold text-violet-400">
        {formatTokenCount(usage.totalTokens, locale)}
      </span>
    </>
  );
}

function SessionGroup({
  session,
  selection,
  onSelect,
  onDeleteSession,
  onDeleteRequest,
  onCopyCurl,
  onImportToEditor,
  mdSessions,
  onToggleMd,
}: {
  session: AiSessionState;
  selection: AiSelection | null;
  onSelect: (sel: AiSelection) => void;
  onDeleteSession: (sessionId: string) => void;
  onDeleteRequest: (sessionId: string, requestId: number) => void;
  onCopyCurl?: (requestId: number) => void;
  onImportToEditor?: (requestId: number) => void;
  mdSessions: Record<string, boolean>;
  onToggleMd: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const headSelected = selection?.sessionId === session.sessionId && !selection?.requestId;
  const total = session.usageTotal.totalTokens;

  // 会话模型：取最新一轮已知 model 的请求（流式首轮可能尚未产出 model）
  const model = useMemo(() => {
    for (let i = session.requestIds.length - 1; i >= 0; i--) {
      const m = session.requests[session.requestIds[i]]?.model;
      if (m) return m;
    }
    return undefined;
  }, [session.requestIds, session.requests]);

  return (
    <div className="border-b border-border/40">
      {/* 会话头 */}
      <ContextMenu>
        <ContextMenuTrigger>
          <button
            className={cn(
              "w-full text-left px-3 py-2.5 transition-colors list-item-base",
              headSelected ? "list-item-selected" : "hover:bg-surface-base/50",
            )}
            style={{ borderLeftWidth: 3 }}
            onClick={() => onSelect({ sessionId: session.sessionId })}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className="flex items-center"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
              >
                {expanded ? (
                  <ChevronDown className="size-3 flex-shrink-0" />
                ) : (
                  <ChevronRight className="size-3 flex-shrink-0" />
                )}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="max-w-24 truncate text-ui-2xs px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-500 border-sky-500/20 dark:text-sky-400 cursor-default">
                      {session.source || "api"}
                    </span>
                  }
                />
                <TooltipContent side="right" className={TIP_CLASS}>
                  <div className={TIP_GRID}>
                    <span className="text-muted-foreground">Session</span>
                    <span className="text-right break-all">{session.scopeHost || "—"}</span>
                    <span className="text-muted-foreground">{t("aiSidebar.model", "模型")}</span>
                    <span className="text-right break-all">{model ?? "—"}</span>
                    <span className="text-muted-foreground">{t("aiSidebar.groupBy", "分组依据")}</span>
                    <span className="text-right break-all">{session.matchReason || "—"}</span>
                    <span className="text-muted-foreground">{t("aiSidebar.turns", "轮次")}</span>
                    <span className="text-right">
                      {t("aiSidebar.turnsValue", "{{count}} 次请求", { count: session.requestIds.length })}
                    </span>
                    <div className="col-span-2 border-t border-border/60 my-0.5" />
                    <UsageRows usage={session.usageTotal} />
                  </div>
                </TooltipContent>
              </Tooltip>
              <span className="text-ui-xs text-muted-foreground/60">{session.requestIds.length} 轮</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMd(session.sessionId);
                }}
                className={cn(
                  "ml-auto rounded p-0.5 transition-colors hover:bg-surface-base cursor-pointer",
                  mdSessions[session.sessionId]
                    ? "text-violet-400"
                    : "text-muted-foreground/40 hover:text-muted-foreground",
                )}
              >
                {mdSessions[session.sessionId] ? <CodeIcon className="size-3" /> : <TextIcon className="size-3" />}
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <p className="text-ui-sm text-foreground/80 truncate leading-tight cursor-default">
                    {session.title || session.scopeHost || session.sessionId}
                  </p>
                }
              />
              <TooltipContent
                side="right"
                className="bg-popover text-popover-foreground border border-border text-ui-sm px-2 py-1"
              >
                {session.title || session.scopeHost || session.sessionId}
              </TooltipContent>
            </Tooltip>
            <p className="text-ui-xs text-muted-foreground/50 mt-0.5">
              {total != null ? <TokenValue value={total} className="inline-flex items-center gap-0.5" /> : "— tokens"}
            </p>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="text-xs min-w-36">
          <ContextMenuItem variant="destructive" onClick={() => onDeleteSession(session.sessionId)}>
            <Trash2Icon className="size-3.5" />
            <span>{t("aiSidebar.deleteSession", "删除会话")}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* 展开：组内请求 */}
      {expanded && (
        <div className="bg-surface-deep/40">
          {session.requestIds.map((rid, i) => {
            const sel = selection?.sessionId === session.sessionId && selection?.requestId === rid;
            const conv = session.requests[rid];
            const hasLatency = conv?.firstChunkMs != null || conv?.durationMs != null;
            return (
              <ContextMenu key={rid}>
                <ContextMenuTrigger>
                  <button
                    className={cn(
                      "w-full text-left pl-8 pr-3 py-1.5 text-ui-xs font-mono transition-colors list-item-base",
                      sel ? "list-item-selected text-foreground" : "text-muted-foreground hover:bg-surface-base/40",
                    )}
                    style={{ borderLeftWidth: 3 }}
                    onClick={() => onSelect({ sessionId: session.sessionId, requestId: rid })}
                  >
                    <span className="flex items-center gap-1.5 w-full">
                      <span className="cursor-default">{t("aiSidebar.turnLabel", "轮次 {{n}}", { n: i + 1 })}</span>
                      {conv?.model && (
                        <span className="ml-auto">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="max-w-20 truncate text-ui-2xs font-semibold px-1 py-px rounded border bg-violet-500/10 text-violet-400 border-violet-500/20 cursor-default">
                                  {conv.model}
                                </span>
                              }
                            />
                            <TooltipContent side="right" className={TIP_CLASS}>
                              <div className={TIP_GRID}>
                                <div className="col-span-2 text-ui-xs font-bold tracking-wider text-muted-foreground">
                                  {t("aiSidebar.turnLabel", "轮次 {{n}}", { n: i + 1 })} · TOKEN
                                </div>
                                <UsageRows usage={conv?.usage ?? {}} />
                                {hasLatency && <div className="col-span-2 border-t border-border/60 my-0.5" />}
                                {conv?.firstChunkMs != null && (
                                  <>
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                      {t("aiSidebar.firstChunk", "首字")}
                                    </span>
                                    <span className="text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                                      {formatDuration(conv.firstChunkMs)}
                                    </span>
                                  </>
                                )}
                                {conv?.durationMs != null && (
                                  <>
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                      {t("aiSidebar.totalTime", "总耗时")}
                                    </span>
                                    <span className="text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                                      {formatDuration(conv.durationMs)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      )}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="text-xs min-w-36">
                  {onCopyCurl && (
                    <ContextMenuItem onClick={() => onCopyCurl(rid)}>
                      <TerminalIcon className="size-3.5" />
                      <span>{t("aiView.copyCurl", "复制 cURL")}</span>
                    </ContextMenuItem>
                  )}
                  {onImportToEditor && (
                    <ContextMenuItem onClick={() => onImportToEditor(rid)}>
                      <SquareArrowOutUpRightIcon className="size-3.5" />
                      <span>{t("aiView.importToEditor", "导入编辑")}</span>
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem variant="destructive" onClick={() => onDeleteRequest(session.sessionId, rid)}>
                    <Trash2Icon className="size-3.5" />
                    <span>{t("aiSidebar.deleteRequest", "删除该请求")}</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AiSidebar({
  sessions,
  selection,
  onSelect,
  onDeleteSession,
  onDeleteRequest,
  onCopyCurl,
  onImportToEditor,
  mdSessions,
  onToggleMd,
}: AiSidebarProps) {
  const { t } = useTranslation();
  const [statsOpen, setStatsOpen] = useState(false);
  const grandTotal = sessions.reduce((sum, s) => sum + (s.usageTotal.totalTokens ?? 0), 0);

  return (
    <div className="flex h-full flex-col bg-surface-base/30">
      <div className="flex items-center px-3 py-2">
        <span className="text-ui-xs font-bold uppercase tracking-wider text-muted-foreground">
          {t("aiSidebar.title", "AI 对话")}
          <span className="text-muted-foreground/50 ml-1">({sessions.length})</span>
        </span>
        <span className="ml-auto text-ui-xs flex items-center gap-1.5">
          {grandTotal > 0 && <TokenValue value={grandTotal} className="font-mono tabular-nums text-violet-400/70" />}
        </span>
      </div>

      <Separator />

      <ScrollArea className="flex-1 min-h-0">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-muted-foreground">
            <MessageSquareIcon className="size-8 text-muted-foreground/25" />
            <p className="text-xs">{t("aiSidebar.empty", "暂无 AI 会话")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {sessions.map((s) => (
              <SessionGroup
                key={s.sessionId}
                session={s}
                selection={selection}
                onSelect={onSelect}
                onDeleteSession={onDeleteSession}
                onDeleteRequest={onDeleteRequest}
                onCopyCurl={onCopyCurl}
                onImportToEditor={onImportToEditor}
                mdSessions={mdSessions}
                onToggleMd={onToggleMd}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <Separator />
      <div className="p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={() => setStatsOpen(true)}
        >
          <BarChart3Icon className="size-3.5" />
          <span>{t("aiSidebar.stats", "统计")}</span>
        </Button>
      </div>

      <UsageStatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
    </div>
  );
}
