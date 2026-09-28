import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { DetailPosition } from "@/features/bottom-bar";
import DetailPanel from "@/features/detail-panel/DetailPanel";
import { classifyEntry, extractHost, type TypeFilter } from "@/lib/format";
import { buildFullUrl } from "@/lib/http-constants";
import type { ProxyJumpTarget, TrafficEntry } from "@/types/proxy";
import DomainSidebar from "./DomainSidebar";
import EditRequestDialog from "./EditRequestDialog";
import type { SortColumn, SortOrder } from "./RequestList";
import RequestList from "./RequestList";

interface Props {
  entries: TrafficEntry[];
  showSidebar: boolean;
  detailPosition: DetailPosition;
  onAutoOpenDetail: () => void;
  typeFilter: TypeFilter;
  jumpTarget?: ProxyJumpTarget | null;
}

export default function TrafficLog({
  entries,
  showSidebar,
  detailPosition,
  onAutoOpenDetail,
  typeFilter,
  jumpTarget,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [editEntry, setEditEntry] = useState<TrafficEntry | null>(null);
  /** 由 resend/edit-send 触发的内部跳转信号（独立于 AI 视图 jumpTarget） */
  const [scrollTarget, setScrollTarget] = useState<ProxyJumpTarget | null>(null);
  const scrollNonceRef = useRef(0);
  const [pinnedDomains, setPinnedDomains] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("ai-proxy-pinned-domains");
      if (stored) return new Set(JSON.parse(stored));
    } catch {}
    return new Set();
  });

  const domainPanelRef = useRef<PanelImperativeHandle>(null);

  // Sync domain sidebar collapse/expand with showSidebar prop
  useEffect(() => {
    const panel = domainPanelRef.current;
    if (!panel) return;
    if (showSidebar) {
      panel.resize("18%");
    } else {
      panel.collapse();
    }
  }, [showSidebar]);

  // 响应来自 AI 视图的跳转指令：清域名过滤保证目标行可见，选中并展开详情。
  // 仅认 nonce，重复跳同一条也能重触发；滚动由 RequestList 负责。
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on nonce intentionally
  useEffect(() => {
    if (!jumpTarget) return;
    setSelectedDomain(null);
    setSelectedId(jumpTarget.id);
    if (detailPosition === "hidden") onAutoOpenDetail();
  }, [jumpTarget?.nonce]);

  const handleTogglePin = useCallback((domain: string) => {
    setPinnedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      localStorage.setItem("ai-proxy-pinned-domains", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const domains = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const host = extractHost(e.uri);
      if (host === "(unknown)") {
        const hostHeader = e.requestHeaders?.host ?? e.requestHeaders?.Host ?? "";
        if (hostHeader) {
          const fallbackHost = hostHeader.split(":")[0];
          map.set(fallbackHost, (map.get(fallbackHost) ?? 0) + 1);
          continue;
        }
      }
      map.set(host, (map.get(host) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const filtered = useMemo(() => {
    let result = entries;
    if (selectedDomain) {
      result = result.filter((e) => {
        const host = extractHost(e.uri);
        if (host !== "(unknown)") return host === selectedDomain;
        const hostHeader = e.requestHeaders?.host ?? e.requestHeaders?.Host ?? "";
        return hostHeader.startsWith(selectedDomain);
      });
    }
    if (typeFilter !== "all") {
      result = result.filter((e) => classifyEntry(e) === typeFilter);
    }
    return result;
  }, [entries, selectedDomain, typeFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (!sortColumn) return copy;
    copy.sort((a, b) => {
      let cmp: number;
      switch (sortColumn) {
        case "id":
          cmp = a.requestNumber - b.requestNumber;
          break;
        case "url":
          cmp = a.uri.localeCompare(b.uri);
          break;
        case "method":
          cmp = a.method.localeCompare(b.method);
          break;
        case "status":
          cmp = (a.status ?? -1) - (b.status ?? -1);
          break;
        case "duration":
          cmp = (a.durationMs ?? -1) - (b.durationMs ?? -1);
          break;
        case "time":
          cmp = a.requestTimestamp - b.requestTimestamp;
          break;
        case "tls":
          cmp = (a.decrypted ? 1 : 0) - (b.decrypted ? 1 : 0);
          break;
        default:
          return 0;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [filtered, sortColumn, sortOrder]);

  // 合并两个跳转源：resend/edit → scrollTarget，AI 视图 → jumpTarget
  const effectiveTarget = scrollTarget ?? jumpTarget;

  const selected = entries.find((e) => e.id === selectedId);

  // 延迟 DetailPanel 的 entry 更新：选中高亮立即生效，DetailPanel 在下一空闲帧渲染
  const deferredSelected = useDeferredValue(selected);

  const handleSelectEntry = useCallback(
    (id: number) => {
      setSelectedId(id);
      if (detailPosition === "hidden") {
        // 先让行高亮渲染一帧，再打开 detail 面板——否则布局重排阻塞高亮绘制
        setTimeout(() => onAutoOpenDetail(), 0);
      }
    },
    [detailPosition, onAutoOpenDetail],
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleEditRequest = useCallback((entry: TrafficEntry) => {
    setEditEntry(entry);
  }, []);

  const handleSendSuccess = useCallback((entryId: number) => {
    // EditRequestDialog 发送成功后选中并滚动到新条目。
    // nonce 自增确保重复发同一条也能重触发滚动。
    scrollNonceRef.current += 1;
    setScrollTarget({ id: entryId, nonce: scrollNonceRef.current });
    setSelectedId(entryId);
  }, []);

  const handleResendRequest = useCallback(async (entry: TrafficEntry) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry.requestHeaders)) {
      const lk = k.toLowerCase();
      if (lk === "host" || lk === "content-length" || lk === "transfer-encoding") continue;
      headers[k] = v;
    }

    try {
      const entryId = await invoke<number>("resend_request", {
        method: entry.method,
        url: buildFullUrl(entry),
        headers,
        body: entry.requestBody ? { mode: "raw", content: entry.requestBody } : null,
      });
      // 清域名过滤保证新条目在列表中可见，选中并滚动到目标行
      setSelectedDomain(null);
      scrollNonceRef.current += 1;
      setScrollTarget({ id: entryId, nonce: scrollNonceRef.current });
      setSelectedId(entryId);
    } catch (err) {
      console.error("resend invoke failed:", err);
    }
  }, []);

  const handleSortChange = useCallback((column: SortColumn, order: SortOrder) => {
    setSortColumn(column);
    setSortOrder(order);
  }, []);

  const requestList = (
    <RequestList
      entries={sorted}
      selectedId={selectedId}
      onSelectEntry={handleSelectEntry}
      sortColumn={sortColumn}
      sortOrder={sortOrder}
      onSortChange={handleSortChange}
      onResendRequest={handleResendRequest}
      onEditRequest={handleEditRequest}
      scrollToId={effectiveTarget?.id}
      scrollNonce={effectiveTarget?.nonce}
    />
  );

  const detailPanel = <MemoDetailPanel entry={deferredSelected} onClose={handleCloseDetail} />;

  // Inner content: varies by detailPosition.
  const mainContent = (() => {
    if (detailPosition === "hidden") {
      return <div className="h-full min-h-0 min-w-0">{requestList}</div>;
    }
    if (detailPosition === "bottom") {
      return (
        <ResizablePanelGroup key="bottom" orientation="vertical" id="main-bottom" className="h-full">
          <ResizablePanel id="list" defaultSize="40%" minSize="20%">
            <div className="h-full min-h-0">{requestList}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="detail" defaultSize="60%" minSize="20%">
            <div className="h-full min-h-0">{detailPanel}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    // right
    return (
      <ResizablePanelGroup key="right" orientation="horizontal" id="main-right" className="h-full">
        <ResizablePanel id="list" defaultSize="55%" minSize="20%">
          <div className="h-full min-h-0 min-w-0">{requestList}</div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="detail" defaultSize="45%" minSize="20%">
          <div className="h-full min-h-0 min-w-0">{detailPanel}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  })();

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ResizablePanelGroup orientation="horizontal" id="trafficlog-outer" className="h-full">
        <ResizablePanel
          id="domain-sidebar"
          defaultSize={showSidebar ? "18%" : 0}
          minSize="8%"
          maxSize="100%"
          collapsible
          collapsedSize={0}
          panelRef={domainPanelRef}
        >
          <div className="h-full min-h-0 overflow-hidden">
            <DomainSidebar
              domains={domains}
              totalEntries={entries.length}
              selectedDomain={selectedDomain}
              onSelectDomain={setSelectedDomain}
              pinnedDomains={pinnedDomains}
              onTogglePin={handleTogglePin}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="main" defaultSize="82%" minSize="20%">
          {mainContent}
        </ResizablePanel>
      </ResizablePanelGroup>

      <EditRequestDialog
        open={editEntry !== null}
        onOpenChange={(open) => {
          if (!open) setEditEntry(null);
        }}
        entry={editEntry}
        entries={entries}
        onSendSuccess={handleSendSuccess}
      />
    </div>
  );
}

const MemoDetailPanel = memo(DetailPanel);
