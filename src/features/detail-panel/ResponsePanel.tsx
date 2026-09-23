import { invoke } from "@tauri-apps/api/core";
import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/core/CopyButton";
import { Empty, EmptyTitle } from "@/components/core/Empty";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/useLocale";
import { extractHost } from "@/lib/format";
import { formatTrafficForAi } from "@/lib/format-for-ai";
import { isStreamingContentType } from "@/lib/sse";
import type { TrafficEntry } from "@/types/proxy";
import type { SslConfig } from "@/types/settings";
import BodyView from "./components/BodyView";
import KeyValueTable from "./components/KeyValueTable";
import RawView from "./components/RawView";
import SidePanel, { type PanelTab, type TabDef } from "./components/SidePanel";
import StreamingViewer from "./StreamingViewer";

interface Props {
  entry: TrafficEntry | undefined;
  onTitleClick?: () => void;
}

function parseResponseCookies(headers: Record<string, string>): Record<string, string> {
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === "set-cookie");
  if (!entry) return {};
  const result: Record<string, string> = {};
  entry[1].split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const semiIdx = trimmed.indexOf(";");
    const kvPart = semiIdx === -1 ? trimmed : trimmed.slice(0, semiIdx);
    const eqIdx = kvPart.indexOf("=");
    if (eqIdx > 0) {
      result[kvPart.slice(0, eqIdx).trim()] = kvPart.slice(eqIdx + 1).trim();
    }
  });
  return result;
}

function DecryptPrompt({ host, t }: { host: string; t: (key: string) => string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleEnableSsl = useCallback(async () => {
    setLoading(true);
    try {
      const config: SslConfig = await invoke("get_ssl_config");
      const exists = config.whitelist.some((item) => item.domain.toLowerCase() === host.toLowerCase());
      const updated: SslConfig = {
        enabled: true,
        whitelist: exists ? config.whitelist : [...config.whitelist, { domain: host, enabled: true }],
      };
      await invoke("save_ssl_config", { ssl: updated });
      setDone(true);
    } catch (_) {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [host]);

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-prose-sm">
        <ShieldCheckIcon className="size-8 text-emerald-400" />
        <span className="text-muted-foreground text-center px-6">{host}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2">
      <ShieldOffIcon className="size-8 text-muted-foreground/40" />
      <span className="text-muted-foreground text-center px-6">{t("detail.decryptPrompt")}</span>
      <Button variant="secondary" size="sm" className="mt-1" onClick={handleEnableSsl} disabled={loading}>
        {loading ? "..." : t("detail.decryptAction")}
      </Button>
    </div>
  );
}

function formatResponseRaw(entry: TrafficEntry): string {
  if (!entry.responseHeaders) return "";
  const lines = [`HTTP/1.1 ${entry.status ?? "..."}`];
  for (const [key, value] of Object.entries(entry.responseHeaders)) {
    lines.push(`${key}: ${value}`);
  }
  const body = entry.responseChunks.join("");
  if (body) {
    lines.push("", body);
  }
  return lines.join("\n");
}

export default function ResponsePanel({ entry, onTitleClick }: Props) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [tab, setTab] = useState<PanelTab>("body");

  // 切换条目时回退到 body
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on entry.id
  useEffect(() => {
    setTab("body");
  }, [entry?.id]);

  const tabs = useMemo<TabDef[]>(() => {
    if (!entry) {
      return [
        { id: "header", labelKey: "detail.headers" },
        { id: "body", labelKey: "detail.body" },
        { id: "raw", labelKey: "detail.raw" },
      ];
    }
    const hasStream = (entry.responseChunks?.length ?? 0) > 1 || isStreamingContentType(entry.responseHeaders);
    const hasError = !!entry.error;
    const base: TabDef[] = [
      { id: "header", labelKey: "detail.headers" },
      { id: "cookies", labelKey: "detail.cookies" },
      { id: "body", labelKey: "detail.body" },
    ];
    if (hasStream) {
      base.push({ id: "stream", labelKey: "detail.stream" });
    }
    base.push({ id: "raw", labelKey: "detail.raw" });
    if (hasError) {
      base.push({ id: "console", labelKey: "detail.console" });
    }
    return base;
  }, [entry]);

  // 切换条目时如果 stream tab 不再可用，切回 header
  useEffect(() => {
    if (tab === "stream") {
      const hasStream =
        entry && ((entry.responseChunks?.length ?? 0) > 1 || isStreamingContentType(entry.responseHeaders));
      if (!hasStream) setTab("header");
    }
  }, [entry, tab]);

  const copyForAiText = useMemo(() => {
    if (!entry) return "";
    return formatTrafficForAi(entry, locale);
  }, [entry, locale]);

  const tabCounts = useMemo(() => {
    if (!entry) return {};
    const counts: Partial<Record<PanelTab, number | null>> = {};
    // headers
    if (entry.responseHeaders) {
      counts.header = Object.keys(entry.responseHeaders).length;
    }
    // cookies
    const cookies = entry.responseHeaders ? parseResponseCookies(entry.responseHeaders) : {};
    counts.cookies = Object.keys(cookies).length;
    // body
    const body = entry.responseChunks.join("");
    counts.body = body ? 1 : 0;
    // stream
    counts.stream = entry.responseChunks.length;
    // raw
    const raw = formatResponseRaw(entry);
    counts.raw = raw ? 1 : 0;
    // console
    counts.console = entry.error ? 1 : 0;
    return counts;
  }, [entry]);

  return (
    <SidePanel
      title={t("detail.response")}
      tab={tab}
      onTabChange={setTab}
      tabs={tabs}
      bodySize={entry?.responseChunks.reduce((s, c) => s + c.length, 0)}
      onTitleClick={onTitleClick}
      tabCounts={tabCounts}
      actions={
        entry && (!!entry.error || (entry.status != null && entry.status !== 200)) ? (
          <CopyButton
            text={copyForAiText}
            size="xs"
            label={t("detail.copyForAi")}
            className="text-ui-xs text-muted-foreground hover:text-foreground transition-colors"
          />
        ) : undefined
      }
    >
      <ResponsePanelContent tab={tab} entry={entry} t={t} onCloseStream={() => setTab("header")} />
    </SidePanel>
  );
}

function ResponsePanelContent({
  tab,
  entry,
  t,
  onCloseStream,
}: {
  tab: PanelTab;
  entry: TrafficEntry | undefined;
  t: (key: string) => string;
  onCloseStream: () => void;
}) {
  if (!entry) {
    if (tab === "header" || tab === "cookies") {
      return <KeyValueTable data={{}} emptyLabel="" />;
    }
    return (
      <Empty>
        <EmptyTitle></EmptyTitle>
      </Empty>
    );
  }

  if (tab === "header") {
    return entry.responseHeaders ? (
      <KeyValueTable data={entry.responseHeaders} emptyLabel={t("detail.noHeaders")} />
    ) : (
      <Empty>
        <EmptyTitle>{t("detail.responsePending")}</EmptyTitle>
      </Empty>
    );
  }

  if (tab === "cookies") {
    const cookies = entry.responseHeaders ? parseResponseCookies(entry.responseHeaders) : {};
    return <KeyValueTable data={cookies} emptyLabel="" />;
  }

  if (tab === "body") {
    const body = entry.responseChunks.join("");
    const host = extractHost(entry.uri);
    const isEncrypted = entry.decrypted === false && entry.uri.startsWith("https://");
    if (isEncrypted && !body) {
      return <DecryptPrompt host={host} t={t} />;
    }
    return body ? <BodyView body={body} contentType={entry.responseContentType} /> : <Empty />;
  }

  if (tab === "stream") {
    return <StreamingViewer entry={entry} onClose={onCloseStream} />;
  }

  if (tab === "console") {
    return entry.error ? (
      <RawView content={entry.error} />
    ) : (
      <Empty>
        <EmptyTitle>{t("detail.noConsole")}</EmptyTitle>
      </Empty>
    );
  }

  // raw
  const content = formatResponseRaw(entry);
  return <RawView content={content} />;
}
