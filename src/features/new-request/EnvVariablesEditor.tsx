// src/features/new-request/EnvVariablesEditor.tsx

import { PlusIcon, Trash2Icon } from "lucide-react";
import { Empty, EmptyTitle } from "@/components/core/Empty";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/hooks/useLocale";
import type { EnvVariable } from "@/types/env";

/** 与表头共用的网格模板：checkbox | 变量名 | 变量值 | 操作（精简版，无类型/说明） */
const GRID = "grid grid-cols-[16px_minmax(0,0.8fr)_minmax(0,1.4fr)_28px] items-center gap-1";

interface EnvVariablesEditorProps {
  entries: EnvVariable[];
  onChange: (entries: EnvVariable[]) => void;
}

export function EnvVariablesEditor({ entries, onChange }: EnvVariablesEditorProps) {
  const { t } = useLocale();

  const handleChange = (i: number, field: "key" | "value", val: string) => {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)));
  };

  const handleToggle = (i: number) => {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, enabled: !e.enabled } : e)));
  };

  const handleRemove = (i: number) => {
    onChange(entries.filter((_, idx) => idx !== i));
  };

  const handleAdd = () => {
    onChange([...entries, { key: "", value: "", enabled: true }]);
  };

  return (
    <div className="px-2 py-1 min-h-0 flex flex-col">
      {entries.length === 0 ? (
        <div className="py-8 text-center">
          <Empty>
            <EmptyTitle>{t("tab.envEmptyVariables")}</EmptyTitle>
          </Empty>
        </div>
      ) : (
        <>
          <div className={`${GRID} border-b border-border/50 pb-1 mb-1`}>
            <span />
            <span className="pl-2.5 text-ui-2xs text-muted-foreground">{t("tab.envVarName")}</span>
            <span className="pl-2.5 text-ui-2xs text-muted-foreground">{t("tab.envVarValue")}</span>
            <span />
          </div>
          <div className="space-y-0.5">
            {entries.map((pair, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: index-based editing model
                key={i}
                className={`${GRID} group rounded-md py-0.5 hover:bg-surface-elevated/60 transition-colors`}
              >
                <Checkbox checked={pair.enabled !== false} onCheckedChange={() => handleToggle(i)} />
                <Input
                  value={pair.key}
                  onChange={(e) => handleChange(i, "key", e.target.value)}
                  className="h-auto py-1 text-prose-sm font-mono border-0 rounded-md dark:bg-transparent focus-visible:ring-0 focus-visible:bg-surface-elevated/70"
                  placeholder="Key"
                />
                <Input
                  value={pair.value}
                  onChange={(e) => handleChange(i, "value", e.target.value)}
                  className="h-auto py-1 text-prose-sm font-mono border-0 rounded-md dark:bg-transparent focus-visible:ring-0 focus-visible:bg-surface-elevated/70"
                  placeholder="Value"
                />
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => handleRemove(i)}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={t("tab.envDelete")}
                  >
                    <Trash2Icon className="size-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <button
        type="button"
        onClick={handleAdd}
        className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1 text-ui-xs text-muted-foreground hover:border-primary hover:text-foreground hover:bg-surface-elevated/40 transition-colors"
      >
        <PlusIcon className="size-3" />
        {t("tab.envAddVariable")}
      </button>
    </div>
  );
}
