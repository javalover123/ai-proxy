import { useLocale } from "@/hooks/useLocale";
import type { TypeFilter } from "@/lib/format";
import { TYPE_FILTERS } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_FILTER_LABELS: Record<TypeFilter, string> = {
  all: "typeFilter.all",
  http: "typeFilter.http",
  https: "typeFilter.https",
  websocket: "typeFilter.websocket",
  js: "typeFilter.js",
  css: "typeFilter.css",
  html: "typeFilter.html",
  json: "typeFilter.json",
  img: "typeFilter.img",
  font: "typeFilter.font",
  media: "typeFilter.media",
  other: "typeFilter.other",
};

interface TypeFilterBarProps {
  active: TypeFilter;
  counts: Map<TypeFilter, number>;
  onChange: (f: TypeFilter) => void;
  running: boolean;
  status: string;
}

export function TypeFilterBar({ active, counts, onChange, running, status }: TypeFilterBarProps) {
  const { t } = useLocale();

  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-1.5 py-1 border-b border-surface-elevated bg-surface-base/50">
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {TYPE_FILTERS.map((f) => {
          const count = counts.get(f) ?? 0;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onChange(f)}
              className={cn(
                "relative px-2 py-1 text-ui-sm font-medium transition-colors whitespace-nowrap",
                active === f ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(TYPE_FILTER_LABELS[f])}
              {active === f && (
                <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-foreground/70 rounded-full" />
              )}
              {count > 0 && (
                <span
                  className={cn(
                    "text-ui-xs tabular-nums",
                    active === f ? "text-foreground" : "text-muted-foreground/60",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="ml-auto shrink-0" />
      {running ? (
        <span className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ui-sm font-medium bg-emerald-500/10 text-emerald-400 shrink-0">
          <span className="inline-block size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {status.replace("Running on ", "")}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ui-sm font-medium bg-muted text-muted-foreground shrink-0">
          <span className="inline-block size-1.5 rounded-full bg-muted-foreground" />
          {t("app.stopped")}
        </span>
      )}
    </div>
  );
}
