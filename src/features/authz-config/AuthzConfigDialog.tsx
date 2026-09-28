import { invoke } from "@tauri-apps/api/core";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { HintIcon } from "@/components/core/HintIcon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { AuthzConfig, AuthzRule } from "@/types/settings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const METHOD_ANY = "ANY";
const METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const DEFAULT_TIMEOUT = 500;

function emptyRule(): AuthzRule {
  return {
    name: "",
    domain: "",
    method: "",
    enabled: true,
    url: "",
    timeout_ms: DEFAULT_TIMEOUT,
    on_error: "closed",
  };
}

const FIELD_LABEL = "text-ui-xs font-medium tracking-wide text-muted-foreground";
const FIELD_INPUT = "h-7 rounded-sm border-input px-2 text-xs transition-colors focus-visible:ring-1";

export default function AuthzConfigDialog({ open, onOpenChange }: Props) {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<AuthzRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    invoke<AuthzConfig>("get_authz_config")
      .then((config) => {
        setEnabled(config.enabled);
        setRules(config.rules);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  function updateRule(index: number, patch: Partial<AuthzRule>) {
    setError("");
    setRules((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...patch };
      return updated;
    });
  }

  function toggleRule(index: number) {
    setRules((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], enabled: !updated[index].enabled };
      return updated;
    });
  }

  function removeRule(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setError("");
    const cleaned = rules.map((r) => ({
      ...r,
      name: r.name.trim(),
      domain: r.domain.trim(),
      url: r.url.trim(),
    }));
    const kept = cleaned.filter((r) => r.name !== "" || r.domain !== "" || r.url !== "");
    for (const r of kept) {
      if (r.enabled && r.name === "") {
        setError(t("authzConfig.nameRequired"));
        return;
      }
      if (r.enabled && r.url === "") {
        setError(t("authzConfig.urlRequired"));
        return;
      }
    }
    setSaving(true);
    try {
      await invoke("save_authz_config", { authz: { enabled, rules: kept } });
      setRules(kept);
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <DialogTitle>{t("authzConfig.title")}</DialogTitle>
            <HintIcon label={t("authzConfig.description")} />
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("settings.loading")}</p>
        ) : (
          <div
            className={cn("grid gap-3 transition-opacity duration-150", !enabled && "pointer-events-none opacity-40")}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t("authzConfig.ruleListHeader")}
                {rules.length > 0 && (
                  <span className="ml-1 font-normal opacity-80">{t("authzConfig.ruleCount", { n: rules.length })}</span>
                )}
              </span>
              <Button variant="ghost" size="xs" onClick={() => setRules((prev) => [...prev, emptyRule()])}>
                <PlusIcon className="size-3.5" />
                {t("authzConfig.addRule")}
              </Button>
            </div>

            {rules.length === 0 ? (
              <p className="px-0.5 text-xs text-muted-foreground">{t("authzConfig.emptyList")}</p>
            ) : (
              <div className="grid gap-2.5">
                {rules.map((item, index) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: rules have no stable id (index-based editing)
                    key={index}
                    className={cn(
                      "rounded-[10px] border border-border p-3 grid gap-2.5",
                      !item.enabled && "opacity-60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox checked={item.enabled} onCheckedChange={() => toggleRule(index)} />
                      <Input
                        className={cn(FIELD_INPUT, "h-7 flex-1")}
                        value={item.name}
                        placeholder={t("authzConfig.placeholderName")}
                        onChange={(e) => updateRule(index, { name: e.target.value })}
                      />
                      <Tooltip>
                        <TooltipTrigger
                          className="inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeRule(index)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
                          {t("authzConfig.delete")}
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="grid gap-1">
                        <span className={FIELD_LABEL}>{t("authzConfig.domain")}</span>
                        <Input
                          className={cn(FIELD_INPUT, "font-mono")}
                          value={item.domain}
                          placeholder={t("authzConfig.placeholderDomain")}
                          onChange={(e) => updateRule(index, { domain: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <span className={FIELD_LABEL}>{t("authzConfig.method")}</span>
                        <Select
                          value={item.method || METHOD_ANY}
                          onValueChange={(v) => updateRule(index, { method: v === METHOD_ANY ? "" : String(v) })}
                        >
                          <SelectTrigger className={cn(FIELD_INPUT, "w-full", !item.method && "text-muted-foreground")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="min-w-24">
                            <SelectItem value={METHOD_ANY}>Any</SelectItem>
                            {METHOD_OPTIONS.map((m) => (
                              <SelectItem key={m} value={m}>
                                {m}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid gap-1">
                      <span className={FIELD_LABEL}>{t("authzConfig.url")}</span>
                      <Input
                        className={cn(FIELD_INPUT, "font-mono")}
                        value={item.url}
                        placeholder={t("authzConfig.placeholderUrl")}
                        onChange={(e) => updateRule(index, { url: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="grid gap-1">
                        <span className={FIELD_LABEL}>{t("authzConfig.timeout")}</span>
                        <Input
                          className={FIELD_INPUT}
                          type="number"
                          min={1}
                          value={item.timeout_ms}
                          onChange={(e) => updateRule(index, { timeout_ms: Number(e.target.value) || DEFAULT_TIMEOUT })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <span className={FIELD_LABEL}>{t("authzConfig.onError")}</span>
                        <Select
                          value={item.on_error}
                          onValueChange={(v) => updateRule(index, { on_error: v as AuthzRule["on_error"] })}
                        >
                          <SelectTrigger className={cn(FIELD_INPUT, "w-full")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="min-w-24">
                            <SelectItem value="closed">{t("authzConfig.onErrorClosed")}</SelectItem>
                            <SelectItem value="open">{t("authzConfig.onErrorOpen")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
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
            {t("authzConfig.cancel")}
          </Button>
          <Button variant="outline" onClick={handleSave} disabled={loading || saving}>
            {saving ? t("authzConfig.saving") : t("authzConfig.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
