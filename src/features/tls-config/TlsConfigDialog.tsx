import { invoke } from "@tauri-apps/api/core";
import { CheckIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HintIcon } from "@/components/core/HintIcon";
import { MatchTestRow } from "@/components/match-test/MatchTestRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import { useMatchTest } from "@/hooks/useMatchTest";
import { cn } from "@/lib/utils";
import type { TlsConfig, TlsWhitelistItem } from "@/types/settings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 三列网格：表头与数据行共用，保证列对齐（与 AI 检测配置同构） */
const ROW_GRID = "flex items-center gap-2.5 px-3";
const COL = {
  enabled: "flex w-4 shrink-0 justify-start",
  domain: "min-w-0 flex-1",
  actions: "flex w-6 shrink-0 items-center justify-end",
};

/** 勾选框选中态改用 AI 蓝（默认 primary 在暗色下近黑，缺乏反馈），与 AI 检测配置一致 */
const ACCENT_CHECKBOX =
  "after:-inset-1 data-checked:border-ai-user-bubble data-checked:bg-ai-user-bubble data-checked:text-ai-user-bubble-text dark:data-checked:bg-ai-user-bubble";

const HEADER_CELL =
  "overflow-visible text-ui-xs font-medium tracking-wider whitespace-nowrap text-muted-foreground uppercase";

/** 行内域名输入：静止时如纯文本，hover 现边框，聚焦细环 */
const ROW_INPUT =
  "h-6 rounded-sm border-transparent px-1.5 font-mono text-xs md:text-xs transition-colors hover:border-input/60 focus-visible:ring-1 dark:bg-transparent";

export default function TlsConfigDialog({ open, onOpenChange }: Props) {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(false);
  const [recordDecryptedOnly, setRecordDecryptedOnly] = useState(true);
  const [whitelist, setWhitelist] = useState<TlsWhitelistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 匹配测试（按钮触发）：与运行时同一套 domain_match；TLS 仅按 host 匹配（matchPath=false）
  const { testUrl, setTestUrl, hits, tested, runTest } = useMatchTest(
    whitelist.map((i) => i.domain),
    false,
  );
  /** 行是否参与了本次测试 = 已启用 && 非空（与运行时生效条件一致） */
  const rowEligible = (item: TlsWhitelistItem) => tested && item.enabled && item.domain.trim() !== "";
  const rowHit = (item: TlsWhitelistItem, index: number) => rowEligible(item) && !!hits[index];
  const hitCount = whitelist.filter((item, i) => rowHit(item, i)).length;

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
    invoke<TlsConfig>("get_tls_config")
      .then((config) => {
        setEnabled(config.enabled);
        setRecordDecryptedOnly(config.record_decrypted_only);
        setWhitelist(config.whitelist);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  function toggleItem(index: number) {
    setWhitelist((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], enabled: !updated[index].enabled };
      return updated;
    });
  }

  function updateDomain(index: number, domain: string) {
    setError("");
    setWhitelist((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], domain };
      return updated;
    });
  }

  function removeItem(index: number) {
    setWhitelist((prev) => prev.filter((_, i) => i !== index));
  }

  /** 追加空行；新行 Input 挂载时 autoFocus 接管焦点 */
  function addRow() {
    setWhitelist((prev) => [...prev, { domain: "", enabled: true }]);
  }

  async function handleSave() {
    setError("");
    // 去空白、丢弃空行（未填完的新增行视为放弃）
    const cleaned = whitelist
      .map((item) => ({ ...item, domain: item.domain.trim() }))
      .filter((item) => item.domain !== "");
    // 重复域名（忽略大小写）阻止保存，提示后由用户改行内内容
    const seen = new Set<string>();
    for (const item of cleaned) {
      const key = item.domain.toLowerCase();
      if (seen.has(key)) {
        setError(`${t("tlsConfig.duplicateDomain")}: ${item.domain}`);
        return;
      }
      seen.add(key);
    }
    setSaving(true);
    try {
      await invoke("save_tls_config", {
        tls: { enabled, whitelist: cleaned, record_decrypted_only: recordDecryptedOnly },
      });
      setWhitelist(cleaned);
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <DialogTitle>{t("tlsConfig.title")}</DialogTitle>
            <HintIcon label={t("tlsConfig.description")} />
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="flex items-center gap-2.5 pt-1">
            <span className="text-xs font-medium">{t("tlsConfig.recordDecryptedOnly")}</span>
            <HintIcon label={t("tlsConfig.recordDecryptedOnlyHint")} />
            <Switch checked={recordDecryptedOnly} onCheckedChange={setRecordDecryptedOnly} />
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
                {t("tlsConfig.whitelistHeader")}
                {whitelist.length > 0 && (
                  <span className="ml-1 font-normal opacity-80">
                    {t("tlsConfig.domainCount", { n: whitelist.length })}
                  </span>
                )}
              </span>
              <Button variant="ghost" size="xs" onClick={addRow}>
                <PlusIcon className="size-3.5" />
                {t("tlsConfig.addDomain")}
              </Button>
            </div>

            {whitelist.length === 0 ? (
              <p className="px-0.5 text-xs text-muted-foreground">{t("tlsConfig.emptyWhitelist")}</p>
            ) : (
              <div ref={listRef} className="max-h-80 overflow-y-auto rounded-[10px] border border-border">
                <div
                  className={cn(
                    ROW_GRID,
                    "sticky top-0 z-10 h-7 border-b border-border bg-[color-mix(in_oklab,var(--popover),var(--foreground)_3%)]",
                  )}
                >
                  <span className={cn(COL.enabled, HEADER_CELL)}>{t("tlsConfig.colEnabled")}</span>
                  <span className={cn(COL.domain, HEADER_CELL, "pl-1.5")}>{t("tlsConfig.domain")}</span>
                  <span className={COL.actions} />
                </div>

                {whitelist.map((item, index) => (
                  <div
                    key={item.domain}
                    data-match-hit={rowHit(item, index) || undefined}
                    className={cn(
                      ROW_GRID,
                      "group/row h-[34px] border-b border-border transition-colors last:border-b-0 hover:bg-foreground/[0.035]",
                      rowHit(item, index) &&
                        "bg-ai-user-bubble/[0.08] shadow-[inset_2px_0_0_var(--ai-user-bubble)] hover:bg-ai-user-bubble/[0.12]",
                    )}
                  >
                    <span className={COL.enabled}>
                      <Checkbox
                        className={ACCENT_CHECKBOX}
                        checked={item.enabled}
                        onCheckedChange={() => toggleItem(index)}
                      />
                    </span>
                    <span className={cn(COL.domain, !item.enabled && "opacity-40")}>
                      <Tooltip>
                        <TooltipTrigger
                          className="block w-full min-w-0"
                          render={
                            <Input
                              className={ROW_INPUT}
                              value={item.domain}
                              placeholder={t("tlsConfig.placeholderDomain")}
                              autoFocus={item.domain === ""}
                              onChange={(e) => updateDomain(index, e.target.value)}
                              onKeyDown={(e) => {
                                // 回车快速续加下一行（当前行已有内容时）
                                if (e.key === "Enter" && item.domain.trim()) addRow();
                              }}
                            />
                          }
                        />
                        <TooltipContent
                          side="top"
                          align="start"
                          className="max-w-[360px] bg-popover text-popover-foreground font-mono text-ui-sm"
                        >
                          {item.domain}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                    <span className={cn(COL.actions, "relative")}>
                      {rowEligible(item) && (
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
                          className="inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                          onClick={() => removeItem(index)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
                          {t("tlsConfig.delete")}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </div>
                ))}
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
            {t("tlsConfig.cancel")}
          </Button>
          <Button variant="outline" onClick={handleSave} disabled={loading || saving}>
            {saving ? t("tlsConfig.saving") : t("tlsConfig.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
