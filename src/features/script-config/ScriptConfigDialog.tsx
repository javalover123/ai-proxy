import { invoke } from "@tauri-apps/api/core";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HintIcon } from "@/components/core/HintIcon";
import { MatchTestRow } from "@/components/match-test/MatchTestRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import { useMatchTest } from "@/hooks/useMatchTest";
import { METHOD_BG_COLORS } from "@/lib/http-constants";
import { cn } from "@/lib/utils";
import type { ScriptConfig, ScriptItem } from "@/types/settings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 打开脚本编辑器 tab，传递脚本基础信息 */
  onEditScript: (item: ScriptItem) => void;
}

/** 五列网格：表头与数据行共用，保证列对齐（与 TLS/AI 配置同构） */
const ROW_GRID = "flex items-center gap-2.5 px-3";
const COL = {
  enabled: "flex w-4 shrink-0 justify-start",
  name: "min-w-0 flex-1",
  method: "w-20 shrink-0",
  domain: "min-w-0 flex-1",
  actions: "flex w-12 shrink-0 items-center justify-end gap-0.5",
};

const METHOD_ANY = "ANY";
const METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const ACCENT_CHECKBOX =
  "after:-inset-1 data-checked:border-ai-user-bubble data-checked:bg-ai-user-bubble data-checked:text-ai-user-bubble-text dark:data-checked:bg-ai-user-bubble";

const HEADER_CELL = "overflow-visible text-ui-xs font-medium tracking-wider whitespace-nowrap text-muted-foreground";

const ROW_INPUT =
  "h-6 rounded-sm border-transparent px-1.5 text-xs md:text-xs transition-colors hover:border-input/60 focus-visible:ring-1 dark:bg-transparent";

const ROW_SELECT =
  "h-6 w-full gap-1 rounded-sm border-transparent px-1.5 py-0 text-xs font-medium transition-colors data-[size=default]:h-6 hover:border-input/60 focus-visible:ring-1 dark:bg-transparent dark:hover:bg-transparent";

export default function ScriptConfigDialog({ open, onOpenChange, onEditScript }: Props) {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(false);
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const { testUrl, setTestUrl, hits, tested, runTest } = useMatchTest(
    scripts.map((i) => i.domain),
    false,
  );
  const rowEligible = (item: ScriptItem) =>
    tested && item.enabled && !(item.name.trim() === "" && item.domain.trim() === "");
  const rowHit = (item: ScriptItem, index: number) => rowEligible(item) && !!hits[index];
  const hitCount = scripts.filter((item, i) => rowHit(item, i)).length;

  const listRef = useRef<HTMLDivElement>(null);
  // 跟踪 Select 弹出状态，Input blur 时不退出编辑
  const [selectOpen, setSelectOpen] = useState(false);

  useEffect(() => {
    if (!tested) return;
    listRef.current?.querySelector("[data-match-hit]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [tested]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setTestUrl stable via custom hook
  useEffect(() => {
    if (!open) {
      setEditingIndex(null);
      return;
    }
    setLoading(true);
    setError("");
    setTestUrl("");
    invoke<ScriptConfig>("get_script_config")
      .then((config) => {
        setEnabled(config.enabled);
        setScripts(config.scripts);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  function toggleItem(index: number) {
    setScripts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], enabled: !updated[index].enabled };
      return updated;
    });
  }

  function updateItem(index: number, patch: Partial<ScriptItem>) {
    setError("");
    setScripts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...patch };
      return updated;
    });
  }

  function removeItem(index: number) {
    setScripts((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    onEditScript({ name: "", domain: "", method: "", enabled: true, file_name: "" });
  }

  /** 双击行进入编辑模式 */
  function startEditing(index: number) {
    setEditingIndex(index);
  }

  /** 点击 ✏️：打开编辑器 tab */
  function editInTab(index: number) {
    const item = scripts[index];
    // 还没保存过的脚本点击编辑 → 提示先保存配置
    if (!item.file_name && !item.name.trim()) {
      setError(t("scriptConfig.nameRequired"));
      return;
    }
    onEditScript(item);
  }

  async function handleSave() {
    setError("");
    const cleaned = scripts
      .map((item) => ({ ...item, name: item.name.trim(), domain: item.domain.trim() }))
      .filter((item) => item.name !== "" || item.domain !== "");
    const seen = new Set<string>();
    for (const item of cleaned) {
      if (item.name === "") {
        setError(t("scriptConfig.nameRequired"));
        return;
      }
      const key = item.name.toLowerCase();
      if (seen.has(key)) {
        setError(`${t("scriptConfig.duplicateName")}: ${item.name}`);
        return;
      }
      seen.add(key);
    }
    setSaving(true);
    try {
      await invoke("save_script_config", { script: { enabled, scripts: cleaned } });
      setScripts(cleaned);
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <DialogTitle>{t("scriptConfig.title")}</DialogTitle>
            <HintIcon label={t("scriptConfig.description")} />
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("settings.loading")}</p>
        ) : (
          <div
            className={cn("grid gap-2 transition-opacity duration-150", !enabled && "pointer-events-none opacity-40")}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t("scriptConfig.scriptListHeader")}
                {scripts.length > 0 && (
                  <span className="ml-1 font-normal opacity-80">
                    {t("scriptConfig.scriptCount", { n: scripts.length })}
                  </span>
                )}
              </span>
              <Button variant="ghost" size="xs" onClick={addRow}>
                <PlusIcon className="size-3.5" />
                {t("scriptConfig.addScript")}
              </Button>
            </div>

            {scripts.length === 0 ? (
              <p className="px-0.5 text-xs text-muted-foreground">{t("scriptConfig.emptyList")}</p>
            ) : (
              <div ref={listRef} className="max-h-80 overflow-y-auto rounded-[10px] border border-border">
                <div
                  className={cn(
                    ROW_GRID,
                    "sticky top-0 z-10 h-7 border-b border-border bg-[color-mix(in_oklab,var(--popover),var(--foreground)_3%)]",
                  )}
                >
                  <span className={cn(COL.enabled, HEADER_CELL)}>{t("scriptConfig.colEnabled")}</span>
                  <span className={cn(COL.name, HEADER_CELL, "pl-1.5")}>{t("scriptConfig.colName")}</span>
                  <span className={cn(COL.method, HEADER_CELL, "pl-1.5")}>Method</span>
                  <span className={cn(COL.domain, HEADER_CELL, "pl-1.5")}>{t("scriptConfig.colDomain")}</span>
                  <span className={COL.actions} />
                </div>

                {scripts.map((item, index) => {
                  const isEditing = editingIndex === index;
                  return (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: TODO add stable id (index-based editing model)
                      key={index}
                      data-script-row={index}
                      data-match-hit={rowHit(item, index) || undefined}
                      className={cn(
                        ROW_GRID,
                        "group/row h-[34px] border-b border-border transition-colors last:border-b-0",
                        !isEditing && "cursor-default",
                        rowHit(item, index) &&
                          "bg-ai-user-bubble/[0.08] shadow-[inset_2px_0_0_var(--ai-user-bubble)] hover:bg-ai-user-bubble/[0.12]",
                        !rowHit(item, index) && "hover:bg-foreground/[0.035]",
                      )}
                      onDoubleClick={() => startEditing(index)}
                    >
                      <span className={COL.enabled}>
                        <Checkbox
                          className={ACCENT_CHECKBOX}
                          checked={item.enabled}
                          onCheckedChange={() => toggleItem(index)}
                        />
                      </span>
                      <span className={cn(COL.name, !item.enabled && "opacity-40")}>
                        {isEditing ? (
                          <Input
                            className={ROW_INPUT}
                            value={item.name}
                            placeholder={t("scriptConfig.placeholderName")}
                            autoFocus
                            onChange={(e) => updateItem(index, { name: e.target.value })}
                            onBlur={(e) => {
                              if (selectOpen) return;
                              const related = e.relatedTarget as HTMLElement | null;
                              if (!related?.closest(`[data-script-row="${index}"]`)) setEditingIndex(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingIndex(null);
                            }}
                          />
                        ) : (
                          <Tooltip>
                            <TooltipTrigger
                              className="block w-full min-w-0"
                              render={
                                <span className="block w-full truncate pl-1.5 text-xs leading-6">
                                  {item.name || (
                                    <span className="text-muted-foreground/60">
                                      {t("scriptConfig.placeholderName")}
                                    </span>
                                  )}
                                </span>
                              }
                            />
                            <TooltipContent
                              side="top"
                              align="start"
                              className="max-w-[320px] bg-popover text-popover-foreground text-ui-sm"
                            >
                              {item.name || t("scriptConfig.placeholderName")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                      <span className={cn(COL.method, !item.enabled && "opacity-40")}>
                        {isEditing ? (
                          <Select
                            value={item.method || METHOD_ANY}
                            onOpenChange={(open) => setSelectOpen(open)}
                            onValueChange={(v) => updateItem(index, { method: v === METHOD_ANY ? "" : String(v) })}
                          >
                            <SelectTrigger
                              className={cn(ROW_SELECT, !item.method && "text-muted-foreground")}
                              style={
                                item.method
                                  ? { color: (METHOD_BG_COLORS as Record<string, string>)[item.method] }
                                  : undefined
                              }
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent
                              align="start"
                              alignItemWithTrigger={false}
                              className="max-h-56 min-w-24 overflow-y-auto [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:text-xs"
                            >
                              <SelectItem value={METHOD_ANY}>Any</SelectItem>
                              {METHOD_OPTIONS.map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span
                            className="block w-full truncate pl-1.5 text-xs font-medium leading-6"
                            style={
                              item.method
                                ? { color: (METHOD_BG_COLORS as Record<string, string>)[item.method] }
                                : { color: "var(--muted-foreground)" }
                            }
                          >
                            {item.method || "Any"}
                          </span>
                        )}
                      </span>
                      <span className={cn(COL.domain, !item.enabled && "opacity-40")}>
                        {isEditing ? (
                          <Input
                            className={cn(ROW_INPUT, "font-mono")}
                            value={item.domain}
                            placeholder={t("scriptConfig.placeholderDomain")}
                            onChange={(e) => updateItem(index, { domain: e.target.value })}
                            onBlur={(e) => {
                              if (selectOpen) return;
                              const related = e.relatedTarget as HTMLElement | null;
                              if (!related?.closest(`[data-script-row="${index}"]`)) setEditingIndex(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingIndex(null);
                            }}
                          />
                        ) : (
                          <Tooltip>
                            <TooltipTrigger
                              className="block w-full min-w-0"
                              render={
                                <span className="block w-full truncate pl-1.5 font-mono text-xs leading-6">
                                  {item.domain || (
                                    <span className="text-muted-foreground/60">
                                      {t("scriptConfig.placeholderDomain")}
                                    </span>
                                  )}
                                </span>
                              }
                            />
                            <TooltipContent
                              side="top"
                              align="start"
                              className="max-w-[360px] bg-popover text-popover-foreground font-mono text-ui-sm"
                            >
                              {item.domain || t("scriptConfig.placeholderDomain")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                      <span className={cn(COL.actions, "relative")}>
                        {rowEligible(item) && !isEditing && (
                          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center transition-opacity group-hover/row:opacity-0">
                            {hits[index] ? (
                              <CheckIcon className="size-3.5" style={{ color: "var(--badge-success)" }} />
                            ) : (
                              <XIcon className="size-3.5 text-muted-foreground/60" />
                            )}
                          </span>
                        )}
                        <Tooltip>
                          <TooltipTrigger
                            className="inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-ai-user-bubble/10 hover:text-ai-user-bubble focus-visible:opacity-100"
                            onClick={() => editInTab(index)}
                          >
                            <PencilIcon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
                            {t("scriptConfig.editScript")}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            className="inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                            onClick={() => removeItem(index)}
                          >
                            <Trash2Icon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
                            {t("scriptConfig.delete")}
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </div>
                  );
                })}
                <MatchTestRow
                  value={testUrl}
                  onChange={setTestUrl}
                  placeholder={t("matchTest.placeholder")}
                  runLabel={t("matchTest.run")}
                  onRun={runTest}
                  hit={tested ? hitCount > 0 : null}
                  title={
                    tested ? (hitCount > 0 ? t("matchTest.hit", { n: hitCount }) : t("matchTest.miss")) : undefined
                  }
                />
              </div>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("scriptConfig.cancel")}
          </Button>
          <Button variant="outline" onClick={handleSave} disabled={loading || saving}>
            {saving ? t("scriptConfig.saving") : t("scriptConfig.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
