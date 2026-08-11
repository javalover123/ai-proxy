import { useMemo } from 'react'
import { useLocale } from '@/hooks/useLocale'
import { Input } from '@/components/ui/input'
import { Select, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import type { KeyValuePair } from '@/types/collection'

type AuthType = 'none' | 'basic' | 'bearer'

interface Props {
  headers: KeyValuePair[]
  onHeadersChange: (headers: KeyValuePair[]) => void
}

/** 从 headers 中解析当前 Authorization 条目 */
function parseAuth(headers: KeyValuePair[]): { type: AuthType; username: string; password: string; token: string } {
  const entry = headers.find(h => h.key.toLowerCase() === 'authorization')
  if (!entry) return { type: 'none', username: '', password: '', token: '' }
  const val = entry.value
  if (val.startsWith('Basic ')) {
    try {
      const decoded = atob(val.slice(6))
      const colon = decoded.indexOf(':')
      if (colon >= 0) {
        return { type: 'basic', username: decoded.slice(0, colon), password: decoded.slice(colon + 1), token: '' }
      }
      return { type: 'basic', username: decoded, password: '', token: '' }
    } catch { /* fall through */ }
  }
  if (val.startsWith('Bearer ')) {
    return { type: 'bearer', username: '', password: '', token: val.slice(7) }
  }
  return { type: 'none', username: '', password: '', token: '' }
}

/** Remove Authorization header and return the rest */
function removeAuthHeader(headers: KeyValuePair[]): KeyValuePair[] {
  return headers.filter(h => h.key.toLowerCase() !== 'authorization')
}

export default function AuthTab({ headers, onHeadersChange }: Props) {
  const { t } = useLocale()
  const auth = useMemo(() => parseAuth(headers), [headers])

  const handleTypeChange = (type: AuthType) => {
    const rest = removeAuthHeader(headers)
    if (type === 'none') {
      onHeadersChange(rest)
    } else if (type === 'basic') {
      onHeadersChange([...rest, { key: 'Authorization', value: 'Basic ', enabled: true }])
    } else {
      onHeadersChange([...rest, { key: 'Authorization', value: 'Bearer ', enabled: true }])
    }
  }

  const setAuthValue = (prefix: string, val: string) => {
    const rest = removeAuthHeader(headers)
    onHeadersChange([...rest, { key: 'Authorization', value: `${prefix}${val}`, enabled: true }])
  }

  return (
    <div className="p-4 space-y-3 min-h-0">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-foreground/80 shrink-0">
          {t('requestEditor.authType')}
        </label>
        <Select
          value={auth.type}
          onValueChange={v => handleTypeChange(v as AuthType)}
        >
          <SelectTrigger size="sm" className="h-7 w-[100px] text-ui-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Positioner side="bottom" sideOffset={4} align="start" alignItemWithTrigger={false} collisionAvoidance={{ side: 'none' }} className="isolate z-50">
              <SelectPrimitive.Popup className="relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
                <SelectPrimitive.List>
                  <SelectItem value="none">{t('requestEditor.authNone')}</SelectItem>
                  <SelectItem value="basic">{t('requestEditor.authBasic')}</SelectItem>
                  <SelectItem value="bearer">{t('requestEditor.authBearer')}</SelectItem>
                </SelectPrimitive.List>
              </SelectPrimitive.Popup>
            </SelectPrimitive.Positioner>
          </SelectPrimitive.Portal>
        </Select>
      </div>

      {auth.type === 'none' && (
        <div className="py-6 text-center text-xs text-muted-foreground">No authentication</div>
      )}

      {auth.type === 'basic' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-xs text-muted-foreground w-16">{t('requestEditor.username')}</label>
            <Input
              value={auth.username}
              onChange={e => {
                const pwd = auth.password
                const cred = `${e.target.value}:${pwd}`
                setAuthValue('Basic ', btoa(cred))
              }}
              className="flex-1 h-auto py-1 text-prose-sm font-mono"
              placeholder="user"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-xs text-muted-foreground w-16">{t('requestEditor.password')}</label>
            <Input
              type="password"
              value={auth.password}
              onChange={e => {
                const usr = auth.username
                const cred = `${usr}:${e.target.value}`
                setAuthValue('Basic ', btoa(cred))
              }}
              className="flex-1 h-auto py-1 text-prose-sm font-mono"
              placeholder="••••••••"
            />
          </div>
        </div>
      )}

      {auth.type === 'bearer' && (
        <div className="flex items-center gap-2">
          <label className="shrink-0 text-xs text-muted-foreground w-16">{t('requestEditor.token')}</label>
          <Input
            value={auth.token}
            onChange={e => setAuthValue('Bearer ', e.target.value)}
            className="flex-1 h-auto py-1 text-prose-sm font-mono"
            placeholder="eyJhbGciOi..."
          />
        </div>
      )}
    </div>
  )
}
