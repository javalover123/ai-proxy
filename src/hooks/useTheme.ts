import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

function effectiveTheme(theme: Theme, osDark: boolean): "light" | "dark" {
  if (theme === "system") return osDark ? "dark" : "light";
  return theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  const [osDark, setOsDark] = useState(window.matchMedia("(prefers-color-scheme: dark)").matches);

  const apply = useCallback((resolved: "light" | "dark") => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only, osDark handled by second effect
  useEffect(() => {
    invoke<Theme>("get_theme")
      .then((t) => {
        setThemeState(t);
        apply(effectiveTheme(t, osDark));
      })
      .catch(() => {
        apply(effectiveTheme("system", osDark));
      });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setOsDark(e.matches);
      if (theme === "system") {
        apply(e.matches ? "dark" : "light");
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, apply]);

  useEffect(() => {
    apply(effectiveTheme(theme, osDark));
  }, [theme, osDark, apply]);

  const setTheme = useCallback((t: Theme) => {
    invoke<string>("set_theme", { theme: t })
      .then(() => setThemeState(t))
      .catch((err) => console.error("Failed to save theme:", err));
  }, []);

  return { theme, resolvedTheme: effectiveTheme(theme, osDark), setTheme };
}
