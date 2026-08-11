// src/features/new-request/tabs/UrlEncodedEditor.tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocale } from '@/hooks/useLocale'
import { KeyValueEditor } from './KeyValueEditor'
import { parseUrlEncoded, serializeUrlEncoded } from '@/lib/body-utils'
import type { KeyValuePair } from '@/types/collection'

interface UrlEncodedEditorProps {
  body: string
  onChange: (body: string) => void
}

export default function UrlEncodedEditor({ body, onChange }: UrlEncodedEditorProps) {
  const { t } = useLocale()

  // Local entries state retains disabled rows across re-renders,
  // unlike the body string (URL-encoded format can't carry enabled/disabled metadata).
  const [entries, setEntries] = useState<KeyValuePair[]>(() => parseUrlEncoded(body))

  // Guard against circular update: when we serialize, disabled rows are excluded
  // from the body string. Without this ref, the useEffect below would re-parse the
  // trimmed body and silently drop the disabled rows.
  const internalRef = useRef(false)

  // Sync from external body changes (tab switch, initial load, etc.)
  useEffect(() => {
    if (!internalRef.current) {
      setEntries(parseUrlEncoded(body))
    }
    internalRef.current = false
  }, [body])

  const handleChange = useCallback((next: KeyValuePair[]) => {
    setEntries(next)
    internalRef.current = true
    onChange(serializeUrlEncoded(next))
  }, [onChange])

  return (
    <KeyValueEditor
      entries={entries}
      onChange={handleChange}
      addLabel={t('requestEditor.bodyUrlEncodedAddField')}
      emptyLabel=""
    />
  )
}
