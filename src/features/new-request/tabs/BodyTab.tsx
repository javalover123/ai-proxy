import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useLocale } from '@/hooks/useLocale'
import CodeEditor from '@/components/code-editor/CodeEditor'
import { AlignJustifyIcon } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { BodyType } from '@/types/collection'
import UrlEncodedEditor from './UrlEncodedEditor'
import FormDataEditor from './FormDataEditor'
import { formatXml } from '@/lib/body-utils'

interface BodyTabProps {
  body: string
  bodyType: BodyType
  onBodyChange: (body: string) => void
  onBodyTypeChange: (bodyType: BodyType) => void
}

// Raw 子类型（JSON / XML / Text），与 BodyType 的对应关系
type RawSubType = 'json' | 'xml' | 'text'

const RAW_FORMATS: { value: RawSubType; labelKey: string }[] = [
  { value: 'json', labelKey: 'requestEditor.bodyFormatJson' },
  { value: 'xml', labelKey: 'requestEditor.bodyFormatXml' },
  { value: 'text', labelKey: 'requestEditor.bodyFormatText' },
]

// bodyType → sub-tab value 映射
function bodyTypeToTab(bt: BodyType): string {
  if (bt === 'none') return 'none'
  if (bt === 'urlencoded') return 'urlencoded'
  if (bt === 'multipart') return 'form-data'
  return 'raw'
}

function formatJson(input: string): string | null {
  if (!input.trim()) return null
  try {
    const parsed = JSON.parse(input)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return null
  }
}

function minifyJson(input: string): string | null {
  if (!input.trim()) return null
  try {
    const parsed = JSON.parse(input)
    return JSON.stringify(parsed)
  } catch {
    return null
  }
}

function isPrettyJson(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  return trimmed.includes('\n')
}

function formatOrMinifyJson(input: string): string | null {
  return isPrettyJson(input) ? minifyJson(input) : formatJson(input)
}

/** Determine the effective format for beautify, considering auto-detection */
function detectType(rawSubType: RawSubType, content: string): 'json' | 'xml' | null {
  if (rawSubType === 'json') return 'json'
  if (rawSubType === 'xml') {
    const trimmed = content.trim()
    return trimmed.startsWith('<') ? 'xml' : null
  }
  return null
}

/**
 * form-data / urlencoded / raw 每个子 tab 独立维护自己的 body 数据。
 * 切换到哪个 tab 就按哪个 tab 的数据发送，互不覆盖。
 */
export default function BodyTab({ body, bodyType, onBodyChange, onBodyTypeChange }: BodyTabProps) {
  const { t } = useLocale()

  // 子 tab value，由外部 bodyType 驱动
  const subTab = bodyTypeToTab(bodyType)

  // 各子 tab 独立的 body 缓存
  const [formDataBody, setFormDataBody] = useState('')
  const [urlEncodedBody, setUrlEncodedBody] = useState('')
  const [rawBody, setRawBody] = useState('')
  // 当前 raw 子类型
  const [rawSubType, setRawSubType] = useState<RawSubType>(
    bodyType === 'json' || bodyType === 'xml' || bodyType === 'text' ? bodyType : 'json'
  )

  // 初始化：根据外部 bodyType 把外部 body 灌入对应缓存
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!initializedRef.current && body) {
      const tab = bodyTypeToTab(bodyType)
      if (tab === 'form-data') setFormDataBody(body)
      else if (tab === 'urlencoded') setUrlEncodedBody(body)
      else if (tab !== 'none') setRawBody(body)
      initializedRef.current = true
    }
    // 仅首次初始化时运行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 获取当前激活子 tab 对应的 body
  const activeBody = useMemo(() => {
    if (subTab === 'none') return ''
    if (subTab === 'form-data') return formDataBody
    if (subTab === 'urlencoded') return urlEncodedBody
    return rawBody
  }, [subTab, formDataBody, urlEncodedBody, rawBody])

  // 更新当前子 tab 的缓存 + 通知父级
  const setActiveBody = useCallback((value: string) => {
    if (subTab === 'form-data') {
      setFormDataBody(value)
    } else if (subTab === 'urlencoded') {
      setUrlEncodedBody(value)
    } else if (subTab === 'none') {
      // none 不需要存储 body
    } else {
      setRawBody(value)
    }
    onBodyChange(value)
  }, [subTab, onBodyChange])

  // 子 tab 切换：更新 bodyType + 同步 body 到父级
  const handleSubTabChange = useCallback((value: string) => {
    let newBodyType: BodyType
    let newBody: string
    if (value === 'none') {
      newBodyType = 'none'
      newBody = ''
    } else if (value === 'raw') {
      newBodyType = rawSubType
      newBody = rawBody
    } else if (value === 'urlencoded') {
      newBodyType = 'urlencoded'
      newBody = urlEncodedBody
    } else {
      newBodyType = 'multipart'
      newBody = formDataBody
    }
    onBodyTypeChange(newBodyType)
    // 延迟一帧确保 bodyType 先更新，避免 body 被上一轮的 parser 处理
    requestAnimationFrame(() => onBodyChange(newBody))
  }, [rawSubType, rawBody, urlEncodedBody, formDataBody, onBodyTypeChange, onBodyChange])

  // Raw 子类型下拉切换
  const handleRawSubTypeChange = useCallback((v: RawSubType) => {
    setRawSubType(v)
    onBodyTypeChange(v)
  }, [onBodyTypeChange])

  const effectiveType = useMemo(() => detectType(rawSubType, rawBody), [rawSubType, rawBody])

  const handleBeautify = () => {
    if (!effectiveType) return
    let formatted: string | null = null
    if (effectiveType === 'json') {
      formatted = formatOrMinifyJson(rawBody)
    } else if (effectiveType === 'xml') {
      formatted = formatXml(rawBody)
      if (formatted === rawBody.trim()) formatted = null
    }
    if (formatted) {
      setRawBody(formatted)
      onBodyChange(formatted)
    }
  }

  return (
    <div className="px-1.5 pb-1.5 min-h-0 flex flex-col flex-1">
      <Tabs value={subTab} onValueChange={handleSubTabChange} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList variant="line" className="shrink-0 justify-start mb-0.5 bg-transparent px-0 rounded-none">
          <TabsTrigger value="none" className="text-ui-sm">none</TabsTrigger>
          <TabsTrigger value="form-data" className="text-ui-sm">{t('requestEditor.bodyTabFormData')}</TabsTrigger>
          <TabsTrigger value="urlencoded" className="text-ui-sm">{t('requestEditor.bodyTabUrlEncoded')}</TabsTrigger>
          <TabsTrigger value="raw" className="text-ui-sm">{t('requestEditor.bodyTabRaw')}</TabsTrigger>
        </TabsList>

        {/* none 面板：无请求体 */}
        <TabsContent value="none" className="min-h-0 flex-1 mt-0">
          <div className="flex-1 min-h-0 flex items-center justify-center text-muted-foreground text-prose-sm">
            {t('requestEditor.bodyTabNoneHint')}
          </div>
        </TabsContent>

        {/* form-data 面板：独享 formDataBody */}
        <TabsContent value="form-data" className="min-h-0 flex-1 mt-0">
          <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
            <FormDataEditor body={formDataBody} onChange={setActiveBody} />
          </div>
        </TabsContent>

        {/* urlencoded 面板：独享 urlEncodedBody */}
        <TabsContent value="urlencoded" className="min-h-0 flex-1 mt-0">
          <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
            <UrlEncodedEditor body={urlEncodedBody} onChange={setActiveBody} />
          </div>
        </TabsContent>

        {/* Raw 面板：独享 rawBody */}
        <TabsContent value="raw" className="min-h-0 flex-1 flex flex-col mt-0">
          <div className="flex-1 min-h-0 border rounded-md overflow-hidden relative group/body">
            <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 opacity-0 group-hover/body:opacity-100 transition-all">
              <Select
                value={rawSubType}
                onValueChange={v => handleRawSubTypeChange(v as RawSubType)}
              >
                <SelectTrigger
                  size="sm"
                  className="h-[22px] py-0 border-0 shadow-none rounded bg-surface-elevated/30 px-1.5 text-ui-xs text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50 transition-colors w-auto gap-0.5 [&_svg]:size-3"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" side="bottom" alignItemWithTrigger={false} sideOffset={4} className="min-w-[80px] [&_[data-slot=select-item]]:py-1.5 [&_[data-slot=select-item]]:pr-9 [&_[data-slot=select-item]]:text-xs">
                  {RAW_FORMATS.map(fmt => (
                    <SelectItem key={fmt.value} value={fmt.value}>{t(fmt.labelKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {effectiveType && (
                <button
                  onClick={handleBeautify}
                  className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated/30 transition-colors"
                >
                  <AlignJustifyIcon className="size-3" />
                </button>
              )}
            </div>
            <CodeEditor value={rawBody} language={rawSubType} onChange={setActiveBody} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
