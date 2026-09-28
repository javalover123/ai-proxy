import { invoke } from "@tauri-apps/api/core";
import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/hooks/useLocale";
import type { TlsConfig } from "@/types/settings";

interface Props {
  onOpenFullConfig: () => void;
}

export function TlsToolbar({ onOpenFullConfig }: Props) {
  const { t } = useLocale();
  const [tlsConfig, setTlsConfig] = useState<TlsConfig>({
    enabled: false,
    whitelist: [],
    record_decrypted_only: true,
  });

  useEffect(() => {
    invoke<TlsConfig>("get_tls_config")
      .then((config) => setTlsConfig(config))
      .catch(() => {});
  }, []);

  async function toggleGlobal() {
    const updated = { ...tlsConfig, enabled: !tlsConfig.enabled };
    setTlsConfig(updated);
    try {
      await invoke("save_tls_config", { tls: updated });
    } catch (_) {}
  }

  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex">
        <button
          type="button"
          onClick={() => {
            if (tlsConfig.enabled) {
              toggleGlobal();
            } else {
              onOpenFullConfig();
            }
          }}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-sm font-medium transition-colors ${
            tlsConfig.enabled
              ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              : "bg-surface-elevated text-muted-foreground hover:bg-surface-elevated/80"
          }`}
        >
          {tlsConfig.enabled ? <ShieldCheckIcon className="size-3" /> : <ShieldOffIcon className="size-3" />}
          {t("tlsConfig.toolbarToggle")}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="bg-popover text-popover-foreground text-ui-sm">
        {t("tlsConfig.globalToggle")}
      </TooltipContent>
    </Tooltip>
  );
}
