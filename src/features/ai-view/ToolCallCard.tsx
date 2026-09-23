import { ChevronDown, ChevronRight, CodeIcon, ExternalLinkIcon, TextIcon, WrenchIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/core/CopyButton";
import { MarkdownContent } from "@/components/markdown/MarkdownContent";

/** 一条 tool_use + tool_result 配对 */
export interface ToolCallEntry {
  requestId: number;
  /** 该 tool_use 在同一 turn 内的序号（1-based） */
  stepIndex: number;
  /** 同一 turn 内的总步数 */
  stepTotal: number;
  /** 工具名 */
  toolName: string;
  /** 入参 */
  input: unknown;
  /** 工具结果文本（从 tool_result 的 text block 拼出），无结果时为 null */
  result: string | null;
  /** result 的行数 */
  resultLines: number;
}

/** 长结果截断阈值（行数） */
const TRUNCATE_LINES = 15;

interface ToolCallCardProps {
  entry: ToolCallEntry;
  /** 请求序号标签，如 "#1" */
  reqLabel: string;
  /** 默认是否展开 */
  defaultExpanded: boolean;
  /** 点击跳转到代理视图定位请求 */
  onJump?: () => void;
}

export function ToolCallCard({ entry, reqLabel, defaultExpanded, onJump }: ToolCallCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [resultExpanded, setResultExpanded] = useState(false);

  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);
  const toggleResult = useCallback(() => setResultExpanded((v) => !v), []);

  const inputText = formatInput(entry.input);
  const cardText = `[tool_use] ${entry.toolName}\n${inputText}\n\n[tool_result]\n${entry.result ?? ""}`;

  // 入参的可读字符串

  // 是否需要截断 + 是否已经展开全部
  const needsTruncate = entry.result != null && entry.resultLines > TRUNCATE_LINES && !resultExpanded;
  const displayResult = needsTruncate ? entry.result!.split("\n").slice(0, TRUNCATE_LINES).join("\n") : entry.result;

  // 结果区域的 md 渲染：默认开启，卡片级 override 可强制纯文本
  const [resultMdOverride, setResultMdOverride] = useState<"md" | "raw" | null>(null);
  const showResultMd = resultMdOverride !== "raw";

  // 步骤角标样式：同 turn 只有该工具一次 → 灰色；多次 → 橙色
  const stepOnly = entry.stepTotal === 1;
  const stepBadgeClass = stepOnly ? "bg-muted text-muted-foreground" : "bg-amber-500 text-white";

  return (
    <div className="rounded-lg bg-card border border-amber-500/20 overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,.04)]">
      {/* 卡头 */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left bg-amber-500/5 hover:bg-amber-500/10 transition-colors border-b border-amber-500/15"
        onClick={toggleExpand}
      >
        <span className="text-ui-xs font-mono text-muted-foreground/70">{reqLabel}</span>
        <span className={`text-ui-2xs font-semibold px-1.5 py-0.5 rounded ${stepBadgeClass}`}>
          {entry.stepIndex}/{entry.stepTotal}
        </span>
        <WrenchIcon className="size-3 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-ui-sm font-semibold text-amber-600 dark:text-amber-400 truncate flex-1">
          {entry.toolName}
        </span>
        {/* 复制卡片 */}
        <CopyButton
          text={cardText}
          size="xs"
          className="inline-flex items-center p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
        />
        {/* 跳转代理 */}
        {onJump && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onJump();
            }}
            className="inline-flex items-center p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
            title={t("aiView.jumpToProxy", "在代理中查看")}
          >
            <ExternalLinkIcon className="size-3" />
          </span>
        )}
        <span className="text-ui-2xs text-muted-foreground/50">
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>

      {expanded && (
        <>
          {/* 入参 */}
          <div className="px-2.5 py-1.5 border-b border-border/30">
            <div className="flex items-center gap-1.5 text-ui-2xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1">
              <span>📥 {t("aiView.toolCallInput", "入参")}</span>
              <CopyButton
                text={inputText}
                size="xs"
                className="inline-flex items-center p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
              />
            </div>
            <pre className="text-prose-sm font-mono text-foreground/80 bg-amber-500/5 rounded p-2 whitespace-pre-wrap break-all m-0 max-h-36 overflow-y-auto">
              {inputText}
            </pre>
          </div>

          {/* 结果 */}
          {entry.result != null && (
            <div className="px-2.5 py-1.5 bg-background/50 relative">
              <div className="flex items-center gap-1.5 text-ui-2xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                <span>
                  📤 {t("aiView.toolCallResult", "结果")} · {entry.resultLines} 行
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResultMdOverride(showResultMd ? "raw" : "md");
                  }}
                  className="inline-flex items-center p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
                  title={showResultMd ? "查看原文" : "查看渲染"}
                >
                  {showResultMd ? <CodeIcon className="size-3" /> : <TextIcon className="size-3" />}
                </button>
                <CopyButton
                  text={entry.result ?? ""}
                  size="xs"
                  className="inline-flex items-center p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
                />
              </div>
              {showResultMd ? (
                <div className="rounded p-2 bg-emerald-500/5 max-h-[512px] overflow-y-auto">
                  <MarkdownContent text={displayResult ?? ""} variant="default" />
                </div>
              ) : (
                <pre className="text-prose-sm font-mono text-foreground/80 bg-emerald-500/5 rounded p-2 whitespace-pre-wrap break-all m-0 max-h-[512px] overflow-y-auto">
                  {displayResult}
                </pre>
              )}
              {/* 截断渐变 + 展开全部 */}
              {needsTruncate && (
                <>
                  <div className="absolute bottom-1.5 left-3 right-3 h-10 bg-gradient-to-t from-background/95 to-transparent pointer-events-none" />
                  <button
                    type="button"
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 text-ui-2xs px-3 py-1 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
                    onClick={toggleResult}
                  >
                    {t("aiView.toolCallExpandAll", "展开全部")} ↓
                  </button>
                </>
              )}
              {/* 已展开全部 → 收起 */}
              {resultExpanded && entry.result != null && entry.resultLines > TRUNCATE_LINES && (
                <button
                  type="button"
                  className="mt-1 text-ui-2xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  onClick={toggleResult}
                >
                  {t("aiView.toolCallCollapse", "收起")} ↑
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 入参 → 可读的 JSON/字符串 */
function formatInput(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
