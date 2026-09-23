import type { HttpMethod } from "@/types/collection";
import type { TrafficEntry } from "@/types/proxy";

/** HTTP method → Tailwind color class suffix */
export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "badge-get",
  POST: "badge-post",
  PUT: "badge-put",
  PATCH: "badge-patch",
  DELETE: "badge-delete",
  HEAD: "badge-head",
  OPTIONS: "badge-options",
};

/** CSS var color key for the method badge background */
export const METHOD_BG_COLORS: Record<HttpMethod, string> = {
  GET: "var(--badge-get)",
  POST: "var(--badge-post)",
  PUT: "var(--badge-put)",
  PATCH: "var(--badge-patch)",
  DELETE: "var(--badge-delete)",
  HEAD: "var(--badge-head)",
  OPTIONS: "var(--badge-options)",
};

/** 补全完整 URL：代理存储的 URI 可能只是路径（如 /v1/chat/completions） */
export function buildFullUrl(entry: TrafficEntry): string {
  if (entry.uri.startsWith("http://") || entry.uri.startsWith("https://")) {
    return entry.uri;
  }
  const host = entry.requestHeaders?.host ?? entry.requestHeaders?.Host ?? "";
  if (host) {
    return `https://${host}${entry.uri}`;
  }
  return entry.uri;
}
