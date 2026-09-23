import { ArrowLeftToLine, ChevronDown, ChevronRight, TextWrap } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { CopyButton } from "@/components/core/CopyButton";
import { JsonTreeView } from "@/components/json-tree";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useShiki } from "@/hooks/useShiki";
import { useTheme } from "@/hooks/useTheme";
import { formatXml } from "@/lib/body-utils";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function tryFormatJson(input: string): { formatted: string; raw: string } | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    return {
      formatted: JSON.stringify(parsed, null, 2),
      raw: JSON.stringify(parsed),
    };
  } catch {
    return null;
  }
}

const SyntaxHighlightedBody = memo(function SyntaxHighlightedBody({
  content,
  lang,
  wrapped,
}: {
  content: string;
  lang: string;
  wrapped: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "github-dark" : "github-light";
  const highlighted = useShiki(content, lang, theme);

  if (!highlighted) {
    return (
      <pre
        className={`px-3 py-2 text-prose-md text-foreground/80 font-mono overflow-y-auto ${
          wrapped ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto"
        }`}
      >
        {content}
      </pre>
    );
  }

  return (
    <div
      className={`shiki-body ${wrapped ? "whitespace-pre-wrap break-all overflow-y-auto" : "overflow-x-auto overflow-y-auto"}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki codeToHtml output is escaped; no user HTML passes through.
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
});

const BodyView = memo(function BodyView({ body, contentType }: { body: string; contentType?: string }) {
  const [wrapped, setWrapped] = useState(true);
  const [format, setFormat] = useState<"auto" | "json" | "xml" | "html" | "plaintext">("auto");
  const [allExpanded, setAllExpanded] = useState(true);

  const formatOptions = ["Auto", "JSON", "XML", "HTML", "Text"] as const;
  const formatValues = ["auto", "json", "xml", "html", "plaintext"] as const;

  const { cleaned, formatted, parsedJson, isJson } = useMemo(() => {
    const c = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    const f = tryFormatJson(c);
    let parsed: JsonValue | null = null;
    if (f !== null) {
      try {
        parsed = JSON.parse(c) as JsonValue;
      } catch {
        /* ignore */
      }
    }
    return { cleaned: c, formatted: f, parsedJson: parsed, isJson: f !== null };
  }, [body]);

  const { displayBody, displayLang, useTreeView } = useMemo(() => {
    const inferFromContentType = (ct?: string): { displayLang: string; useTreeView: false } | null => {
      if (!ct) return null;
      const lower = ct.toLowerCase();
      if (lower.includes("json")) return { displayLang: "json", useTreeView: false };
      if (lower.includes("javascript") || lower.includes("text/js") || lower.includes("application/js"))
        return { displayLang: "js", useTreeView: false };
      if (lower.includes("typescript") || lower.includes("text/ts")) return { displayLang: "ts", useTreeView: false };
      if (lower.includes("css")) return { displayLang: "css", useTreeView: false };
      if (lower.includes("xml") && !lower.includes("html")) return { displayLang: "xml", useTreeView: false };
      if (lower.includes("html")) return { displayLang: "html", useTreeView: false };
      return null;
    };

    if (format === "auto") {
      if (isJson) {
        return { displayBody: formatted!.formatted, displayLang: "json", useTreeView: true as const };
      }
      const ctHint = inferFromContentType(contentType);
      if (ctHint) {
        return { displayBody: cleaned, displayLang: ctHint.displayLang, useTreeView: ctHint.useTreeView };
      }
      const l = cleaned.startsWith("<") ? "html" : "plaintext";
      return { displayBody: cleaned, displayLang: l, useTreeView: false as const };
    }
    if (format === "json") {
      try {
        const parsed = JSON.parse(cleaned) as JsonValue;
        return { displayBody: JSON.stringify(parsed, null, 2), displayLang: "json", useTreeView: true as const };
      } catch {
        return { displayBody: cleaned, displayLang: "plaintext", useTreeView: false as const };
      }
    }
    if (format === "xml") {
      try {
        return { displayBody: formatXml(cleaned), displayLang: "xml", useTreeView: false as const };
      } catch {
        return { displayBody: cleaned, displayLang: "plaintext", useTreeView: false as const };
      }
    }
    if (format === "html") {
      return { displayBody: cleaned, displayLang: "html", useTreeView: false as const };
    }
    return { displayBody: cleaned, displayLang: "plaintext", useTreeView: false as const };
  }, [format, cleaned, isJson, formatted, contentType]);

  return (
    <div className="flex flex-col h-full">
      <div className="relative min-h-0 flex-1 group/mini">
        <div
          className={`absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 transition-all opacity-0 group-hover/mini:opacity-100`}
        >
          <Select value={format} onValueChange={(value) => setFormat(value as typeof format)}>
            <SelectTrigger
              size="sm"
              className="h-5 gap-0.5 rounded px-1.5 text-ui-xs text-muted-foreground hover:text-foreground border-0 bg-transparent hover:bg-surface-elevated/50 [&_svg]:size-2.5"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              side="bottom"
              alignItemWithTrigger={false}
              sideOffset={4}
              className="min-w-[90px] [&_[data-slot=select-item]]:py-1.5 [&_[data-slot=select-item]]:pr-9 [&_[data-slot=select-item]]:text-xs"
            >
              {formatOptions.map((label, i) => (
                <SelectItem key={formatValues[i]} value={formatValues[i]}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => setWrapped((w) => !w)}
            className={`rounded p-1 transition-colors ${
              wrapped
                ? "text-foreground bg-surface-elevated/50"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated/30"
            }`}
          >
            {wrapped ? <ArrowLeftToLine className="size-3" /> : <TextWrap className="size-3" />}
          </button>
          {useTreeView && (
            <button
              onClick={allExpanded ? () => setAllExpanded(false) : () => setAllExpanded(true)}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated/30 transition-colors"
            >
              {allExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          )}
          <CopyButton
            text={displayBody}
            size="sm"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated/30 transition-colors"
          />
        </div>
        <div className="absolute inset-0 overflow-auto">
          {useTreeView && parsedJson ? (
            <JsonTreeView data={parsedJson} defaultExpanded={allExpanded} depth={0} wrapped={wrapped} />
          ) : (
            <SyntaxHighlightedBody content={displayBody} lang={displayLang} wrapped={wrapped} />
          )}
        </div>
      </div>
    </div>
  );
});

export default BodyView;
