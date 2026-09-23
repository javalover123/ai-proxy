import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import RequestSendPanel from "@/features/new-request/RequestSendPanel";
import { buildSendBody } from "@/lib/body-utils";
import { buildFullUrl } from "@/lib/http-constants";
import type { BodyType, HttpMethod, KeyValuePair } from "@/types/collection";
import type { TrafficEntry } from "@/types/proxy";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: TrafficEntry | null;
  entries: TrafficEntry[];
  onSendSuccess?: (entryId: number) => void;
}

export default function EditRequestDialog({ open, onOpenChange, entry, entries, onSendSuccess }: Props) {
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState("");
  const [params, setParams] = useState<KeyValuePair[]>([]);
  const [headers, setHeaders] = useState<KeyValuePair[]>([]);
  const [cookies, setCookies] = useState<KeyValuePair[]>([]);
  const [body, setBody] = useState("");
  const [bodyType, setBodyType] = useState<BodyType>("text");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [responseEntryId, setResponseEntryId] = useState<number | null>(null);

  const cancelRef = useRef<AbortController | null>(null);

  // 打开弹窗时从 entry 填充表单，关闭时重置
  useEffect(() => {
    if (!open) return;
    setError("");
    setSending(false);
    setResponseEntryId(null);

    if (entry) {
      setMethod(entry.method as HttpMethod);
      setUrl(buildFullUrl(entry));
      setParams([]);
      setHeaders(
        Object.entries(entry.requestHeaders)
          .filter(([k]) => {
            const lk = k.toLowerCase();
            return lk !== "host" && lk !== "content-length" && lk !== "transfer-encoding";
          })
          .map(([key, value]) => ({ key, value, enabled: true })),
      );
      setCookies([]);
      setBody(entry.requestBody ?? "");
      setBodyType("text");
    } else {
      setMethod("GET");
      setUrl("");
      setParams([]);
      setHeaders([]);
      setCookies([]);
      setBody("");
      setBodyType("text");
    }
  }, [open, entry]);

  // 从 entries 中查找 send 后的响应条目
  const responseEntry = useMemo(() => {
    if (responseEntryId == null) return undefined;
    return entries.find((e) => e.id === responseEntryId);
  }, [entries, responseEntryId]);

  const responsePanelRef = usePanelRef();

  const handleSend = useCallback(async () => {
    if (sending || !url.trim()) return;

    setSending(true);
    setError("");

    const headerMap: Record<string, string> = {};
    for (const { key, value, enabled } of headers) {
      if (enabled !== false && key.trim()) headerMap[key.trim()] = value;
    }

    const controller = new AbortController();
    cancelRef.current = controller;

    try {
      const entryId = await invoke<number>("resend_request", {
        method,
        url: url.trim(),
        headers: headerMap,
        body: buildSendBody(bodyType, body),
      });
      if (controller.signal.aborted) return;
      setResponseEntryId(entryId);
      onSendSuccess?.(entryId);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(String(err));
    } finally {
      if (cancelRef.current === controller) {
        cancelRef.current = null;
      }
      setSending(false);
    }
  }, [sending, url, method, headers, body, bodyType, onSendSuccess]);

  const handleCancel = useCallback(() => {
    cancelRef.current?.abort();
    cancelRef.current = null;
    setSending(false);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col p-0 gap-0"
        style={{ width: "75vw", maxWidth: "70vw", height: "calc(80vh - 2rem)" }}
        showCloseButton={false}
      >
        <RequestSendPanel
          panelGroupId="edit-request-dialog"
          method={method}
          onMethodChange={setMethod}
          url={url}
          onUrlChange={setUrl}
          sending={sending}
          onSend={handleSend}
          params={params}
          headers={headers}
          cookies={cookies}
          body={body}
          bodyType={bodyType}
          onParamsChange={setParams}
          onHeadersChange={setHeaders}
          onCookiesChange={setCookies}
          onBodyChange={setBody}
          onBodyTypeChange={setBodyType}
          responseEntry={responseEntry}
          showRequestInResponse={false}
          detailPosition="bottom"
          responsePanelRef={responsePanelRef}
          error={error}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
