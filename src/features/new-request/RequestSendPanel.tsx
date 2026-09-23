import { SendIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/core/InputGroup";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DetailPanel } from "@/features/detail-panel";
import { useLocale } from "@/hooks/useLocale";
import { METHOD_COLORS } from "@/lib/http-constants";
import { cn } from "@/lib/utils";
import type { BodyType, HttpMethod, KeyValuePair } from "@/types/collection";
import type { TrafficEntry } from "@/types/proxy";
import RequestEditor from "./RequestEditor";

export const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export interface RequestSendPanelProps {
  /** ResizablePanelGroup 唯一标识，区分不同实例的 localStorage 持久化 */
  panelGroupId: string;

  // ── URL 栏 ──
  method: HttpMethod;
  onMethodChange: (m: HttpMethod) => void;
  url: string;
  onUrlChange: (url: string) => void;
  sending: boolean;
  onSend: () => void;
  /** 额外操作（如 Save 按钮），插在 Send 之前 */
  urlBarChildren?: ReactNode;

  // ── 编辑器 ──
  params: KeyValuePair[];
  headers: KeyValuePair[];
  cookies: KeyValuePair[];
  body: string;
  bodyType: BodyType;
  onParamsChange: (v: KeyValuePair[]) => void;
  onHeadersChange: (v: KeyValuePair[]) => void;
  onCookiesChange: (v: KeyValuePair[]) => void;
  onBodyChange: (v: string) => void;
  onBodyTypeChange: (v: BodyType) => void;

  // ── 响应面板 ──
  responseEntry?: TrafficEntry;
  /** 响应面板中是否展示请求侧，默认 false（仅响应） */
  showRequestInResponse?: boolean;
  /** 布局方向：'hidden' 仅编辑器，'bottom' 上下分屏，'right' 左右分屏。默认 'bottom' */
  detailPosition?: "bottom" | "right" | "hidden";
  /** 响应面板 ref，用于 imperative collapse/expand */
  responsePanelRef?: React.RefObject<PanelImperativeHandle | null>;

  // ── 错误 ──
  error?: string;

  // ── 取消 ──
  onCancel?: () => void;

  // ── 样式覆盖 ──
  className?: string;
}

/**
 * 共享的「请求编辑 → 发送 → 响应」面板。
 * EditRequestDialog 和 NewRequestView 共用，不涉及接口管理逻辑。
 */
export default function RequestSendPanel({
  panelGroupId,
  method,
  onMethodChange,
  url,
  onUrlChange,
  sending,
  onSend,
  urlBarChildren,
  params,
  headers,
  cookies,
  body,
  bodyType,
  onParamsChange,
  onHeadersChange,
  onCookiesChange,
  onBodyChange,
  onBodyTypeChange,
  responseEntry,
  showRequestInResponse = false,
  detailPosition = "bottom",
  responsePanelRef,
  error,
  onCancel,
  className,
}: RequestSendPanelProps) {
  const { t } = useLocale();
  const hasResponse = responseEntry != null;

  const editor = (
    <RequestEditor
      params={params}
      headers={headers}
      cookies={cookies}
      body={body}
      bodyType={bodyType}
      onParamsChange={onParamsChange}
      onHeadersChange={onHeadersChange}
      onCookiesChange={onCookiesChange}
      onBodyChange={onBodyChange}
      onBodyTypeChange={onBodyTypeChange}
    />
  );

  return (
    <div className={cn("flex flex-col min-h-0 flex-1 relative", className)}>
      {/* ── URL 栏 ── */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-2 border-b border-border bg-surface-base/50">
        <InputGroup className="flex-1">
          <InputGroupAddon align="inline-start" className="py-0 pl-0">
            <Select value={method} onValueChange={(v) => onMethodChange(v as HttpMethod)} disabled={sending}>
              <SelectTrigger
                className={cn(
                  "h-8 py-0 border-0 shadow-none rounded-none rounded-l-lg bg-transparent",
                  "focus-visible:ring-0 focus-visible:ring-offset-0",
                  "min-w-0 w-auto px-2 text-xs font-semibold",
                  "data-[size=sm]:h-8",
                  METHOD_COLORS[method] ? `text-${METHOD_COLORS[method]}` : "",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="start"
                alignItemWithTrigger={false}
                className="min-w-[120px] max-h-36 overflow-y-auto [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:text-xs"
              >
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InputGroupAddon>
          <InputGroupInput
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            className="text-prose-md font-mono"
            placeholder="https://api.example.com/v1/endpoint"
            disabled={sending}
          />
        </InputGroup>
        {urlBarChildren}
        <Button onClick={onSend} disabled={sending || !url.trim()} size="sm">
          <SendIcon className="size-3.5" />
          {sending ? "..." : t("sendRequest.send")}
        </Button>
      </div>

      {/* ── 错误 ── */}
      {error && (
        <div className="shrink-0 px-4 pt-2">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* ── 发送中遮罩 ── */}
      {sending && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px]" />
          <svg className="size-7 animate-spin text-foreground/40 relative" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="52"
              strokeDashoffset="16"
              strokeLinecap="round"
            />
          </svg>
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs text-destructive relative">
              {t("sendRequest.cancel")}
            </Button>
          )}
        </div>
      )}

      {/* ── 编辑器 + 响应 ── */}
      {detailPosition === "hidden" ? (
        <div className="flex-1 min-h-0 overflow-hidden">{editor}</div>
      ) : (
        <ResizablePanelGroup
          orientation={detailPosition === "right" ? "horizontal" : "vertical"}
          id={panelGroupId}
          className="flex-1 min-h-0"
        >
          <ResizablePanel
            id="editor"
            defaultSize={hasResponse ? "40%" : "100%"}
            minSize={hasResponse ? "15%" : "100%"}
            maxSize={hasResponse ? "85%" : "100%"}
          >
            <div className="flex flex-col h-full min-h-0 overflow-hidden">{editor}</div>
          </ResizablePanel>
          {hasResponse && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="response"
                defaultSize="60%"
                minSize="10%"
                collapsible
                collapsedSize={0}
                panelRef={responsePanelRef}
              >
                <div className="h-full min-h-0 min-w-0">
                  <DetailPanel entry={responseEntry} showRequest={showRequestInResponse} />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}
    </div>
  );
}
