// src/lib/body-utils.ts — body 解析/序列化工具
// urlencoded 和 multipart body 在存储层都是字符串，KV 编辑器在显示时解析、变更时序列化

import type { KeyValuePair, BodyType, RequestBody, FormDataPart } from '@/types/collection'

// ---------------------------------------------------------------------------
// FormDataEntry
// ---------------------------------------------------------------------------

export interface FormDataEntry {
  key: string
  value: string
  enabled: boolean
  type: 'text' | 'file'
}

// ---------------------------------------------------------------------------
// urlencoded
// ---------------------------------------------------------------------------

/**
 * 将 URL 编码字符串解析为 KeyValuePair[]
 * "key1=val1&key2=val2" → [{key:"key1", value:"val1", enabled:true}, ...]
 *
 * 如果 body 看起来像 JSON/XML（不以 key=value 开头），返回空数组，
 * 避免把 Raw 类型的内容误当 urlencoded 解析。
 */
export function parseUrlEncoded(body: string): KeyValuePair[] {
  const trimmed = body.trim()
  if (!trimmed) return []
  // 明显的非 urlencoded 内容：JSON、XML、或纯文本
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('<')) return []
  // 至少包含一个 = 才算合法的 KV 对
  if (!trimmed.includes('=')) return []
  try {
    return trimmed.split('&').map(pair => {
      const eqIdx = pair.indexOf('=')
      if (eqIdx < 0) {
        return { key: decodeURIComponent(pair), value: '', enabled: true }
      }
      return {
        key: decodeURIComponent(pair.substring(0, eqIdx)),
        value: decodeURIComponent(pair.substring(eqIdx + 1)),
        enabled: true,
      }
    })
  } catch {
    // 解码失败时返回空数组
    return []
  }
}

/**
 * 将 KeyValuePair[] 序列化为 URL 编码字符串
 * [{key:"a",value:"1",enabled:true}, {key:"b",value:"2",enabled:false}]
 *   → "a=1&b=2"
 * 跳过高亮但 enabled===false 的条目（disabled entries are preserved in editor but excluded from output）
 */
export function serializeUrlEncoded(entries: KeyValuePair[]): string {
  return entries
    .filter(e => e.enabled !== false)
    .map(e => `${encodeURIComponent(e.key.trim())}=${encodeURIComponent(e.value)}`)
    .join('&')
}

// ---------------------------------------------------------------------------
// multipart / form-data
// ---------------------------------------------------------------------------

/**
 * 将 JSON 数组字符串解析为 FormDataEntry[]
 * "[{key,value,type,enabled}]" → FormDataEntry[]
 */
export function parseFormDataBody(body: string): FormDataEntry[] {
  if (!body.trim()) return []
  try {
    const parsed = JSON.parse(body)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e: unknown): e is Record<string, unknown> => typeof e === 'object' && e !== null)
      .map(e => ({
        key: String(e.key ?? ''),
        value: String(e.value ?? ''),
        enabled: e.enabled !== false,
        type: (e.type === 'file' ? 'file' : 'text') as 'text' | 'file',
      }))
  } catch {
    return []
  }
}

/**
 * 将 FormDataEntry[] 序列化为 JSON 数组字符串
 */
export function serializeFormDataBody(entries: FormDataEntry[]): string {
  return JSON.stringify(entries)
}

// ---------------------------------------------------------------------------
// buildSendBody：{ bodyType, body } → 结构化 RequestBody（Tauri IPC 用）
// ---------------------------------------------------------------------------

/**
 * 将编辑器存储的 (bodyType, body) 转为结构化的 RequestBody。
 *
 * - json / xml / text / urlencoded → { mode: "raw", content, language }
 * - multipart / form-data → { mode: "formData", parts: FormDataPart[] }
 * - body 为空字符串 → null（即无 body）
 *
 * urlencoded 的百分号编码由前端完成（`serializeUrlEncoded`），
 * multipart 的 MIME 构建由 Rust 后端完成。
 */
export function buildSendBody(bodyType: BodyType, body: string): RequestBody {
  if (!body) return null

  switch (bodyType) {
    case 'none':
      return null

    case 'json':
      return { mode: 'raw', content: body, language: 'json' }

    case 'xml':
      return { mode: 'raw', content: body, language: 'xml' }

    case 'urlencoded': {
      const encoded = serializeUrlEncoded(
        parseUrlEncoded(body).filter(p => p.enabled !== false && p.key.trim()),
      )
      return encoded ? { mode: 'raw', content: encoded, language: 'urlencoded' } : null
    }

    case 'multipart': {
      const parts: FormDataPart[] = parseFormDataBody(body)
        .filter(p => p.enabled !== false && p.key.trim())
        .map(p => ({ key: p.key.trim(), value: p.value, partType: p.type }))
      return parts.length > 0 ? { mode: 'formData', parts } : null
    }

    default: // 'text' | 'auto' | 其他
      return { mode: 'raw', content: body }
  }
}

// ---------------------------------------------------------------------------
// XML 格式化（从 BodyTab.tsx 内联格式逻辑提取，消除 CodeMirror 中的重复）
// ---------------------------------------------------------------------------

export function formatXml(input: string): string {
  const lines = input
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(/>(\s*)(?=<[^!?/])/g, '>\n')
    .replace(/>\s*$/gm, '>\n')
    .replace(/^\s*</gm, '<')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
  let indent = 0
  let result = ''
  for (const line of lines) {
    if (line.match(/^<\//) || line.match(/^<\?/)) {
      indent--
    }
    result += '  '.repeat(Math.max(0, indent)) + line + '\n'
    if (
      /^<[^!?/]/.test(line) &&
      !line.match(/\/>\s*$/) &&
      !line.match(/^<\?/) &&
      !line.match(/^<!--/) &&
      !line.match(/^<!\[CDATA\[/)
    ) indent++
  }
  return result.trim()
}
