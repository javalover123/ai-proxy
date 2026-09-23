import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function formatPrimitive(val: JsonValue): { text: string; className: string } {
  if (val === null) return { text: "null", className: "text-purple-500" };
  if (typeof val === "boolean") return { text: String(val), className: "text-orange-500" };
  if (typeof val === "number") return { text: String(val), className: "text-emerald-500" };
  return { text: JSON.stringify(val), className: "text-green-600 dark:text-green-400" };
}

function previewValue(val: JsonValue): string {
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const first = JSON.stringify(val[0]);
    return `[${first}, …]`;
  }
  if (val !== null && typeof val === "object") {
    const keys = Object.keys(val);
    if (keys.length === 0) return "{}";
    const firstKey = keys[0];
    const firstVal = JSON.stringify((val as Record<string, JsonValue>)[firstKey]);
    return `{ ${firstKey}: ${firstVal}, … }`;
  }
  return JSON.stringify(val);
}

function TreeNode({
  label,
  value,
  defaultExpanded,
  depth,
}: {
  label?: string;
  value: JsonValue;
  defaultExpanded: boolean;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isCollapsible = value !== null && typeof value === "object";

  useEffect(() => {
    if (isCollapsible) {
      setExpanded(defaultExpanded);
    }
  }, [defaultExpanded, isCollapsible]);

  const indent = depth * 12;

  if (!isCollapsible) {
    const { text, className } = formatPrimitive(value);
    const hasLabel = label !== undefined;
    return (
      <div className="py-px hover:bg-surface-elevated/20 transition-colors" style={{ paddingLeft: indent + 12 }}>
        {hasLabel && (
          <span className="text-foreground/80">
            {JSON.stringify(label)}
            <span className="text-muted-foreground/60 mx-1">: </span>
          </span>
        )}
        <span className={className}>{text}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, JsonValue>);
  const count = isArray ? value.length : entries.length;
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";

  return (
    <div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-0 w-full text-left py-px hover:bg-surface-elevated/20 transition-colors"
        style={{ paddingLeft: Math.max(indent, 0) }}
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
        )}
        {label !== undefined && (
          <>
            <span className="text-foreground/80 shrink-0 ml-0.5">{JSON.stringify(label)}</span>
            <span className="text-muted-foreground/60 mx-0.5 shrink-0">: </span>
          </>
        )}
        {expanded ? (
          <span className="text-muted-foreground/70">{openBracket}</span>
        ) : (
          <span className="text-muted-foreground truncate min-w-0" style={{ opacity: 0.3 }}>
            {`${openBracket} ${previewValue(value)} ${closeBracket}`}
          </span>
        )}
        {expanded && (
          <span className="text-muted-foreground/40 text-ui-xs ml-1 shrink-0">
            {isArray ? `${count} items` : `${count} keys`}
          </span>
        )}
      </button>
      {expanded && (
        <div>
          {entries.map(([key, val]) => (
            <TreeNode
              key={key}
              label={isArray ? undefined : key}
              value={val}
              defaultExpanded={defaultExpanded}
              depth={depth + 1}
            />
          ))}
          <div className="text-muted-foreground/70 py-px" style={{ paddingLeft: indent + 12 }}>
            {closeBracket}
          </div>
        </div>
      )}
    </div>
  );
}

export default function JsonTreeView({
  data,
  defaultExpanded,
  depth = 0,
  wrapped = false,
}: {
  data: JsonValue;
  defaultExpanded: boolean;
  depth?: number;
  wrapped?: boolean;
}) {
  return (
    <div
      className={`font-mono text-prose-md leading-5 ${wrapped ? "whitespace-pre-wrap break-all" : "whitespace-nowrap overflow-x-auto"}`}
    >
      <TreeNode value={data} defaultExpanded={defaultExpanded} depth={depth} />
    </div>
  );
}
