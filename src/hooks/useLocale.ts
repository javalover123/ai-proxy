import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { type Locale, type LocaleSetting, resolveLocale } from "@/i18n";

export function useLocale() {
  const { t } = useTranslation();
  const [localeSetting, setLocaleSetting] = useState<LocaleSetting>("system");
  const [ready, setReady] = useState(false);

  const applyLocale = useCallback(async (setting: LocaleSetting) => {
    const resolved = resolveLocale(setting);
    await i18n.changeLanguage(resolved);
    await invoke("sync_tray_locale", { locale: resolved });
  }, []);

  useEffect(() => {
    invoke<LocaleSetting>("get_locale")
      .then(async (setting) => {
        setLocaleSetting(setting);
        await applyLocale(setting);
      })
      .catch(() => applyLocale("system"))
      .finally(() => setReady(true));
  }, [applyLocale]);

  const setLocale = useCallback(
    (setting: LocaleSetting) => {
      invoke<LocaleSetting>("set_locale", { language: setting })
        .then(async (saved) => {
          setLocaleSetting(saved);
          await applyLocale(saved);
        })
        .catch((err) => console.error("Failed to save locale:", err));
    },
    [applyLocale],
  );

  return {
    t,
    ready,
    localeSetting,
    locale: resolveLocale(localeSetting) as Locale,
    setLocale,
  };
}
