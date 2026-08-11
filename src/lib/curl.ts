// src/lib/curl.ts — cURL 解析与生成

import type { BodyType } from '@/types/collection'
import { parseUrlEncoded, parseFormDataBody } from '@/lib/body-utils'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface CurlParsedResultOk {
  ok: true
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

export interface CurlParsedResultErr {
  ok: false
  error: string
}

export type CurlParsedResult = CurlParsedResultOk | CurlParsedResultErr

// ---------------------------------------------------------------------------
// Tokenizer 状态
// ---------------------------------------------------------------------------

type TokenizerState = 'S_NORMAL' | 'S_SINGLE_QUOTE' | 'S_DOUBLE_QUOTE' | 'S_BACKSLASH'

/**
 * 将 cURL 命令字符串拆分为 token 列表。
 * 处理单引号、双引号、反斜杠续行符。
 */
function tokenizeCurl(raw: string): string[] {
  // 预处理：移除反斜杠续行符（`\` 后跟换行 + 可能的空白）
  const preprocessed = raw.replace(/\\\r?\n\s*/g, ' ')
  const tokens: string[] = []
  let state: TokenizerState = 'S_NORMAL'
  let prevState: TokenizerState = 'S_NORMAL'
  let current = ''

  for (let i = 0; i < preprocessed.length; i++) {
    const ch = preprocessed[i]

    switch (state) {
      case 'S_NORMAL':
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          if (current) { tokens.push(current); current = '' }
        } else if (ch === '\\') {
          prevState = 'S_NORMAL'
          state = 'S_BACKSLASH'
        } else if (ch === "'") {
          state = 'S_SINGLE_QUOTE'
        } else if (ch === '"') {
          state = 'S_DOUBLE_QUOTE'
        } else {
          current += ch
        }
        break

      case 'S_SINGLE_QUOTE':
        if (ch === "'") {
          // shell 单引号转义：'\'' → 文字 '
          // 结束当前引号 + 反斜杠转义的单引号 + 进入下一个引号
          if (
            i + 3 < preprocessed.length &&
            preprocessed[i + 1] === '\\' &&
            preprocessed[i + 2] === "'" &&
            preprocessed[i + 3] === "'"
          ) {
            current += "'"
            i += 3 // 跳过 \''，循环末尾 i++ 再进一位
            // 保持在 S_SINGLE_QUOTE
          } else {
            tokens.push(current)
            current = ''
            state = 'S_NORMAL'
          }
        } else {
          current += ch
        }
        break

      case 'S_DOUBLE_QUOTE':
        if (ch === '\\') {
          prevState = 'S_DOUBLE_QUOTE'
          state = 'S_BACKSLASH'
        } else if (ch === '"') {
          tokens.push(current)
          current = ''
          state = 'S_NORMAL'
        } else {
          current += ch
        }
        break

      case 'S_BACKSLASH':
        current += ch
        state = prevState
        break
    }
  }

  // 收尾：如果还有未提交的 token
  if (current) {
    tokens.push(current)
  }

  return tokens
}

/**
 * 解析 cURL 命令字符串，提取 method、url、headers、body。
 * 支持 -d/--data/--data-raw/--data-binary（文本模式）。
 * 不支持 --data-urlencode 和 @file 文件读取。
 */
export function parseCurl(raw: string): CurlParsedResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: 'Empty input' }
  }

  const tokens = tokenizeCurl(trimmed)

  if (tokens.length === 0) {
    return { ok: false, error: 'Empty input' }
  }

  let method = 'GET'
  const headers: Record<string, string> = {}
  let body: string | null = null
  let url: string | null = null
  let hasDataFlag = false

  let i = 0

  // 跳过程序名（curl 或类似路径）
  if (tokens[0] === 'curl' || tokens[0].endsWith('/curl') || tokens[0].endsWith('\\curl.exe')) {
    i = 1
  }

  for (; i < tokens.length; i++) {
    const token = tokens[i]

    switch (token) {
      case '-X':
      case '--request': {
        const next = tokens[++i]
        if (next) {
          method = next.toUpperCase()
        }
        break
      }

      case '-H':
      case '--header': {
        const next = tokens[++i]
        if (next) {
          const colonIdx = next.indexOf(':')
          if (colonIdx > 0) {
            const key = next.substring(0, colonIdx).trim()
            const value = next.substring(colonIdx + 1).trim()
            headers[key] = value
          }
        }
        break
      }

      case '-L':
      case '--location':
        // --location 是 curl 行为选项，解析时不处理
        break

      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary': {
        hasDataFlag = true
        const next = tokens[++i]
        if (next) {
          body = next
        }
        break
      }

      case '--data-urlencode':
        // 忽略此 flag 及其参数
        i++
        break

      default:
        // 无名 token（不以 - 开头）→ url
        if (!token.startsWith('-')) {
          url = token
        }
        break
    }
  }

  // 无 URL → 解析失败
  if (!url) {
    return { ok: false, error: 'No URL found in cURL command' }
  }

  // 有 -d 但 method 仍是 GET → 默认 POST
  if (hasDataFlag && method === 'GET') {
    method = 'POST'
  }

  return { ok: true, method, url, headers, body }
}

// ---------------------------------------------------------------------------
// 生成 cURL 命令
// ---------------------------------------------------------------------------

export interface FormatCurlOptions {
  method: string
  url: string
  headers: Record<string, string>
  body?: string | null
  bodyType?: BodyType
  params?: { key: string; value: string }[]
  cookies?: { key: string; value: string }[]
}

/**
 * 将请求数据转换为可执行的 cURL 命令字符串。
 * - params 非空 → 拼接到 URL query string
 * - cookies 非空 → 追加为 Cookie header
 * - method ∈ {GET, HEAD, OPTIONS} → 不输出 `--data-raw`
 * - 单引号包裹所有值，内部 `'` 转为 `'\''`
 * - 使用长选项格式：--location --request --header --data-raw
 */
export function formatCurl(opts: FormatCurlOptions): string {
  const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

  // 拼接 params 到 URL
  let url = opts.url
  if (opts.params && opts.params.length > 0) {
    const filled = opts.params.filter(p => p.enabled !== false && p.key.trim())
    if (filled.length > 0) {
      const sep = url.includes('?') ? '&' : '?'
      const qs = filled
        .map(p => `${encodeURIComponent(p.key.trim())}=${encodeURIComponent(p.value)}`)
        .join('&')
      url = url + sep + qs
    }
  }

  // 合并 headers（cookies 追加为 Cookie header）
  const mergedHeaders = { ...opts.headers }
  if (opts.cookies && opts.cookies.length > 0) {
    const filled = opts.cookies.filter(c => c.enabled !== false && c.key.trim())
    if (filled.length > 0) {
      const cookieStr = filled.map(c => `${c.key.trim()}=${c.value}`).join('; ')
      mergedHeaders['Cookie'] = cookieStr
    }
  }

  const lines: string[] = []
  lines.push(`curl --location --request ${opts.method} ${sq(url)}`)

  for (const [k, v] of Object.entries(mergedHeaders)) {
    lines.push(`  --header ${sq(`${k}: ${v}`)}`)
  }

  // GET/HEAD/OPTIONS 不输出 body；none 类型也不输出 body
  const noBodyMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
  if (opts.body && opts.bodyType !== 'none' && !noBodyMethods.has(opts.method.toUpperCase())) {
    if (opts.bodyType === 'urlencoded') {
      // 解析 body 为 key=value&...，每个条目输出 --data-urlencode
      const entries = parseUrlEncoded(opts.body)
      const filled = entries.filter(e => e.enabled !== false && e.key.trim())
      for (const entry of filled) {
        lines.push(`  --data-urlencode ${sq(`${entry.key.trim()}=${entry.value}`)}`)
      }
    } else if (opts.bodyType === 'multipart') {
      // 解析 body JSON，text → --form key=value，file → --form key=@path
      const entries = parseFormDataBody(opts.body)
      const filled = entries.filter(e => e.enabled !== false && e.key.trim())
      for (const entry of filled) {
        if (entry.type === 'file') {
          lines.push(`  --form ${sq(`${entry.key.trim()}=@${entry.value}`)}`)
        } else {
          lines.push(`  --form ${sq(`${entry.key.trim()}=${entry.value}`)}`)
        }
      }
    } else {
      lines.push(`  --data-raw ${sq(opts.body)}`)
    }
  }

  return lines.join(' \\\n')
}
