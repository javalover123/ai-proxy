import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import zh from "@/locales/zh.json";

export const supportedLocales = ["en", "zh"] as const;
export type Locale = (typeof supportedLocales)[number];
export type LocaleSetting = Locale | "system";

export function resolveLocale(setting: LocaleSetting): Locale {
  if (setting === "system") {
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  }
  return setting;
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
