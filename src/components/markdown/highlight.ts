/**
 * The markdown renderer's syntax highlighter: a synchronous shiki core
 * (JavaScript regex engine — no oniguruma WASM, bundle-friendly) with an
 * explicit grammar allowlist. The default theme is CSS variables
 * (`--shiki-*`, light and dark blocks in CSS). `github-light` / `github-dark`
 * load on first request so Markdown warmup does not pay for them.
 *
 * The three markdown-fence grammars (TypeScript, shell, JSON) load into the
 * singleton at boot; a wider set is imported lazily and registered the first
 * time such a language is requested, so a session that never renders one pays
 * neither the grammar modules nor their synchronous init. The first render of
 * a lazy language or github theme falls back to plain text while it loads, then
 * subscribers re-render with highlighting. An unknown or absent language falls
 * back to plain text — never an error.
 */

import langJson from "@shikijs/langs/json";
import langBash from "@shikijs/langs/shellscript";
import langTs from "@shikijs/langs/typescript";
import type { HighlighterCore, ThemeRegistration } from "shiki/core";
import { createCssVariablesTheme, createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from "shiki/engine/javascript";

/** A shiki grammar module's default export (a `LanguageRegistration[]`). */
type LangModule = { default: typeof langTs };

/** A shiki theme module's default export. */
type ThemeModule = { default: ThemeRegistration };

/** Themes `highlightToHtml` accepts. Markdown uses the default; the detail panel passes github-*. */
export type HighlightTheme = "css-variables" | "github-light" | "github-dark";

const LANGS = [langTs, langBash, langJson];

const LAZY_GRAMMARS = new Map<string, () => Promise<LangModule>>([
  ["python", () => import("@shikijs/langs/python")],
  ["ruby", () => import("@shikijs/langs/ruby")],
  ["go", () => import("@shikijs/langs/go")],
  ["rust", () => import("@shikijs/langs/rust")],
  ["java", () => import("@shikijs/langs/java")],
  ["c", () => import("@shikijs/langs/c")],
  ["cpp", () => import("@shikijs/langs/cpp")],
  ["csharp", () => import("@shikijs/langs/csharp")],
  ["kotlin", () => import("@shikijs/langs/kotlin")],
  ["swift", () => import("@shikijs/langs/swift")],
  ["php", () => import("@shikijs/langs/php")],
  ["yaml", () => import("@shikijs/langs/yaml")],
  ["toml", () => import("@shikijs/langs/toml")],
  ["ini", () => import("@shikijs/langs/ini")],
  ["markdown", () => import("@shikijs/langs/markdown")],
  ["mdx", () => import("@shikijs/langs/mdx")],
  ["html", () => import("@shikijs/langs/html")],
  ["css", () => import("@shikijs/langs/css")],
  ["scss", () => import("@shikijs/langs/scss")],
  ["less", () => import("@shikijs/langs/less")],
  ["sql", () => import("@shikijs/langs/sql")],
  ["xml", () => import("@shikijs/langs/xml")],
  ["lua", () => import("@shikijs/langs/lua")],
]);

const LAZY_THEMES = new Map<HighlightTheme, () => Promise<ThemeModule>>([
  ["github-light", () => import("@shikijs/themes/github-light")],
  ["github-dark", () => import("@shikijs/themes/github-dark")],
]);

/**
 * Language ids (and aliases) the highlighter accepts; everything else renders
 * plain. A Map, not an object: fence info strings are assistant-authored, so
 * a label like `constructor` or `__proto__` must miss instead of resolving an
 * inherited property and crashing the renderer inside shiki.
 */
const LANG_ALIASES = new Map<string, string>([
  ["typescript", "typescript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["javascript", "typescript"],
  ["js", "typescript"],
  ["jsx", "typescript"],
  ["shellscript", "shellscript"],
  ["bash", "shellscript"],
  ["sh", "shellscript"],
  ["shell", "shellscript"],
  ["zsh", "shellscript"],
  ["json", "json"],
  ["jsonc", "json"],
  ["py", "python"],
  ["python", "python"],
  ["rb", "ruby"],
  ["ruby", "ruby"],
  ["go", "go"],
  ["rs", "rust"],
  ["rust", "rust"],
  ["java", "java"],
  ["c", "c"],
  ["cpp", "cpp"],
  ["cs", "csharp"],
  ["csharp", "csharp"],
  ["kotlin", "kotlin"],
  ["swift", "swift"],
  ["php", "php"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["toml", "toml"],
  ["ini", "ini"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["mdx", "mdx"],
  ["html", "html"],
  ["css", "css"],
  ["scss", "scss"],
  ["less", "less"],
  ["sql", "sql"],
  ["xml", "xml"],
  ["lua", "lua"],
]);

/** All token colors resolve through `--shiki-*` custom properties. */
const cssVariablesTheme = createCssVariablesTheme({
  name: "css-variables",
  variablePrefix: "--shiki-",
  fontStyle: true,
});

const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: (pattern) =>
    defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    }),
});

let singleton: HighlighterCore | undefined;

/** Representative paths through every boot grammar, compiled before user content is timed. */
const BOOT_GRAMMAR_WARMUPS = [
  { lang: "typescript", code: "const answer: number = 42" },
  { lang: "shellscript", code: "printf '%s\\n' \"$HOME\"" },
  { lang: "json", code: '{"ready":true}' },
] as const;

/** Construct and pre-tokenize the boot grammars outside the user-content scan budget. */
function createHighlighter(): HighlighterCore {
  const instance = createHighlighterCoreSync({
    themes: [cssVariablesTheme],
    langs: LANGS,
    engine: regexEngine,
  });
  for (const sample of BOOT_GRAMMAR_WARMUPS) {
    instance.codeToTokens(sample.code, {
      lang: sample.lang,
      theme: "css-variables",
      tokenizeTimeLimit: 0,
    });
  }
  return instance;
}

/** The synchronous highlighter (one instance per document); pre-warmed below, lazy as the fallback. */
function highlighter(): HighlighterCore {
  singleton ??= createHighlighter();
  return singleton;
}

/** Grammar ids whose lazy import is in flight or done, so it is requested once. */
const requested = new Set<string>();
/** Subscribers re-rendered after a lazy grammar registers (React callers). */
const listeners = new Set<() => void>();
/** Bumped on each lazy-grammar load; the `useSyncExternalStore` snapshot. */
let loadCount = 0;

export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function grammarLoadCount(): number {
  return loadCount;
}

/**
 * Ensure the grammar `resolved` names is registered. A boot grammar (not in
 * {@link LAZY_GRAMMARS}) and an already-loaded lazy grammar report ready
 * synchronously; a lazy grammar not yet loaded starts its import (once) and
 * reports not-ready.
 */
function ensureGrammar(resolved: string): boolean {
  const load = LAZY_GRAMMARS.get(resolved);
  if (load === undefined) return true;
  if (highlighter().getLoadedLanguages().includes(resolved)) return true;
  if (!requested.has(resolved)) {
    requested.add(resolved);
    void load()
      .then((mod) => {
        highlighter().loadLanguageSync(mod.default);
        loadCount += 1;
        for (const listener of listeners) listener();
      })
      .catch(() => {
        requested.delete(resolved);
      });
  }
  return false;
}

/**
 * Ensure `theme` is registered. `css-variables` is loaded at boot. A github
 * theme not yet loaded starts its import (once) and reports not-ready.
 */
function ensureTheme(theme: HighlightTheme): boolean {
  if (theme === "css-variables") return true;
  const load = LAZY_THEMES.get(theme);
  if (load === undefined) return false;
  if (highlighter().getLoadedThemes().includes(theme)) return true;
  const key = `theme:${theme}`;
  if (!requested.has(key)) {
    requested.add(key);
    void load()
      .then((mod) => {
        highlighter().loadThemeSync(mod.default);
        loadCount += 1;
        for (const listener of listeners) listener();
      })
      .catch(() => {
        requested.delete(key);
      });
  }
  return false;
}

// Engine + grammar construction costs a long task; building it during the
// first finalized fence's render would jank exactly when a stream completes.
// Warm the singleton in a deferred task at module load instead.
const warmupTimer = setTimeout(() => {
  highlighter();
}, 0);
(warmupTimer as { unref?: () => void }).unref?.();

/**
 * Highlight `code` into shiki's HTML when `lang` maps to a registered grammar;
 * `undefined` means the caller renders its plain fallback. A lazy grammar or
 * github theme not yet loaded returns `undefined` for this call and loads in
 * the background. `theme` defaults to `css-variables`.
 */
export function highlightToHtml(
  code: string,
  lang: string | undefined,
  theme: HighlightTheme = "css-variables",
): string | undefined {
  const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase());
  if (resolved === undefined) return undefined;
  if (!ensureGrammar(resolved)) return undefined;
  if (!ensureTheme(theme)) return undefined;
  return highlighter().codeToHtml(code, { lang: resolved, theme });
}
