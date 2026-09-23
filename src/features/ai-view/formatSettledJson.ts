/**
 * Pretty-print a JSON object/array for the dedicated JSON view.
 * Streaming skips the switch so a half-written payload is not snapped from
 * Markdown into a <pre> the moment the last brace arrives.
 */
export function formatSettledJson(text: string, streaming: boolean): string | null {
  if (streaming) return null;
  const s = text.trim();
  if (s.length < 8) return null;
  if (s[0] !== "{" && s[0] !== "[") return null;
  try {
    const parsed: unknown = JSON.parse(s);
    if (typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // incomplete or invalid JSON — caller renders as markdown / plain text
  }
  return null;
}
