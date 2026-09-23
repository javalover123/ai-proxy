// src/features/new-request/tabs/FormDataEditor.tsx

import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Empty } from "@/components/core/Empty";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/hooks/useLocale";
import type { FormDataEntry } from "@/lib/body-utils";
import { parseFormDataBody, serializeFormDataBody } from "@/lib/body-utils";

interface FormDataEditorProps {
  body: string;
  onChange: (body: string) => void;
}

export default function FormDataEditor({ body, onChange }: FormDataEditorProps) {
  const { t } = useLocale();

  const entries: FormDataEntry[] = useMemo(() => parseFormDataBody(body), [body]);

  const flush = useCallback(
    (next: FormDataEntry[]) => {
      // 过滤掉全部为空的占位行
      const filled = next.filter((e) => e.key.trim() || e.value.trim());
      onChange(filled.length > 0 ? serializeFormDataBody(filled) : "");
    },
    [onChange],
  );

  const persist = useCallback(
    (next: FormDataEntry[]) => {
      onChange(serializeFormDataBody(next));
    },
    [onChange],
  );

  const handleChange = useCallback(
    (i: number, field: keyof FormDataEntry, val: string | boolean) => {
      const next = entries.map((e, idx) => (idx === i ? { ...e, [field]: val } : e));
      // type 变更不应清理空行（用户刚添加行并选了文件类型时，key/value 可能还为空）
      if (field === "type") {
        persist(next);
      } else {
        flush(next);
      }
    },
    [entries, flush, persist],
  );

  const handleRemove = useCallback(
    (i: number) => {
      const next = entries.filter((_, idx) => idx !== i);
      persist(next);
    },
    [entries, persist],
  );

  const handleToggle = useCallback(
    (i: number) => {
      const next = entries.map((e, idx) => (idx === i ? { ...e, enabled: e.enabled === false } : e));
      persist(next);
    },
    [entries, persist],
  );

  const handleAdd = useCallback(() => {
    persist([...entries, { key: "", value: "", enabled: true, type: "text" }]);
  }, [entries, persist]);

  const handleBrowse = useCallback(
    async (i: number) => {
      try {
        const selected = await open({ multiple: false });
        if (selected) {
          handleChange(i, "value", selected);
        }
      } catch {
        // 用户取消或出错，无操作
      }
    },
    [handleChange],
  );

  const isEmpty = entries.length === 0;

  return (
    <div className="px-2 py-1 space-y-1 min-h-0 flex flex-col">
      <div className="flex justify-end mb-1.5">
        <button
          onClick={handleAdd}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <PlusIcon className="size-3" />
          {t("requestEditor.bodyFormDataAddField")}
        </button>
      </div>
      {isEmpty ? (
        <div className="py-8 text-center">
          <Empty />
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((entry, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: TODO add stable id (index-based editing model)
            <div key={i} className="flex gap-1 items-center">
              <Checkbox checked={entry.enabled !== false} onCheckedChange={() => handleToggle(i)} />
              <Input
                value={entry.key}
                onChange={(e) => handleChange(i, "key", e.target.value)}
                className="flex-1 h-auto py-1 text-prose-sm font-mono"
                placeholder="Key"
              />
              <Input
                value={entry.value}
                onChange={(e) => handleChange(i, "value", e.target.value)}
                className="flex-[2] h-auto py-1 text-prose-sm font-mono"
                placeholder="Value"
              />
              <Select
                value={entry.type}
                onValueChange={(v) => {
                  if (v) handleChange(i, "type", v);
                }}
              >
                <SelectTrigger size="sm" className="h-auto py-1 w-[60px] shrink-0 text-prose-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  align="start"
                  side="bottom"
                  alignItemWithTrigger={false}
                  sideOffset={4}
                  className="min-w-0 w-auto"
                >
                  <SelectItem value="text">text</SelectItem>
                  <SelectItem value="file">file</SelectItem>
                </SelectContent>
              </Select>
              {entry.type === "file" && (
                <button
                  onClick={() => handleBrowse(i)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-ui-xs text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50 transition-colors"
                >
                  <FolderOpenIcon className="size-3" />
                </button>
              )}
              <button
                onClick={() => handleRemove(i)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2Icon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
