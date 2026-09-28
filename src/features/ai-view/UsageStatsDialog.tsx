import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { subscribeAiEvents } from "@/hooks/aiEventBus";
import { cn } from "@/lib/utils";
import type { AiUsageSummary } from "@/types/ai";

import { DateRangePicker } from "./DateRangePicker";
import { type DateRange, parseDate, resolvePreset } from "./date";
import { TokenValue } from "./TokenValue";

/** 计算所选日期区间的 [startMs, endMs) 区间（本地时区）。起止无效时返回 null。 */
function computeRange(range: DateRange): { startMs: number; endMs: number } | null {
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  if (!start || !end || start > end) return null;
  return {
    startMs: start.getTime(),
    endMs: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime(),
  };
}

function StatCard({
  label,
  value,
  token,
  accent,
  pending,
}: {
  label: string;
  value: number;
  token?: boolean;
  accent?: boolean;
  pending?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-deep p-3">
      <div className="text-ui-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono tabular-nums text-prose-lg", accent ? "text-violet-400" : "text-foreground")}>
        {pending ? "…" : token ? <TokenValue value={value} /> : value.toLocaleString()}
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UsageStatsDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [range, setRange] = useState<DateRange>(() => resolvePreset("today"));
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const ms = useMemo(() => computeRange(range), [range]);

  const fetchSummary = useCallback(() => {
    if (!ms) {
      setSummary(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    invoke<AiUsageSummary>("get_ai_usage_summary", { startMs: ms.startMs, endMs: ms.endMs })
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [ms]);

  // 打开时拉取
  useEffect(() => {
    if (open) fetchSummary();
  }, [open, fetchSummary]);

  // 实时刷新：AI 事件到达后 debounce 重查
  useEffect(() => {
    if (!open) return;
    let timer: number | null = null;
    const unsub = subscribeAiEvents(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(fetchSummary, 500);
    });
    return () => {
      unsub();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [open, fetchSummary]);

  const pending = loading && !summary;
  const values = summary ?? { requestCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("aiUsage.title")}</DialogTitle>
        </DialogHeader>

        <DateRangePicker value={range} onChange={setRange} />

        {!ms ? (
          <p className="text-ui-sm text-muted-foreground">{t("aiUsage.customHint")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <StatCard label={t("aiUsage.requests")} value={values.requestCount} pending={pending} />
            <StatCard label={t("aiUsage.inputTokens")} value={values.inputTokens} token pending={pending} />
            <StatCard label={t("aiUsage.outputTokens")} value={values.outputTokens} token pending={pending} />
            <StatCard label={t("aiUsage.totalTokens")} value={values.totalTokens} token accent pending={pending} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
