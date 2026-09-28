import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Empty, EmptyTitle } from "@/components/core/Empty";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import { validateEntryType } from "@/lib/validate-entry";
import type { KeyValuePair, KeyValueType } from "@/types/collection";

const ALL_TYPES: KeyValueType[] = ["string", "integer", "bool", "array", "object", "file"];

/** 与表头共用的网格模板：checkbox | 参数名 | 参数值 | 类型 | 说明 | 操作 */
const GRID = "grid grid-cols-[16px_minmax(0,0.8fr)_minmax(0,1.4fr)_72px_minmax(0,1fr)_48px] items-center gap-1";

interface KeyValueEditorProps {
  entries: KeyValuePair[];
  onChange: (entries: KeyValuePair[]) => void;
  addLabel: string;
  emptyLabel: string;
  /** 屏蔽不可选的类型（不出现在下拉里）。当前条目已有的类型始终保留，避免下拉无值。 */
  excludedTypes?: KeyValueType[];
}

export function KeyValueEditor({ entries, onChange, addLabel, emptyLabel, excludedTypes = [] }: KeyValueEditorProps) {
  const { t } = useLocale();

  // 已失焦过的行才展示行内校验红框，避免边输入边闪
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const markTouched = (i: number) =>
    setTouched((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });

  const handleChange = (i: number, field: "key" | "value" | "description", val: string) => {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)));
  };

  const handleTypeChange = (i: number, type: KeyValueType) => {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, type } : e)));
  };

  const handleRemove = (i: number) => {
    onChange(entries.filter((_, idx) => idx !== i));
  };

  const handleToggle = (i: number) => {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, enabled: e.enabled === false } : e)));
  };

  const handleAdd = () => {
    onChange([...entries, { key: "", value: "", description: "", enabled: true, type: "string" }]);
  };

  const handleBrowse = async (i: number) => {
    try {
      const selected = await open({ multiple: false });
      if (typeof selected === "string") {
        handleChange(i, "value", selected);
      }
    } catch {
      // 用户取消或出错，无操作
    }
  };

  return (
    <div className="px-2 py-1 min-h-0 flex flex-col">
      {entries.length === 0 ? (
        <div className="py-8 text-center">
          <Empty>
            <EmptyTitle>{emptyLabel}</EmptyTitle>
          </Empty>
        </div>
      ) : (
        <>
          <div className={`${GRID} border-b border-border/50 pb-1 mb-1`}>
            <span />
            <span className="pl-2.5 text-ui-2xs text-muted-foreground">{t("requestEditor.paramName")}</span>
            <span className="pl-2.5 text-ui-2xs text-muted-foreground">{t("requestEditor.paramValue")}</span>
            <span className="pl-2.5 text-ui-2xs text-muted-foreground">{t("requestEditor.paramType")}</span>
            <span className="pl-2.5 text-ui-2xs text-muted-foreground">{t("requestEditor.paramDescription")}</span>
            <span />
          </div>
          <div className="space-y-0.5">
            {entries.map((pair, i) => {
              const type = pair.type ?? "string";
              const availableTypes = ALL_TYPES.filter((t) => t === type || !excludedTypes.includes(t));
              const invalid = touched.has(i) ? validateEntryType(type, pair.value) : null;
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: TODO add stable id (index-based editing model)
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
                    onBlur={() => markTouched(i)}
                    className={cn(
                      "h-auto py-1 text-prose-sm font-mono border-0 rounded-md dark:bg-transparent focus-visible:bg-surface-elevated/70",
                      invalid ? "ring-1 ring-destructive focus-visible:ring-destructive" : "focus-visible:ring-0",
                    )}
                    title={invalid ? t(invalid) : undefined}
                    placeholder="Value"
                  />
                  <Select
                    value={type}
                    onValueChange={(v) => {
                      if (v) handleTypeChange(i, v as KeyValueType);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-auto py-1 w-full text-prose-sm border-0 focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      side="bottom"
                      alignItemWithTrigger={false}
                      sideOffset={4}
                      className="min-w-0 w-auto"
                    >
                      {availableTypes.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={pair.description ?? ""}
                    onChange={(e) => handleChange(i, "description", e.target.value)}
                    className="h-auto py-1 text-prose-sm border-0 rounded-md dark:bg-transparent focus-visible:ring-0 focus-visible:bg-surface-elevated/70"
                    placeholder="Description"
                  />
                  <div className="flex items-center justify-end gap-1">
                    {type === "file" && (
                      <button
                        onClick={() => handleBrowse(i)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-ui-xs text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50 transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <FolderOpenIcon className="size-3" />
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(i)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2Icon className="size-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <button
        onClick={handleAdd}
        className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1 text-ui-xs text-muted-foreground hover:border-primary hover:text-foreground hover:bg-surface-elevated/40 transition-colors"
      >
        <PlusIcon className="size-3" />
        {addLabel}
      </button>
    </div>
  );
}
