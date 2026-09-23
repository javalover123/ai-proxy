/**
 * Markdown rendering for untrusted AI/assistant-authored text.
 *
 * Wraps the direct mdast→React renderer (parse.ts / incremental.ts /
 * render.tsx) with the two integration seams this project needs:
 *  - an error boundary that degrades the whole block to escaped plain text;
 *  - a link-confirmation gate: anchors are never navigated by the WebView.
 *    http/https URLs open through the Rust `open_url` command (which re-checks
 *    the scheme) only after the user confirms the domain + full URL;
 *    mailto: is handed to the system handler; everything else is inert.
 */

import { invoke } from "@tauri-apps/api/core";
import type { MouseEvent, ReactNode } from "react";
import { Component, memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { IncrementalMarkdownParser } from "./incremental";
import { parseGfm, parseGfmWithMath } from "./parse";
import type { MarkdownCodeLabels, MarkdownFileMentions, MarkdownRenderContext, ReferenceTargets } from "./render";
import {
  collectReferenceTargets,
  createReferenceTargets,
  renderBlocks,
  renderFootnoteSection,
  wrapBlockChildren,
} from "./render";
import "katex/dist/katex.min.css";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** One settled full render: parse with math, resolve references, append the footnote section. */
function renderSettled(
  text: string,
  codeLabels: MarkdownCodeLabels | undefined,
  fileMentions: MarkdownFileMentions | undefined,
): ReactNode[] {
  const root = parseGfmWithMath(text);
  const targets = createReferenceTargets();
  collectReferenceTargets(root.children, targets);
  const context: MarkdownRenderContext = {
    streaming: false,
    codeLabels,
    fileMentions,
    targets,
    footnoteOrder: [],
    footnoteCounts: new Map(),
  };
  const blocks = wrapBlockChildren(
    renderBlocks(
      root.children.map((node, index) => ({ node, key: index })),
      context,
    ),
    false,
  );
  const section = renderFootnoteSection(context);
  return section === null ? blocks : [...blocks, "\n", section];
}

/**
 * Streaming render state for one growing message: the incremental parser,
 * the frozen blocks' cached elements, and the reference/footnote state their
 * rendering consumed (footnote numbering assigned to frozen references is
 * final, so the tail continues from a copy of it each frame).
 */
class StreamingRenderer {
  private readonly parser = new IncrementalMarkdownParser(parseGfm);
  private generation = -1;
  private frozenCount = 0;
  private frozenElements: ReactNode[] = [];
  private frozenTargets: ReferenceTargets = createReferenceTargets();
  private frozenFootnoteOrder: string[] = [];
  private frozenFootnoteCounts = new Map<string, number>();
  private lastText: string | null = null;
  private lastRendered: ReactNode[] = [];

  constructor(private readonly codeLabels: MarkdownCodeLabels | undefined) {}

  render(text: string): ReactNode[] {
    if (text === this.lastText) return this.lastRendered;
    const { frozen, tail, generation } = this.parser.update(text);
    if (generation !== this.generation) {
      this.generation = generation;
      this.frozenCount = 0;
      this.frozenElements = [];
      this.frozenTargets = createReferenceTargets();
      this.frozenFootnoteOrder = [];
      this.frozenFootnoteCounts = new Map();
    }
    const newlyFrozen = frozen.slice(this.frozenCount);
    collectReferenceTargets(
      newlyFrozen.map((block) => block.node),
      this.frozenTargets,
    );
    const frameTargets: ReferenceTargets = {
      definitions: new Map(this.frozenTargets.definitions),
      footnotes: new Map(this.frozenTargets.footnotes),
    };
    collectReferenceTargets(
      tail.map((block) => block.node),
      frameTargets,
    );
    if (newlyFrozen.length > 0) {
      const frozenContext: MarkdownRenderContext = {
        streaming: true,
        codeLabels: this.codeLabels,
        fileMentions: undefined,
        targets: frameTargets,
        footnoteOrder: this.frozenFootnoteOrder,
        footnoteCounts: this.frozenFootnoteCounts,
      };
      const batch = [...this.frozenElements];
      for (const element of renderBlocks(newlyFrozen, frozenContext)) {
        if (batch.length > 0) batch.push("\n");
        batch.push(element);
      }
      this.frozenElements = batch;
      this.frozenCount = frozen.length;
    }
    const tailContext: MarkdownRenderContext = {
      streaming: true,
      codeLabels: this.codeLabels,
      fileMentions: undefined,
      targets: frameTargets,
      footnoteOrder: [...this.frozenFootnoteOrder],
      footnoteCounts: new Map(this.frozenFootnoteCounts),
    };
    const children = [...this.frozenElements];
    for (const element of renderBlocks(tail, tailContext)) {
      if (children.length > 0) children.push("\n");
      children.push(element);
    }
    const section = renderFootnoteSection(tailContext);
    if (section !== null) children.push("\n", section);
    this.lastText = text;
    this.lastRendered = children;
    return this.lastRendered;
  }
}

/**
 * The memoized renderer core. Keeping this a separate component lets the
 * error boundary and link gate wrap it without resetting the streaming cache
 * on every host-level re-render of the conversation.
 */
const MarkdownRenderer = memo(function MarkdownRenderer({ text, streaming }: { text: string; streaming: boolean }) {
  // codeLabels identity is intentionally omitted from props: it is a stable
  // module constant below, so a new object would never be created per render.
  const streamRef = useRef<StreamingRenderer | null>(null);
  const children = useMemo(() => {
    if (!streaming) {
      streamRef.current = null;
      return renderSettled(text, CODE_LABELS, undefined);
    }
    if (streamRef.current === null) streamRef.current = new StreamingRenderer(CODE_LABELS);
    return streamRef.current.render(text);
  }, [text, streaming]);
  return <>{children}</>;
});

/** Stable code-block labels: keeps the streaming cache from being discarded by a new object identity. */
const CODE_LABELS: MarkdownCodeLabels = { copyLabel: "Copy", copiedLabel: "Copied" };

/** md 渲染抛错时降级为纯文本，不影响气泡其余部分。源文变化后重试。 */
class MdErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; resetKey: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prevProps: Readonly<{ resetKey: string }>) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface MarkdownContentProps {
  text: string;
  /** 流式时启用增量解析（代码 plain、公式保持文本）；定稿后切换完整渲染。 */
  streaming?: boolean;
  /** inverted：蓝底 user 气泡等深色实底场景，启用白色系覆盖样式 */
  variant?: "default" | "inverted";
}

function isConfirmableHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
}

/** 通用 Markdown 渲染。链接点击必须经用户确认后才交给系统打开。 */
export function MarkdownContent({ text, streaming = false, variant = "default" }: MarkdownContentProps) {
  const { t } = useTranslation();
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const interceptAnchor = useCallback((e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    if (isConfirmableHref(href)) {
      setOpenError(null);
      setPendingUrl(href);
    }
  }, []);

  const dismissLink = useCallback(() => {
    setPendingUrl(null);
    setOpenError(null);
  }, []);

  const openLink = useCallback(() => {
    if (pendingUrl == null) return;
    setOpenError(null);
    void invoke("open_url", { url: pendingUrl })
      .then(() => {
        setPendingUrl(null);
      })
      .catch(() => {
        setOpenError(t("aiView.openLinkFailed", "无法打开链接"));
      });
  }, [pendingUrl, t]);

  let host: string;
  try {
    host = new URL(pendingUrl ?? "").hostname;
  } catch {
    host = "";
  }

  return (
    <MdErrorBoundary resetKey={`${streaming}:${text}`} fallback={<span className="whitespace-pre-wrap">{text}</span>}>
      <div
        onClickCapture={interceptAnchor}
        onAuxClickCapture={interceptAnchor}
        onContextMenuCapture={interceptAnchor}
        className={cn("md-content", variant === "inverted" && "md-inverted")}
      >
        <MarkdownRenderer text={text} streaming={streaming} />
      </div>

      <Dialog
        open={pendingUrl != null}
        onOpenChange={(open) => {
          if (!open) dismissLink();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("aiView.openLinkTitle", "打开外部链接？")}</DialogTitle>
            <DialogDescription>
              {t("aiView.openLinkDesc", "此链接来自未受信任的 Markdown 内容，请确认目标地址。")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 break-all">
            <div className="text-prose-sm font-medium">{host}</div>
            <div className="text-prose-xs text-muted-foreground">{pendingUrl}</div>
          </div>
          {openError != null && <p className="text-prose-sm text-destructive">{openError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={dismissLink}>
              {t("common.cancel", "取消")}
            </Button>
            <Button onClick={openLink}>{t("aiView.openLink", "打开链接")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MdErrorBoundary>
  );
}
