import { invoke } from "@tauri-apps/api/core";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HintIcon } from "@/components/core/HintIcon";
import { MatchTestRow } from "@/components/match-test/MatchTestRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import { useMatchTest } from "@/hooks/useMatchTest";
import { cn } from "@/lib/utils";
import type { AiConfig, AiUrlRule } from "@/types/settings";
import RuleEditForm from "./RuleEditDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 六列网格：表头与数据行共用，保证列对齐 */
const ROW_GRID = "flex items-center gap-2.5 px-3";
const COL = {
  enabled: "flex w-4 shrink-0 justify-start",
  url: "min-w-0 flex-1",
  provider: "flex w-[74px] shrink-0 items-center gap-1.5",
  sources: "w-24 shrink-0",
  mergeHeader: "w-24 shrink-0",
  actions: "flex w-[46px] shrink-0 items-center justify-end gap-0.5",
};

/** 勾选框选中态改用 AI 蓝（默认 primary 在暗色下近黑，缺乏反馈） */
const AI_CHECKBOX =
  "after:-inset-1 data-checked:border-ai-user-bubble data-checked:bg-ai-user-bubble data-checked:text-ai-user-bubble-text dark:data-checked:bg-ai-user-bubble";

function providerDotClass(provider: string | null) {
  if (provider === "openai" || provider === "openai-responses") return "bg-ai-provider-openai";
  if (provider === "anthropic") return "bg-ai-provider-anthropic";
  if (provider === "gemini") return "bg-ai-provider-gemini";
  return "border-[1.5px] border-muted-foreground/70";
}

export default function AiConfigDialog({ open, onOpenChange }: Props) {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<AiUrlRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 侧滑面板状态
  const [editingPanel, setEditingPanel] = useState<{ index: number | null } | null>(null);
  const [closingPanel, setClosingPanel] = useState(false);

  // 匹配测试（按钮触发）：与运行时 compute_ai_hint 同一套 domain_match，按 host+path 匹配（matchPath=true）
  const { testUrl, setTestUrl, hits, tested, runTest } = useMatchTest(
    rules.map((r) => r.url),
    true,
  );
  /** 行是否参与了本次测试 = 已启用 && 非空 url（与运行时生效条件一致） */
  const rowEligible = (rule: AiUrlRule) => tested && rule.enabled && rule.url.trim() !== "";
  const rowHit = (rule: AiUrlRule, index: number) => rowEligible(rule) && !!hits[index];
  const hitCount = rules.filter((rule, i) => rowHit(rule, i)).length;

  const listRef = useRef<HTMLDivElement>(null);
  // 测试出结果后滚动到第一条命中行（命中行滚出可视区时也能看到是哪条）
  useEffect(() => {
    if (!tested) return;
    listRef.current?.querySelector("[data-match-hit]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [tested]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setTestUrl stable via custom hook
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setTestUrl("");
    setEditingPanel(null);
    setClosingPanel(false);
    invoke<AiConfig>("get_ai_config")
      .then((config) => {
        setEnabled(config.enabled);
        setRules(config.detection.url_patterns);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  function toggleItem(index: number) {
    setRules((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], enabled: !updated[index].enabled };
      return updated;
    });
  }

  function removeItem(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }

  function openAdd() {
    setEditingPanel({ index: null });
    setClosingPanel(false);
  }

  function openEdit(index: number) {
    setEditingPanel({ index });
    setClosingPanel(false);
  }

  function handleClosePanel() {
    setClosingPanel(true);
    setTimeout(() => {
      setEditingPanel(null);
      setClosingPanel(false);
    }, 150); // 匹配 slide-out 动画时长
  }

  /** 编辑器「确定」：新增追加（默认启用），编辑原位替换（保留启用状态） */
  function applyRule(draft: Omit<AiUrlRule, "enabled">) {
    setRules((prev) => {
      if (editingPanel === null) return prev;
      if (editingPanel.index === null) return [...prev, { ...draft, enabled: true }];
      const updated = [...prev];
      updated[editingPanel.index] = { ...draft, enabled: updated[editingPanel.index].enabled };
      return updated;
    });
    handleClosePanel();
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    const finalRules = rules.filter((r) => r.url.trim() !== "");
    try {
      await invoke("save_ai_config", {
        ai: { enabled, detection: { url_patterns: finalRules } },
      });
      setRules(finalRules);
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  const editIndex = editingPanel?.index ?? null;
  const editingRule = editIndex !== null ? (rules[editIndex] ?? null) : null;
  const existingUrls = rules
    .filter((_, i) => i !== editIndex)
    .map((r) => r.url.trim().toLowerCase())
    .filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]" showCloseButton={!editingPanel}>
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <DialogTitle>{t("aiConfig.title")}</DialogTitle>
            <HintIcon label={t("aiConfig.description")} />
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </DialogHeader>

        {/* 包裹内容区 + error + footer：侧滑面板的定位锚 */}
        <div className="relative">
          <div className="overflow-hidden">
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("settings.loading")}</p>
            ) : (
              <>
                {/* 列表区（面板打开时变暗 + 禁止交互） */}
                <div
                  className={cn(
                    "grid gap-2 transition-opacity duration-200 select-none",
                    !enabled && "pointer-events-none opacity-40",
                    editingPanel && "pointer-events-none opacity-30",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("aiConfig.ruleListHeader")}
                      {rules.length > 0 && (
                        <span className="ml-1 font-normal opacity-80">
                          {t("aiConfig.ruleCount", { n: rules.length })}
                        </span>
                      )}
                    </span>
                    <Button variant="ghost" size="xs" onClick={openAdd}>
                      <PlusIcon className="size-3.5" />
                      {t("aiConfig.addRule")}
                    </Button>
                  </div>

                  {rules.length === 0 ? (
                    <p className="px-0.5 text-xs text-muted-foreground">{t("aiConfig.emptyList")}</p>
                  ) : (
                    <div ref={listRef} className="max-h-80 overflow-y-auto rounded-[10px] border border-border">
                      <div
                        className={cn(
                          ROW_GRID,
                          "sticky top-0 z-10 h-7 border-b border-border bg-[color-mix(in_oklab,var(--popover),var(--foreground)_3%)]",
                        )}
                      >
                        {(
                          [
                            ["colEnabled", COL.enabled],
                            ["colUrl", COL.url],
                            ["colProvider", COL.provider],
                            ["colSources", COL.sources],
                            ["colMergeHeader", COL.mergeHeader],
                          ] as const
                        ).map(([key, colClass]) => (
                          <span
                            key={key}
                            className={cn(
                              colClass,
                              "overflow-visible text-ui-xs font-medium tracking-wider whitespace-nowrap text-muted-foreground uppercase",
                            )}
                          >
                            {t(`aiConfig.${key}`)}
                          </span>
                        ))}
                        <span className={COL.actions} />
                      </div>

                      {rules.map((rule, index) => {
                        const names = rule.sources.map((s) => s.name.trim()).filter(Boolean);
                        const headers = rule.sources.map((s) => s.merge_header.trim()).filter(Boolean);
                        return (
                          <div
                            key={rule.url}
                            data-match-hit={rowHit(rule, index) || undefined}
                            className={cn(
                              ROW_GRID,
                              "group/row h-[34px] cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-foreground/[0.035]",
                              rowHit(rule, index) &&
                                "bg-ai-user-bubble/[0.08] shadow-[inset_2px_0_0_var(--ai-user-bubble)] hover:bg-ai-user-bubble/[0.12]",
                            )}
                            onDoubleClick={() => openEdit(index)}
                          >
                            <span className={COL.enabled} onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                className={AI_CHECKBOX}
                                checked={rule.enabled}
                                onCheckedChange={() => toggleItem(index)}
                              />
                            </span>
                            <span className={cn(COL.url, !rule.enabled && "opacity-40")}>
                              <Tooltip>
                                <TooltipTrigger className="block w-full min-w-0">
                                  <span className="block truncate font-mono text-xs">{rule.url}</span>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  align="start"
                                  className="max-w-[420px] font-mono text-ui-sm bg-popover text-popover-foreground"
                                >
                                  {rule.url}
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span
                              className={cn(
                                COL.provider,
                                "text-ui-sm text-muted-foreground",
                                !rule.enabled && "opacity-40",
                              )}
                            >
                              <span className={cn("size-1.5 shrink-0 rounded-full", providerDotClass(rule.provider))} />
                              <span className="truncate">{rule.provider ?? t("aiConfig.providerAuto")}</span>
                            </span>
                            <span
                              className={cn(
                                COL.sources,
                                "text-ui-sm text-muted-foreground",
                                !rule.enabled && "opacity-40",
                              )}
                            >
                              {names.length === 0 ? (
                                <span className="opacity-60">—</span>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger className="block min-w-0">
                                    <span className="flex items-center">
                                      <span className="truncate">{names[0]}</span>
                                      {names.length > 1 && (
                                        <span className="ml-1 shrink-0 rounded-full bg-muted px-1 text-ui-2xs">
                                          +{names.length - 1}
                                        </span>
                                      )}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    align="start"
                                    className="max-w-[360px] bg-popover text-popover-foreground"
                                  >
                                    <div className="space-y-1 text-ui-sm">
                                      {rule.sources.map((s, si) => (
                                        // biome-ignore lint/suspicious/noArrayIndexKey: read-only tooltip display
                                        <div key={si}>
                                          <span className="font-medium">{s.name.trim() || "—"}</span>
                                          <span className="mx-1 text-muted-foreground">·</span>
                                          <span className="font-mono opacity-70">{s.merge_header.trim() || "—"}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </span>
                            <span
                              className={cn(
                                COL.mergeHeader,
                                "truncate font-mono text-ui-sm",
                                !rule.enabled && "opacity-40",
                              )}
                            >
                              <Tooltip>
                                <TooltipTrigger className="block min-w-0 truncate font-mono text-ui-sm text-left w-full">
                                  {headers.length === 0 ? (
                                    <span className="text-muted-foreground opacity-60">—</span>
                                  ) : headers.length === 1 ? (
                                    headers[0]
                                  ) : (
                                    `${headers[0]} +${headers.length - 1}`
                                  )}
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  align="start"
                                  className="max-w-[360px] bg-popover text-popover-foreground"
                                >
                                  {headers.length > 0 ? (
                                    <div className="space-y-1 text-ui-sm">
                                      {rule.sources.map((s, si) => (
                                        // biome-ignore lint/suspicious/noArrayIndexKey: read-only tooltip display
                                        <div key={si}>
                                          <span className="font-medium">{s.name.trim() || "—"}</span>
                                          <span className="mx-1 text-muted-foreground">·</span>
                                          <span className="font-mono opacity-70">{s.merge_header.trim() || "—"}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-ui-sm opacity-70">{t("aiConfig.mergeHeaderGlobal")}</span>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className={cn(COL.actions, "relative")}>
                              {rowEligible(rule) && (
                                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center transition-opacity group-hover/row:opacity-0">
                                  {hits[index] ? (
                                    <CheckIcon className="size-3.5" style={{ color: "var(--badge-success)" }} />
                                  ) : (
                                    <XIcon className="size-3.5 text-muted-foreground/60" />
                                  )}
                                </span>
                              )}
                              <Tooltip>
                                <TooltipTrigger className="inline-flex">
                                  <button
                                    type="button"
                                    className="inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEdit(index);
                                    }}
                                  >
                                    <PencilIcon className="size-3" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">{t("aiConfig.edit")}</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger className="inline-flex">
                                  <button
                                    type="button"
                                    className="inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeItem(index);
                                    }}
                                  >
                                    <Trash2Icon className="size-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">{t("aiConfig.delete")}</TooltipContent>
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
                          tested
                            ? hitCount > 0
                              ? t("matchTest.hit", { n: hitCount })
                              : t("matchTest.miss")
                            : undefined
                        }
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {/* overflow-hidden 结束 */}

          {/* 侧滑遮罩 + 编辑面板：提升到此层级避免 overflow-hidden 裁剪导致表格抖动 */}
          {editingPanel && (
            <div
              className={cn(
                "absolute inset-0 z-10 bg-black/5",
                closingPanel ? "animate-fade-out-overlay" : "animate-fade-in-overlay",
              )}
              onClick={handleClosePanel}
            />
          )}
          {editingPanel && (
            <div
              className={cn(
                "absolute inset-y-0 right-0 z-20 flex w-[min(70%,400px)] flex-col border-l border-border bg-popover shadow-lg",
                closingPanel ? "animate-slide-out-right" : "animate-slide-in-right",
              )}
            >
              <div className="flex-1 flex flex-col overflow-y-auto p-4">
                <RuleEditForm
                  initial={editingRule}
                  existingUrls={existingUrls}
                  onConfirm={applyRule}
                  onCancel={handleClosePanel}
                />
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* 列表视图显示底部按钮；编辑面板打开时仅隐藏但保留占位，防止弹窗高度收缩 */}
          <DialogFooter className={editingPanel ? "invisible" : ""}>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("aiConfig.cancel")}
            </Button>
            <Button variant="outline" onClick={handleSave} disabled={loading || saving}>
              {saving ? t("aiConfig.saving") : t("aiConfig.save")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
