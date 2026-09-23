export function statusCategory(status: number | null): string {
  if (status === null) return "pending";
  if (status < 300) return "success";
  if (status < 400) return "redirect";
  if (status < 500) return "client-error";
  return "server-error";
}
export function formatDuration(ms: number | null): string {
  if (ms === null) return "...";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 字节数人性化展示：B / KB / MB。仅当 bytes > 0 时返回有效字符串，否则返回空。 */
export function formatBodySize(bytes: number | undefined | null): string {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** Token 数量格式化：中文用万/亿，英文用 K/M/B。保留 1 位小数，末尾零省略。缩略值前缀 ≈。 */
export function formatTokenCount(n: number | null | undefined, locale: string = "en"): string {
  if (n == null) return "-";
  const isZh = locale === "zh";
  if (isZh) {
    if (n >= 1_0000_0000) return `≈${(n / 1_0000_0000).toFixed(1).replace(/\.0$/, "")} 亿`;
    if (n >= 1_0000) return `≈${(n / 1_0000).toFixed(1).replace(/\.0$/, "")} 万`;
    return n.toLocaleString();
  }
  // en: K / M / B
  if (n >= 1_000_000_000) return `≈${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `≈${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `≈${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

/** Token 精确值（带千分位），作为 tooltip 内容 */
export function formatTokenExact(n: number | null | undefined): string {
  if (n == null) return "-";
  return n.toLocaleString();
}
export function formatTime(ts: number | null): string {
  if (ts === null) return "";
  return new Date(ts).toLocaleTimeString();
}
/** 时间戳展示：今天只显示时间；跨天带日期；跨年再带年份 */
export function formatDayTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString();
  return d.toLocaleString(undefined, {
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
export function shortenUri(uri: string): string {
  try {
    const url = new URL(uri);
    return url.host + url.pathname + url.search;
  } catch {
    return uri;
  }
}
export function extractHost(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    // 隧道 URI 格式: host:port，直接提取主机名无需 dot 检查
    const colonAt = uri.lastIndexOf(":");
    if (colonAt > 0 && !uri.includes("/")) {
      return uri.substring(0, colonAt);
    }
    try {
      const host = new URL(`https://${uri}`).hostname;
      // 真域名必然含 .（或为 localhost），否则是路径段伪装，交给 Host header 兜底
      if (!host.includes(".") && host !== "localhost") return "(unknown)";
      return host;
    } catch {
      return "(unknown)";
    }
  }
}

// ---------------------------------------------------------------------------
// 请求类型分类（用于筛选栏）
// ---------------------------------------------------------------------------

export type TypeFilter =
  | "all"
  | "http"
  | "https"
  | "websocket"
  | "js"
  | "css"
  | "html"
  | "json"
  | "img"
  | "font"
  | "media"
  | "other";

export const TYPE_FILTERS: TypeFilter[] = [
  "all",
  "http",
  "https",
  "websocket",
  "js",
  "css",
  "html",
  "json",
  "img",
  "font",
  "media",
  "other",
];

const IMG_EXTS = /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif|tiff?)($|\?)/i;
const FONT_EXTS = /\.(woff2?|ttf|otf|eot)($|\?)/i;
const MEDIA_EXTS = /\.(mp4|webm|ogg|mp3|m4a|wav|flac|aac|avi|mov)($|\?)/i;

/** 请求头中是否携带 Upgrade: websocket（header 名与值均不区分大小写） */
function isWsUpgrade(headers?: Record<string, string>): boolean {
  if (!headers) return false;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "upgrade" && v.toLowerCase().includes("websocket")) return true;
  }
  return false;
}

/**
 * 根据 URI、scheme 和响应 Content-Type 对请求进行分类。
 * 优先使用 Content-Type（更精确），回退到 URI 扩展名。
 */
export function classifyEntry(entry: {
  uri: string;
  decrypted?: boolean;
  requestHeaders?: Record<string, string>;
  status?: number | null;
  responseHeaders: Record<string, string> | null;
}): TypeFilter {
  const uri = entry.uri;
  const ct = entry.responseHeaders
    ? (entry.responseHeaders["content-type"] ?? entry.responseHeaders["Content-Type"] ?? "").toLowerCase()
    : "";

  // WebSocket：ws(s) scheme / Upgrade: websocket 请求头 / 101 响应。
  // 注意 SSE（text/event-stream）不是 WebSocket，按普通 HTTP(S) 分类。
  if (
    uri.startsWith("ws://") ||
    uri.startsWith("wss://") ||
    entry.status === 101 ||
    isWsUpgrade(entry.requestHeaders)
  ) {
    return "websocket";
  }

  // 优先用 Content-Type 分类
  if (ct) {
    if (ct.includes("javascript")) return "js";
    if (ct.includes("text/css")) return "css";
    if (ct.includes("text/html")) return "html";
    if (ct.includes("json")) return "json";
    if (ct.includes("image/")) return "img";
    if (ct.includes("font/") || ct.includes("application/x-font")) return "font";
    if (ct.includes("video/") || ct.includes("audio/")) return "media";
  }

  // 回退到 URI 扩展名
  if (uri.endsWith(".js") || uri.endsWith(".mjs") || uri.endsWith(".cjs")) return "js";
  if (uri.endsWith(".css")) return "css";
  if (uri.endsWith(".html") || uri.endsWith(".htm")) return "html";
  if (uri.endsWith(".json") || uri.endsWith(".jsonl")) return "json";
  if (IMG_EXTS.test(uri)) return "img";
  if (FONT_EXTS.test(uri)) return "font";
  if (MEDIA_EXTS.test(uri)) return "media";

  // 根据 scheme 区分 HTTP / HTTPS
  if (uri.startsWith("http://")) return "http";
  if (uri.startsWith("https://") || entry.decrypted === true) return "https";

  // 兜底：如果无 Content-Type 也无法从 URI 判断
  if (ct) return "other";
  return "https"; // MITM 代理多数是 HTTPS
}

// ---------------------------------------------------------------------------
// 生成 cURL 命令
// ---------------------------------------------------------------------------

export type { FormatCurlOptions } from "./curl";
export { formatCurl } from "./curl";
