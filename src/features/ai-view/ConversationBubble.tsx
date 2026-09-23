import { invoke } from "@tauri-apps/api/core";
import {
  BrainIcon,
  ChevronDown,
  ChevronRight,
  CodeIcon,
  ExternalLinkIcon,
  FileTextIcon,
  TextIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/core/CopyButton";
import { MarkdownContent } from "@/components/markdown/MarkdownContent";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AiContentBlock, AiToolDef, AiTurn, TerminationReason } from "@/types/ai";
import { formatSettledJson } from "./formatSettledJson";

/** JSON 美化，失败回退 String() */
function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 单个工具定义 → 可复制纯文本 */
function toolDefToText(def: AiToolDef): string {
  if (def.kind === "raw") return jsonText(def.json);
  const parts = [def.name];
  if (def.description) parts.push(def.description);
  if (def.parameters !== undefined) parts.push(jsonText(def.parameters));
  return parts.join("\n");
}

/** 把单个 content block 拼成可复制的纯文本 */
function blockToText(block: AiContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return `[thinking]\n${block.text}`;
  if (block.type === "tool_use") {
    let input = "";
    try {
      input = JSON.stringify(block.input, null, 2);
    } catch {
      input = String(block.input);
    }
    return `[tool_use] ${block.name}\n${input}`;
  }
  if (block.type === "tool_result") {
    return `[tool_result]\n${block.content.map(blockToText).join("\n")}`;
  }
  if (block.type === "tool_defs") {
    return block.tools.map(toolDefToText).join("\n\n");
  }
  return "";
}

/** 把整个 turn 拼成可复制的纯文本。
 *  旧库行的 tools_def 内容是原始 tools[] 的 JSON 文本块，美化后输出。 */
function turnToText(turn: AiTurn): string {
  if (turn.role === "tools_def" && turn.content[0]?.type === "text") {
    const raw = turn.content[0].text;
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return turn.content.map(blockToText).join("\n");
}

interface ConversationBubbleProps {
  turn: AiTurn;
  isStreaming: boolean;
  /** 可选：标注该轮来自哪次请求（合并时间线用，如 "#2"） */
  reqLabel?: string;
  /** 可选：点击跳转到代理视图定位该请求 */
  onJump?: () => void;
  /** 会话级默认视图：raw 原文（默认）/ md 渲染 */
  defaultView?: "md" | "raw";
  /** thinking 按需取：会话 id（有值时才能取） */
  sessionId?: string;
  /** thinking 按需取：请求 id */
  requestId?: number;
  /** thinking 按需取：turn 的稳定 id（已定稿才有） */
  fingerprint?: number;
  /** 该轮所属请求的响应流异常终止原因；有值时在气泡尾部标注内容不完整 */
  terminated?: TerminationReason;
}

/** 顶层 text block：JSON 对象/数组走美化后的 <pre>；否则按当前视图渲染 Markdown 或纯文本。
 *  开启即渲染——md 模式不再做「看起来像 Markdown」的启发式判定，普通文本自然成为段落。 */
function TextBlock({
  text,
  showMd,
  inverted,
  streaming,
}: {
  text: string;
  showMd: boolean;
  inverted: boolean;
  streaming: boolean;
}) {
  // JSON 检测：仅对象/数组命中；流式中不切换，避免半截 JSON 先走 Markdown 再跳成 <pre>
  const formattedJson = useMemo(() => formatSettledJson(text, streaming), [text, streaming]);

  if (formattedJson) {
    return <pre className="whitespace-pre-wrap break-words font-mono text-prose-sm">{formattedJson}</pre>;
  }

  if (showMd) {
    return <MarkdownContent text={text} streaming={streaming} variant={inverted ? "inverted" : "default"} />;
  }

  return <span>{text}</span>;
}

/** 单个 content block 的渲染 */
function ContentBlock({
  block,
  showMd,
  streaming,
  headerActions,
  fetchedThinkingText,
  onLoadThinking,
  thinkingLoading,
}: {
  block: AiContentBlock;
  showMd: boolean;
  streaming: boolean;
  headerActions?: React.ReactNode;
  /** thinking 按需取：该块对应的正文（已拉取则非空）。 */
  fetchedThinkingText?: string;
  /** thinking 按需取：展开且无正文时触发拉取。 */
  onLoadThinking?: () => void;
  thinkingLoading?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (block.type === "text") {
    return <TextBlock text={block.text} showMd={showMd} inverted={false} streaming={streaming} />;
  }

  if (block.type === "thinking") {
    const displayText = fetchedThinkingText ?? block.text;
    const isEmpty = displayText === "";
    return (
      <div className="mt-1.5 rounded-lg border border-sky-500/20 bg-sky-500/5 overflow-hidden">
        <button
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-ui-sm font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 transition-colors"
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next && isEmpty && onLoadThinking) onLoadThinking();
          }}
        >
          {expanded ? (
            <ChevronDown className="size-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="size-3 flex-shrink-0" />
          )}
          <BrainIcon className="size-3 flex-shrink-0" />
          <span className="truncate flex-1">{t("aiView.thinking", "思考过程")}</span>
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
                  ? t("aiView.thinkingLoading", "加载中…")
                  : t("aiView.thinkingEmpty", "思考内容定稿后可查看")}
              </span>
            ) : showMd ? (
              <MarkdownContent text={displayText} variant="default" />
            ) : (
              <span className="whitespace-pre-wrap break-words">{displayText}</span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (block.type === "tool_use") {
    const toolUseText = `[tool_use] ${block.name}\n${JSON.stringify(block.input, null, 2)}`;
    return (
      <div className="mt-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden">
        <button
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-ui-sm font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="size-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="size-3 flex-shrink-0" />
          )}
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
          <pre className="max-h-48 overflow-y-auto border-t border-amber-500/15 px-3 py-2 text-prose-sm font-mono text-foreground/80 whitespace-pre-wrap break-all">
            {JSON.stringify(block.input, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  if (block.type === "tool_result") {
    const toolResultText = `[tool_result]\n${block.content.map(blockToText).join("\n")}`;
    return (
      <div className="mt-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
        <button
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-ui-sm font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="size-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="size-3 flex-shrink-0" />
          )}
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
              // biome-ignore lint/suspicious/noArrayIndexKey: static content block, never reordered
              <ContentBlock key={i} block={innerBlock} showMd={showMd} streaming={streaming} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

/** raw 工具项的显示名：优先 `type`（Anthropic / OpenAI 内置工具），
 *  否则 `name`，否则首个键名（Gemini `{googleSearch:{}}` → googleSearch）。 */
function rawToolLabel(json: unknown): string {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    if (typeof o.type === "string" && o.type) return o.type;
    if (typeof o.name === "string" && o.name) return o.name;
    const [first] = Object.keys(o);
    if (first) return first;
  }
  return "tool";
}

/** 单个工具定义行：函数工具展开显示描述 + JSON Schema；raw 项展开显示原始 JSON。 */
function ToolDefRow({ def, showMd, streaming }: { def: AiToolDef; showMd: boolean; streaming: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isRaw = def.kind === "raw";
  const label = def.kind === "raw" ? rawToolLabel(def.json) : def.name;
  const detail = def.kind === "raw" ? def.json : def.parameters;
  const description = def.kind === "function" ? def.description : undefined;

  return (
    <div className="border-b border-violet-500/10 last:border-b-0">
      <button
        className="flex w-full items-center gap-1.5 px-0.5 py-1 text-left text-ui-sm hover:bg-violet-500/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-3 flex-shrink-0 text-violet-500/60" />
        ) : (
          <ChevronRight className="size-3 flex-shrink-0 text-violet-500/60" />
        )}
        <span className="truncate font-mono text-foreground/85">{label}</span>
        {isRaw && (
          <span className="flex-shrink-0 rounded bg-violet-500/10 px-1 text-ui-2xs text-violet-600 dark:text-violet-400">
            {t("aiView.toolDefBuiltin", "内置")}
          </span>
        )}
      </button>
      {expanded && (
        <div className="pb-1.5 pl-4">
          {description && (
            <div className="text-prose-sm text-foreground/70">
              <TextBlock text={description} showMd={showMd} inverted={false} streaming={streaming} />
            </div>
          )}
          {detail !== undefined && (
            <pre className="mt-1 text-prose-xs font-mono text-foreground/70 whitespace-pre-wrap break-all">
              {jsonText(detail)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** tools_def 气泡：可折叠的工具列表。
 *  结构化 `tool_defs` 块为主路径；tools_def 内容形状变更未做数据迁移，
 *  老会话的行仍是原始 tools[] 的 JSON 文本块，保留兼容渲染。 */
function ToolsDefTurn({ turn, showMd, streaming }: { turn: AiTurn; showMd: boolean; streaming: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const defs = turn.content.find(
    (b): b is Extract<AiContentBlock, { type: "tool_defs" }> => b.type === "tool_defs",
  )?.tools;

  const legacyRaw = !defs && turn.content[0]?.type === "text" ? turn.content[0].text : "";
  const legacy = useMemo(() => {
    if (!legacyRaw) return { count: 0, formatted: "" };
    try {
      const parsed: unknown = JSON.parse(legacyRaw);
      return {
        count: Array.isArray(parsed) ? parsed.length : 0,
        formatted: JSON.stringify(parsed, null, 2),
      };
    } catch {
      return { count: 0, formatted: legacyRaw };
    }
  }, [legacyRaw]);

  const count = defs?.length ?? legacy.count;

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 text-left text-ui-sm font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="size-3 flex-shrink-0" />
        )}
        <span>🔩 Tools{count > 0 ? ` (${count})` : ""}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 max-h-64 overflow-y-auto border-t border-violet-500/15 pt-1.5">
          {defs ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: static tool definitions, never reordered
            defs.map((def, i) => <ToolDefRow key={i} def={def} showMd={showMd} streaming={streaming} />)
          ) : (
            <details open>
              <summary className="text-ui-xs text-muted-foreground/60 cursor-pointer">
                {t("aiView.toolDefsRawJson", "查看原始 JSON")}
              </summary>
              <pre className="mt-1 text-prose-xs font-mono text-foreground/70 whitespace-pre-wrap break-all">
                {legacy.formatted}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** tool 角色气泡：默认折叠，展开后渲染子内容 */
function ToolTurn({ turn, showMd, streaming }: { turn: AiTurn; showMd: boolean; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 text-left text-ui-sm font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="size-3 flex-shrink-0" />
        )}
        <WrenchIcon className="size-3 flex-shrink-0" />
        <span>tool</span>
      </button>
      {expanded && (
        <div className="mt-1.5 border-t border-emerald-500/15 pt-1.5 text-prose-md">
          {turn.content.map((block, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static content block, never reordered
            <ContentBlock key={j} block={block} showMd={showMd} streaming={streaming} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 对话气泡：role 决定对齐与配色，内部渲染 content blocks */
export function ConversationBubble({
  turn,
  isStreaming,
  reqLabel,
  onJump,
  defaultView = "raw",
  sessionId,
  requestId,
  fingerprint,
  terminated,
}: ConversationBubbleProps) {
  const { t } = useTranslation();
  const [systemExpanded, setSystemExpanded] = useState(false);

  // md 能力：是否有自由文本可渲染（用于显示气泡级 md/raw 切换按钮）
  const mdCapable = useMemo(() => {
    const check = (blocks: AiContentBlock[]): boolean =>
      blocks.some((b) => {
        if (b.type === "text") return true;
        if (b.type === "tool_result") return check(b.content);
        if (b.type === "tool_defs") return b.tools.some((d) => d.kind === "function" && !!d.description);
        return false;
      });
    return check(turn.content);
  }, [turn]);
  // 气泡级覆盖：null = 跟随会话级 defaultView；会话级切换时清除覆盖
  const [override, setOverride] = useState<"md" | "raw" | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: defaultView is a trigger
  useEffect(() => {
    setOverride(null);
  }, [defaultView]);
  const view = override ?? defaultView;
  const showMd = view === "md";
  const contentRef = useRef<HTMLDivElement>(null);

  // thinking 按需取：turn 级拉取一次，按出现顺序填充各 thinking 块。
  const [thinkingTexts, setThinkingTexts] = useState<string[] | null>(null);
  const [thinkingLoading, setThinkingLoading] = useState(false);
  const loadThinking = () => {
    if (thinkingTexts !== null || thinkingLoading) return;
    if (sessionId == null || requestId == null || fingerprint == null) return;
    setThinkingLoading(true);
    invoke<string[]>("get_ai_thinking", { sessionId, requestId, fingerprint })
      .then((texts) => setThinkingTexts(texts))
      .catch(() => setThinkingTexts([]))
      .finally(() => setThinkingLoading(false));
  };
  const thinkingOrdinals = useMemo(() => {
    const m = new Map<number, number>();
    let n = 0;
    turn.content.forEach((b, i) => {
      if (b.type === "thinking") {
        m.set(i, n);
        n++;
      }
    });
    return m;
  }, [turn]);

  // 整条复制始终复制原始 Markdown 源文，不读取渲染后的 DOM
  const copyText = useMemo(() => turnToText(turn), [turn]);

  // 检测是否「纯工具」气泡：只有 tool_use / tool_result，没有 text block
  const toolsOnly = useMemo(() => {
    if (turn.content.length === 0) return false;
    return turn.content.every((b) => b.type === "tool_use" || b.type === "tool_result");
  }, [turn]);

  // 内联到工具行尾部的操作按钮（复制 + 跳转代理）
  const headerActions = useMemo(() => {
    if (!toolsOnly) return undefined;
    return (
      <span className="inline-flex items-center gap-0.5 ml-auto" onClick={(e) => e.stopPropagation()}>
        {onJump && (
          <Tooltip>
            <TooltipTrigger className="inline-flex">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onJump();
                }}
                className="inline-flex items-center p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
              >
                <ExternalLinkIcon className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
              {t("aiView.jumpToProxy", "在代理中查看")}
            </TooltipContent>
          </Tooltip>
        )}
        <CopyButton
          text={copyText}
          size="xs"
          className="inline-flex items-center p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity cursor-pointer hover:bg-foreground/5"
        />
      </span>
    );
  }, [toolsOnly, onJump, copyText, t]);
  const isUser = turn.role === "user";
  const isSystem = turn.role === "system";
  const isToolsDef = turn.role === "tools_def";
  const isTool = turn.role === "tool";

  // 除 assistant（模型响应）外，system / tools_def / tool 都是客户端随请求发出的，统一靠右
  const alignClass = turn.role === "assistant" ? "justify-start" : "justify-end";

  let bubbleClass: string;
  if (isUser) {
    bubbleClass = "bg-ai-user-bubble text-ai-user-bubble-text";
  } else if (isSystem) {
    bubbleClass = "bg-surface-base/50 text-muted-foreground text-prose-md";
  } else if (isToolsDef) {
    bubbleClass = "bg-violet-500/5 border border-violet-500/15 text-foreground";
  } else if (isTool) {
    bubbleClass = "bg-emerald-500/5 border border-emerald-500/15 text-foreground";
  } else {
    bubbleClass = "bg-background text-foreground";
  }

  /** 获取 system turn 纯文本（用于折叠标题） */
  const systemPreview = isSystem
    ? turn.content[0]?.type === "text"
      ? turn.content[0].text.slice(0, 60) + (turn.content[0].text.length > 60 ? "..." : "")
      : "system"
    : "";

  return (
    <div className={`group flex ${alignClass}`}>
      <div className={`relative max-w-[80%] rounded-xl px-4 py-2.5 text-prose-xl ${bubbleClass}`}>
        {!toolsOnly && (
          <CopyButton
            text={copyText}
            size="sm"
            className={`absolute top-1.5 right-1.5 z-10 rounded-md p-1 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity cursor-pointer ${
              isUser
                ? "text-white/80 hover:bg-white/15"
                : "text-muted-foreground bg-surface-base/40 hover:bg-surface-base/80"
            }`}
          />
        )}
        {mdCapable && !toolsOnly && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOverride(view === "md" ? "raw" : "md");
            }}
            className={`absolute top-1.5 right-8 z-10 rounded-md p-1 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity cursor-pointer ${
              isUser
                ? "text-white/80 hover:bg-white/15"
                : "text-muted-foreground bg-surface-base/40 hover:bg-surface-base/80"
            }`}
          >
            {view === "md" ? <CodeIcon className="size-3.5" /> : <TextIcon className="size-3.5" />}
          </button>
        )}
        {!toolsOnly && (reqLabel || onJump) && (
          <div
            className={`mb-1 flex items-center gap-1 text-ui-2xs font-mono ${isUser ? "text-white/60" : "text-muted-foreground/50"}`}
          >
            {reqLabel && <span>{reqLabel}</span>}
            {onJump && (
              <button
                type="button"
                title={t("aiView.jumpToProxy", "在代理中查看")}
                onClick={(e) => {
                  e.stopPropagation();
                  onJump();
                }}
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
              {systemExpanded ? (
                <ChevronDown className="size-3 flex-shrink-0" />
              ) : (
                <ChevronRight className="size-3 flex-shrink-0" />
              )}
              <span className="italic">💬 {systemPreview}</span>
            </button>
            {systemExpanded && (
              <div
                ref={contentRef}
                className="mt-1.5 border-t border-border/30 pt-1.5 text-prose-md whitespace-pre-wrap break-words"
              >
                {turn.content.map((block, j) =>
                  block.type === "text" ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static content block, never reordered
                    <TextBlock key={j} text={block.text} showMd={showMd} inverted={false} streaming={isStreaming} />
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static content block, never reordered
                    <ContentBlock key={j} block={block} showMd={showMd} streaming={isStreaming} />
                  ),
                )}
              </div>
            )}
          </div>
        ) : isToolsDef ? (
          <ToolsDefTurn turn={turn} showMd={showMd} streaming={isStreaming} />
        ) : isTool ? (
          /* tool 特殊渲染：默认折叠，展开后才渲染子内容 */
          <ToolTurn turn={turn} showMd={showMd} streaming={isStreaming} />
        ) : (
          <div ref={contentRef}>
            {turn.content.map((block, j) => {
              if (block.type === "text") {
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static content block, never reordered
                  <TextBlock key={j} text={block.text} showMd={showMd} inverted={isUser} streaming={isStreaming} />
                );
              }
              if (block.type === "thinking") {
                const ordinal = thinkingOrdinals.get(j) ?? 0;
                return (
                  <ContentBlock
                    // biome-ignore lint/suspicious/noArrayIndexKey: static content block, never reordered
                    key={j}
                    block={block}
                    showMd={showMd}
                    streaming={isStreaming}
                    headerActions={j === 0 ? headerActions : undefined}
                    fetchedThinkingText={thinkingTexts?.[ordinal]}
                    onLoadThinking={loadThinking}
                    thinkingLoading={thinkingLoading}
                  />
                );
              }
              return (
                <ContentBlock
                  // biome-ignore lint/suspicious/noArrayIndexKey: static content block, never reordered
                  key={j}
                  block={block}
                  showMd={showMd}
                  streaming={isStreaming}
                  headerActions={j === 0 ? headerActions : undefined}
                />
              );
            })}
            {isStreaming && turn.role === "assistant" && <span className="animate-pulse">▌</span>}
          </div>
        )}
        {terminated && (
          <div
            className="mt-1 flex items-center gap-1 text-ui-xs"
            style={{ color: "var(--badge-warning)" }}
            title={t(`aiView.terminatedHint.${terminated}`)}
          >
            <TriangleAlertIcon className="size-3 shrink-0" />
            <span>{t(`aiView.terminated.${terminated}`)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
