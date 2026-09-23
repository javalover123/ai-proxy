/**
 * URL safety for untrusted markdown: link and image destinations pass a
 * protocol allowlist; images additionally require absolute HTTP(S); inline
 * code is promoted to a link only when it is exactly an absolute HTTP(S) URL.
 */

/**
 * Normalize a destination and keep it only when it parses as an absolute URL
 * with an allowlisted protocol. Relative and otherwise unparsable destinations
 * are disallowed alongside disallowed protocols; `new URL()` has no other
 * failure mode for strings.
 */
export function sanitizeUrl(url: string): string {
  try {
    switch (new URL(url).protocol) {
      case "http:":
      case "https:":
      case "mailto:":
        return url;
      default:
        return "";
    }
  } catch {
    return "";
  }
}

/**
 * The complete inline-code value when it is exactly an absolute HTTP(S) URL
 * (no surrounding whitespace); anything else stays inert code.
 */
export function inlineCodeHttpUrl(value: string): string | undefined {
  if (value.trim() !== value) return undefined;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Return the URL when it is an absolute HTTP(S) image source; otherwise
 * undefined (so the caller renders the alt text instead of an <img>).
 */
export function remoteImageUrl(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
