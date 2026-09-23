import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { TrafficEntry } from "@/types/proxy";
import SummaryBar from "./components/SummaryBar";
import RequestPanel from "./RequestPanel";
import ResponsePanel from "./ResponsePanel";

interface Props {
  entry: TrafficEntry | undefined;
  onClose?: () => void;
  /** 是否展示左侧请求面板，默认 true。false 时只展示响应面板 */
  showRequest?: boolean;
}

export default function DetailPanel({ entry, onClose, showRequest = true }: Props) {
  const requestPanelRef = useRef<PanelImperativeHandle>(null);
  const responsePanelRef = useRef<PanelImperativeHandle>(null);

  // null = split 50/50, 'request' = request full, 'response' = response full
  const [fullPanel, setFullPanel] = useState<"request" | "response" | null>(null);

  /** DB 回填：瘦身条目 body 被清空后，打开详情时按需从 DB 拉取完整数据 */
  const [hydratedEntry, setHydratedEntry] = useState<TrafficEntry | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate field deps
  useEffect(() => {
    if (!entry) {
      setHydratedEntry(null);
      return;
    }
    // 已瘦身：body 清空但请求已完成（有 status），从 DB 回查
    if (entry.responseChunks.length === 0 && entry.status != null) {
      invoke<TrafficEntry>("get_traffic_detail", { id: entry.id })
        .then(setHydratedEntry)
        .catch(() => setHydratedEntry(null));
    } else {
      setHydratedEntry(null);
    }
  }, [entry?.id, entry?.status]);

  const displayEntry = hydratedEntry ?? entry;

  // 切换条目时重置面板状态
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on entry.id
  useEffect(() => {
    if (!entry) return;
    setFullPanel(null);
    const req = requestPanelRef.current;
    const resp = responsePanelRef.current;
    if (req?.isCollapsed()) req.resize("50");
    if (resp?.isCollapsed()) resp.resize("50");
  }, [entry?.id]);

  const handleRequestTitleClick = useCallback(() => {
    const req = requestPanelRef.current;
    const resp = responsePanelRef.current;
    if (!req || !resp) return;

    if (fullPanel === "request") {
      // Request 已占满 → 恢复 50/50
      resp.expand();
      req.resize("50");
      setFullPanel(null);
    } else {
      // 50/50 或 Response 占满 → Request 占满
      req.resize("100");
      resp.collapse();
      setFullPanel("request");
    }
  }, [fullPanel]);

  const handleResponseTitleClick = useCallback(() => {
    const req = requestPanelRef.current;
    const resp = responsePanelRef.current;
    if (!req || !resp) return;

    if (fullPanel === "response") {
      // Response 已占满 → 恢复 50/50
      req.expand();
      resp.resize("50");
      setFullPanel(null);
    } else {
      // 50/50 或 Request 占满 → Response 占满
      resp.resize("100");
      req.collapse();
      setFullPanel("response");
    }
  }, [fullPanel]);

  return (
    <div className="flex min-h-0 min-w-0 h-full flex-col overflow-hidden bg-surface-base">
      {/* response-only 模式（new-request 响应区）下 URL 已在上方输入框可见，不再弹 tooltip */}
      {displayEntry && <SummaryBar entry={displayEntry} onClose={onClose} showUriTooltip={showRequest} />}

      <ResizablePanelGroup
        key={showRequest ? "2col" : "1col"}
        orientation="horizontal"
        id={showRequest ? "detail-panel" : "detail-panel-response"}
        className="min-h-0 flex-1"
      >
        {showRequest && (
          <>
            <ResizablePanel
              id="request"
              defaultSize="50"
              minSize="15"
              collapsible
              collapsedSize={0}
              panelRef={requestPanelRef}
            >
              <div className="flex flex-col min-h-0 min-w-0 h-full overflow-hidden">
                <RequestPanel entry={displayEntry} onTitleClick={handleRequestTitleClick} />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}

        <ResizablePanel
          id="response"
          defaultSize={showRequest ? "50" : "100"}
          minSize="15"
          collapsible
          collapsedSize={0}
          panelRef={responsePanelRef}
        >
          <div className="flex flex-col min-h-0 min-w-0 h-full overflow-hidden">
            <ResponsePanel entry={displayEntry} onTitleClick={handleResponseTitleClick} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
