// src/lib/format-for-ai.ts — 一键复制请求/响应/错误信息给 AI 分析

import { formatCurl } from '@/lib/curl'
import type { TrafficEntry } from '@/types/proxy'

/**
 * 将 TrafficEntry 格式化为 AI 调试上下文（markdown）。
 * 包含：cURL 请求、响应状态/头/体、错误信息。
 */
export function formatTrafficForAi(entry: TrafficEntry, locale: 'zh' | 'en' = 'zh'): string {
  const isZh = locale === 'zh'
  const sections: string[] = []

  // ---- 标题 ----
  sections.push(isZh ? '# API 调试上下文' : '# API Debug Context')
  sections.push('')

  // ---- 1. 请求 (cURL) ----
  sections.push(isZh ? '## 1. 请求 (cURL)' : '## 1. Request (cURL)')
  sections.push('')
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(entry.requestHeaders)) {
    if (k.toLowerCase() === 'host') continue
    headers[k] = v
  }
  const curl = formatCurl({
    method: entry.method,
    url: entry.uri,
    headers,
    body: entry.requestBody,
  })
  sections.push('```bash')
  sections.push(curl)
  sections.push('```')
  sections.push('')

  // ---- 2. 响应 ----
  sections.push(isZh ? '## 2. 响应' : '## 2. Response')
  sections.push('')

  if (entry.status != null) {
    sections.push(`${isZh ? '状态' : 'Status'}: ${entry.status}`)
  }
  if (entry.durationMs != null) {
    sections.push(`${isZh ? '时间' : 'Time'}: ${entry.durationMs}ms`)
  }
  sections.push('')

  if (entry.responseHeaders && Object.keys(entry.responseHeaders).length > 0) {
    sections.push(`${isZh ? 'Headers' : 'Headers'}:`)
    sections.push('```yaml')
    for (const [k, v] of Object.entries(entry.responseHeaders)) {
      sections.push(`${k}: ${v}`)
    }
    sections.push('```')
    sections.push('')
  }

  const responseBody = entry.responseChunks.join('')
  if (responseBody) {
    sections.push(`${isZh ? 'Body' : 'Body'}:`)
    sections.push('```')
    // 截断过长的 body（最大 64KB），避免撑爆 AI 上下文
    const maxLen = 65536
    const truncated = responseBody.length > maxLen
      ? responseBody.slice(0, maxLen) + `\n... (${isZh ? '已截断' : 'truncated'}, ${(responseBody.length / 1024).toFixed(1)} KB ${isZh ? '总计' : 'total'})`
      : responseBody
    sections.push(truncated)
    sections.push('```')
    sections.push('')
  } else if (entry.responseHeaders) {
    sections.push(`${isZh ? 'Body' : 'Body'}: (${isZh ? '无内容' : 'empty'})`)
    sections.push('')
  }

  // ---- 3. 网络/系统错误 ----
  sections.push(isZh ? '## 3. 网络/系统错误' : '## 3. Network / System Error')
  sections.push('')
  if (entry.error) {
    sections.push('```')
    sections.push(entry.error)
    sections.push('```')
  } else {
    sections.push(isZh ? '(无内容)' : '(none)')
  }
  sections.push('')

  // ---- 4. 指令 ----
  sections.push(isZh ? '## 4. 指令' : '## 4. Instructions')
  sections.push('')
  sections.push(
    isZh
      ? '请根据以上信息，分析报错原因，修复相关代码'
      : 'Based on the above information, analyze the cause of the error and fix the relevant code.',
  )

  return sections.join('\n')
}
