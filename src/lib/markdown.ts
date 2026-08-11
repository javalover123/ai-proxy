/** 启发式判断文本是否像 Markdown，供 AI 气泡决定是否提供 md 渲染。
 *  规则宽松命中（任一特征即真），误判由气泡级手动切换兜底。 */

const FENCE_RE = /^```/m
const HEADING_RE = /^#{1,6}\s\S/m
const BOLD_RE = /\*\*[^*\n]+\*\*/
const INLINE_CODE_RE = /`[^`\n]+`/
const LINK_RE = /\[[^\]\n]{1,400}\]\([^)\s]{1,1500}\)/
const AUTOLINK_RE = /https?:\/\/[^\s<>{}\][|`"'\\^]+/
const BLOCKQUOTE_RE = /^>\s?\S/m
// 列表规则带 g 标志用于计数（≥2 项才算命中，降低普通短横线句误判）
const BULLET_RE = /^[ \t]*[-*+]\s\S/gm
const ORDERED_RE = /^[ \t]*\d+\.\s\S/gm
// 表格分隔行（如 |---|:--:|），需同时存在竖线才算表格
const TABLE_SEP_RE = /^(?=[ \t:|-]*-{3,})[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/m

export function isLikelyMarkdown(text: string): boolean {
  if (!text) return false
  if (FENCE_RE.test(text)) return true
  if (HEADING_RE.test(text)) return true
  if (BOLD_RE.test(text) || INLINE_CODE_RE.test(text)) return true
  if (LINK_RE.test(text) || AUTOLINK_RE.test(text)) return true
  if (BLOCKQUOTE_RE.test(text)) return true
  if ((text.match(BULLET_RE)?.length ?? 0) >= 2) return true
  if ((text.match(ORDERED_RE)?.length ?? 0) >= 2) return true
  if (text.includes('|') && TABLE_SEP_RE.test(text)) return true
  return false
}

/**
 * 检测文本是否为 JSON 对象或数组（非 primitive）。
 * 仅对 Object/Array 返回 true，排除 string/number/boolean/null 等 JSON primitive，
 * 避免将普通文本误判为 JSON。
 * 快速 reject 路径：不足 8 字符（{}、[] 无意义）或非 {/[ 开头。
 */
export function isJsonObject(text: string): boolean {
  if (!text) return false
  const s = text.trim()
  if (s.length < 8) return false
  const first = s[0]
  if (first !== '{' && first !== '[') return false
  try {
    const parsed = JSON.parse(s)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}
