import type { BodyType } from "@/types/collection";

export type EditorLanguage = BodyType | "javascript";
export type EffectiveEditorLang = "json" | "xml" | "javascript" | "text";

export function detectLanguage(content: string): "json" | "xml" | null {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<")) return "xml";
  return null;
}

export function resolveEffectiveLang(language: EditorLanguage, content: string): EffectiveEditorLang {
  if (language === "auto") return detectLanguage(content) ?? "text";
  if (language === "json" || language === "xml" || language === "javascript" || language === "text") {
    return language;
  }
  return "text";
}
