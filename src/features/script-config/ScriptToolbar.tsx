import { invoke } from "@tauri-apps/api/core";
import { CodeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import type { ScriptConfig } from "@/types/settings";

interface Props {
  onOpenFullConfig: () => void;
}

export function ScriptToolbar({ onOpenFullConfig }: Props) {
  const { t } = useLocale();
  const [scriptConfig, setScriptConfig] = useState<ScriptConfig>({
    enabled: false,
    scripts: [],
  });

  useEffect(() => {
    invoke<ScriptConfig>("get_script_config")
      .then((config) => setScriptConfig(config))
      .catch(() => {});
  }, []);

  async function toggleGlobal() {
    const updated = { ...scriptConfig, enabled: !scriptConfig.enabled };
    setScriptConfig(updated);
    try {
      await invoke("save_script_config", { script: updated });
    } catch (_) {}
  }

  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex">
        <button
          type="button"
          onClick={() => {
            if (scriptConfig.enabled) {
              toggleGlobal();
            } else {
              onOpenFullConfig();
            }
          }}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-sm font-medium transition-colors ${
            scriptConfig.enabled
              ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              : "bg-surface-elevated text-muted-foreground hover:bg-surface-elevated/80"
          }`}
        >
          <CodeIcon className="size-3" />
          {t("scriptConfig.toolbarToggle")}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="bg-popover text-popover-foreground text-ui-sm">
        {t("scriptConfig.globalToggle")}
      </TooltipContent>
    </Tooltip>
  );
}
