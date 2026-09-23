import { Combobox } from "@base-ui/react/combobox";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import type { AiRuleSource, AiUrlRule } from "@/types/settings";

/** provider 下拉里「自动检测」对应后端 provider: null */
const PROVIDER_AUTO = "auto";

/** 已知来源名 → 默认合并头：选中后自动填 header，仍可手动覆盖。
 *  value 为空串表示该客户端暂无已知合并头，不自动填充。 */
const DEFAULT_MERGE_HEADERS: Record<string, string> = {
  "Claude Code": "x-claude-code-session-id",
  Cursor: "x-cursor-session",
  Cline: "",
  Windsurf: "",
  "Cherry Studio": "",
  NextChat: "",
  LobeChat: "",
  Browser: "",
};

interface Props {
  /** null = 新增；否则为被编辑规则（用于表单预填） */
  initial: AiUrlRule | null;
  /** 其余规则的 URL（已小写化，重复校验用） */
  existingUrls: string[];
  onConfirm: (rule: Omit<AiUrlRule, "enabled">) => void;
  onCancel: () => void;
}

/** 纯表单组件 — 不含 Dialog 外壳，由父组件嵌入侧滑面板使用 */
export default function RuleEditForm({ initial, existingUrls, onConfirm, onCancel }: Props) {
  const { t } = useLocale();
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState(PROVIDER_AUTO);
  const [sources, setSources] = useState<AiRuleSource[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setUrl(initial?.url ?? "");
    setProvider(initial?.provider ?? (initial ? PROVIDER_AUTO : "openai"));
    setSources(initial?.sources ?? []);
    setError("");
  }, [initial]);

  function updateSource(index: number, patch: Partial<AiRuleSource>) {
    setSources((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addSource() {
    setSources((prev) => [...prev, { name: "", merge_header: "" }]);
  }

  function removeSource(index: number) {
    setSources((prev) => prev.filter((_, i) => i !== index));
  }

  function handleConfirm() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (existingUrls.includes(trimmed.toLowerCase())) {
      setError(t("aiConfig.duplicateUrl"));
      return;
    }
    const cleaned = sources
      .map((s) => ({ name: s.name.trim(), merge_header: s.merge_header.trim() }))
      .filter((s) => s.name !== "" || s.merge_header !== "");
    onConfirm({
      url: trimmed,
      provider: provider === PROVIDER_AUTO ? null : provider,
      sources: cleaned,
    });
  }

  const titleKey = initial ? "aiConfig.editRule" : "aiConfig.addRule";

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏：返回按钮 + 标题 */}
      <div className="flex items-center gap-2 pb-4">
        <Button variant="ghost" size="icon-sm" onClick={onCancel}>
          <XIcon className="size-4" />
          <span className="sr-only">{t("aiConfig.back")}</span>
        </Button>
        <h3 className="text-sm font-medium text-foreground">{t(titleKey)}</h3>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {/* URL */}
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("aiConfig.fieldUrl")}</span>
          <Input
            autoFocus
            className="font-mono text-xs"
            value={url}
            placeholder={t("aiConfig.placeholderUrl")}
            onChange={(e) => {
              setUrl(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
          />
          {error ? (
            <span className="text-ui-sm text-destructive">{error}</span>
          ) : (
            <span className="text-ui-sm text-muted-foreground/75">{t("aiConfig.urlHint")}</span>
          )}
        </label>

        {/* Provider */}
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("aiConfig.fieldProvider")}</span>
          <Select value={provider} onValueChange={(v) => v && setProvider(v)}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: unknown) => (v === PROVIDER_AUTO ? t("aiConfig.providerAuto") : String(v))}
              </SelectValue>
            </SelectTrigger>
            <SelectPrimitive.Portal>
              <SelectPrimitive.Positioner
                side="bottom"
                sideOffset={4}
                alignItemWithTrigger={false}
                collisionAvoidance={{ side: "none" }}
                className="isolate z-50"
              >
                <SelectPrimitive.Popup className="relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
                  <SelectPrimitive.List>
                    <SelectItem value="openai">openai</SelectItem>
                    <SelectItem value="openai-responses">openai-responses</SelectItem>
                    <SelectItem value="anthropic">anthropic</SelectItem>
                    <SelectItem value="gemini">gemini</SelectItem>
                    <SelectItem value={PROVIDER_AUTO}>{t("aiConfig.providerAuto")}</SelectItem>
                  </SelectPrimitive.List>
                </SelectPrimitive.Popup>
              </SelectPrimitive.Positioner>
            </SelectPrimitive.Portal>
          </Select>
        </label>

        {/* Sources */}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {t("aiConfig.fieldSources")}
              <span className="ml-1.5 font-normal opacity-70">{t("aiConfig.sourcesHint")}</span>
            </span>
            <Button variant="ghost" size="xs" onClick={addSource}>
              <PlusIcon className="size-3.5" />
              {t("aiConfig.addSource")}
            </Button>
          </div>
          {sources.length === 0 ? (
            <p className="text-ui-sm text-muted-foreground/75">{t("aiConfig.sourcesEmpty")}</p>
          ) : (
            <div className="grid gap-1.5">
              {sources.map((s, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: TODO add stable id (index-based editing model)
                <div key={i} className="flex items-center gap-1.5">
                  <Combobox.Root
                    value={DEFAULT_MERGE_HEADERS[s.name] !== undefined ? s.name : null}
                    onValueChange={(v) => {
                      const name = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
                      const autoHeader = DEFAULT_MERGE_HEADERS[name] ?? "";
                      updateSource(i, {
                        name,
                        merge_header: autoHeader || s.merge_header,
                      });
                    }}
                    inputValue={s.name}
                    onInputValueChange={(v) => updateSource(i, { name: v })}
                    items={Object.keys(DEFAULT_MERGE_HEADERS)}
                    autoHighlight
                  >
                    <div className="relative flex-1">
                      <Combobox.Input
                        className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs font-normal outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        placeholder={t("aiConfig.sourceNamePlaceholder")}
                      />
                      <Combobox.Trigger
                        render={
                          <button className="absolute right-1 top-1/2 -translate-y-1/2 flex size-5 items-center justify-center rounded text-muted-foreground">
                            <ChevronDownIcon className="size-3.5" />
                          </button>
                        }
                      />
                    </div>
                    <Combobox.Portal>
                      <Combobox.Positioner
                        side="bottom"
                        sideOffset={4}
                        collisionAvoidance={{ side: "none" }}
                        className="isolate z-50"
                      >
                        <Combobox.Popup className="relative isolate z-50 max-h-40 w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
                          <Combobox.List className="p-1">
                            {Object.keys(DEFAULT_MERGE_HEADERS).map((name) => (
                              <Combobox.Item
                                key={name}
                                value={name}
                                className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-xs outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                              >
                                {name}
                              </Combobox.Item>
                            ))}
                          </Combobox.List>
                        </Combobox.Popup>
                      </Combobox.Positioner>
                    </Combobox.Portal>
                  </Combobox.Root>
                  <Input
                    className="flex-1 font-mono text-xs"
                    value={s.merge_header}
                    placeholder={t("aiConfig.sourceHeaderPlaceholder")}
                    onChange={(e) => updateSource(i, { merge_header: e.target.value })}
                  />
                  <Tooltip>
                    <TooltipTrigger className="inline-flex">
                      <button
                        type="button"
                        className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeSource(i)}
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
                      {t("aiConfig.delete")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="-mx-4 -mb-4 mt-4 flex items-center justify-end gap-2 rounded-b-xl border-t bg-muted/50 px-4 py-3">
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t("aiConfig.cancel")}
        </Button>
        <Button size="sm" onClick={handleConfirm} disabled={!url.trim()}>
          {t("aiConfig.confirm")}
        </Button>
      </div>
    </div>
  );
}
