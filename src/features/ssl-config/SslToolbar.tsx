import { invoke } from "@tauri-apps/api/core";
import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import type { SslConfig } from "@/types/settings";

interface Props {
  onOpenFullConfig: () => void;
}

export function SslToolbar({ onOpenFullConfig }: Props) {
  const { t } = useLocale();
  const [sslConfig, setSslConfig] = useState<SslConfig>({
    enabled: false,
    whitelist: [],
  });

  useEffect(() => {
    invoke<SslConfig>("get_ssl_config")
      .then((config) => setSslConfig(config))
      .catch(() => {});
  }, []);

  async function toggleGlobal() {
    const updated = { ...sslConfig, enabled: !sslConfig.enabled };
    setSslConfig(updated);
    try {
      await invoke("save_ssl_config", { ssl: updated });
    } catch (_) {}
  }

  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex">
        <button
          type="button"
          onClick={() => {
            if (sslConfig.enabled) {
              toggleGlobal();
            } else {
              onOpenFullConfig();
            }
          }}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-sm font-medium transition-colors ${
            sslConfig.enabled
              ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              : "bg-surface-elevated text-muted-foreground hover:bg-surface-elevated/80"
          }`}
        >
          {sslConfig.enabled ? <ShieldCheckIcon className="size-3" /> : <ShieldOffIcon className="size-3" />}
          {t("sslConfig.toolbarToggle")}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="bg-popover text-popover-foreground text-ui-sm">
        {t("sslConfig.globalToggle")}
      </TooltipContent>
    </Tooltip>
  );
}
