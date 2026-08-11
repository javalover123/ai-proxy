import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { MonitorIcon, MoonIcon, SunIcon, GlobeIcon, ServerIcon, ShieldCheckIcon, DownloadIcon } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useLocale } from '@/hooks/useLocale'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { Theme } from '@/hooks/useTheme'
import type { ProseFontSize } from '@/hooks/useProseFontSize'
import type { LocaleSetting } from '@/i18n'
import type { ProxyConfig } from '@/types/settings'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme: Theme
  onThemeChange: (theme: Theme) => void
  proseFontSize: ProseFontSize
  onProseFontSizeChange: (size: ProseFontSize) => void
}

type SettingsTab = 'general' | 'proxy' | 'certificate'

interface NavItem {
  value: SettingsTab
  icon: typeof GlobeIcon
  labelKey: string
}

const NAV_ITEMS: NavItem[] = [
  { value: 'general', icon: GlobeIcon, labelKey: 'settings.generalTab' },
  { value: 'proxy', icon: ServerIcon, labelKey: 'settings.proxyTab' },
  { value: 'certificate', icon: ShieldCheckIcon, labelKey: 'settings.certificateTab' },
]

const inputClass = 'h-auto w-full'

export default function SettingsDialog({ open, onOpenChange, theme, onThemeChange, proseFontSize, onProseFontSizeChange }: Props) {
  const { t, setLocale } = useLocale()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [proxy, setProxy] = useState<ProxyConfig>({
    listen_host: '127.0.0.1',
    listen_port: 5201,
    upstream_proxy: false,
  })
  const [language, setLanguage] = useState<LocaleSetting>('system')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 证书安装/导出状态
  const [certInstalling, setCertInstalling] = useState(false)
  const [certMsg, setCertMsg] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    Promise.all([
      invoke<{ proxy: ProxyConfig }>('get_settings'),
      invoke<LocaleSetting>('get_locale'),
    ])
      .then(([settings, locale]) => {
        setProxy(settings.proxy)
        setLanguage(locale)
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false))
  }, [open])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await invoke('save_settings', { proxy })
      setLocale(language)
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleInstallCert() {
    setCertInstalling(true)
    setCertMsg('')
    try {
      const msg = await invoke<string>('install_ca_cert')
      setCertMsg(msg)
    } catch (err) {
      setCertMsg(String(err))
    } finally {
      setCertInstalling(false)
    }
  }

  async function handleExportCert() {
    setCertMsg('')
    try {
      const filePath = await save({
        defaultPath: 'ai-proxy-ca-cert.pem',
        filters: [{ name: 'Certificate', extensions: ['pem', 'crt'] }],
      })
      if (!filePath) return // 用户取消
      await invoke('export_ca_cert', { destPath: filePath })
      setCertMsg(`Certificate exported to ${filePath}`)
    } catch (err) {
      setCertMsg(String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogDescription>{t('settings.description')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('settings.loading')}</p>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as SettingsTab)}
            orientation="vertical"
            className="flex min-h-0 min-w-0 flex-1 flex-row"
          >
            <TabsList
              variant="line"
              className="h-auto w-[128px] shrink-0 flex-col items-start rounded-none border-r border-border py-2"
            >
              {NAV_ITEMS.map(({ value, icon: Icon, labelKey }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="w-full justify-start gap-2.5 px-3 py-2 text-left text-ui-lg font-medium"
                >
                  <Icon className="size-4 shrink-0" />
                  {t(labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="min-h-0 min-w-0 flex-1 px-5 py-2">
              <TabsContent value="general" className="grid gap-4">
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('settings.language')}
                  </span>
                  <Select value={language} onValueChange={(v) => v && setLanguage(v as LocaleSetting)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(value: unknown) =>
                          value === 'zh' ? t('settings.languageZh')
                            : value === 'en' ? t('settings.languageEn')
                            : t('settings.languageSystem')
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPrimitive.Portal>
                      <SelectPrimitive.Positioner side="bottom" sideOffset={4} alignItemWithTrigger={false} collisionAvoidance={{ side: 'none' }} className="isolate z-50">
                        <SelectPrimitive.Popup className="relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
                          <SelectPrimitive.List>
                            <SelectItem value="system">{t('settings.languageSystem')}</SelectItem>
                            <SelectItem value="en">{t('settings.languageEn')}</SelectItem>
                            <SelectItem value="zh">{t('settings.languageZh')}</SelectItem>
                          </SelectPrimitive.List>
                        </SelectPrimitive.Popup>
                      </SelectPrimitive.Positioner>
                    </SelectPrimitive.Portal>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('settings.theme')}
                  </span>
                  <ToggleGroup
                    value={[theme]}
                    onValueChange={(value) => {
                      if (value && value.length > 0) onThemeChange(value[0] as Theme)
                    }}
                    size="sm"
                    className="w-fit rounded-md border border-border bg-surface-elevated/50 p-0.5"
                  >
                    {(
                      [
                        { value: 'light' as Theme, icon: SunIcon },
                        { value: 'dark' as Theme, icon: MoonIcon },
                        { value: 'system' as Theme, icon: MonitorIcon },
                      ] as const
                    ).map(({ value, icon: Icon }) => (
                      <Tooltip key={value}>
                        <TooltipTrigger className="inline-flex">
                          <ToggleGroupItem
                            value={value}
                            className="inline-flex size-7 items-center justify-center rounded-[4px] border border-transparent text-muted-foreground transition-colors cursor-pointer hover:text-foreground aria-pressed:border-ring/60 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:hover:bg-background"
                          >
                            <Icon className="size-3.5" />
                          </ToggleGroupItem>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
                          {t(`theme.${value}`)}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('settings.proseFontSize')}
                  </span>
                  <ToggleGroup
                    value={[proseFontSize]}
                    onValueChange={(value) => {
                      if (value && value.length > 0) onProseFontSizeChange(value[0] as ProseFontSize)
                    }}
                    size="sm"
                    className="w-fit rounded-md border border-border bg-surface-elevated/50 p-0.5"
                  >
                    {(
                      [
                        { value: 'small' as ProseFontSize, labelKey: 'settings.proseFontSizeSmall' },
                        { value: 'normal' as ProseFontSize, labelKey: 'settings.proseFontSizeNormal' },
                        { value: 'large' as ProseFontSize, labelKey: 'settings.proseFontSizeLarge' },
                      ] as const
                    ).map(({ value, labelKey }) => (
                      <ToggleGroupItem
                        key={value}
                        value={value}
                        className="inline-flex h-7 items-center justify-center rounded-[4px] border border-transparent px-2.5 text-ui-md text-muted-foreground transition-colors cursor-pointer hover:text-foreground aria-pressed:border-ring/60 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:hover:bg-background"
                      >
                        {t(labelKey)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <p className="text-ui-sm text-muted-foreground/70">
                    {t('settings.proseFontSizeHint')}
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="proxy" className="grid gap-4">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('settings.listenHost')}
                  </span>
                  <Input
                    className={inputClass}
                    value={proxy.listen_host}
                    onChange={(e) => setProxy((p) => ({ ...p, listen_host: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('settings.listenPort')}
                  </span>
                  <Input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={65535}
                    value={proxy.listen_port}
                    onChange={(e) =>
                      setProxy((p) => ({ ...p, listen_port: Number(e.target.value) || 0 }))
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="upstream-proxy"
                    checked={proxy.upstream_proxy}
                    onCheckedChange={(checked) =>
                      setProxy((p) => ({ ...p, upstream_proxy: !!checked }))
                    }
                  />
                  <Label htmlFor="upstream-proxy">{t('settings.upstreamProxy')}</Label>
                </label>
              </TabsContent>

              <TabsContent value="certificate" className="grid gap-4">
                <p className="text-xs text-muted-foreground">
                  {t('settings.certHint')}
                </p>

                {/* 安装证书 */}
                <div className="rounded-lg border border-border bg-surface-deep p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="grid gap-0.5">
                      <span className="text-ui-md font-medium text-foreground">
                        {t('settings.certInstallTitle')}
                      </span>
                      <span className="text-ui-sm text-muted-foreground">
                        {t('settings.certInstallDesc')}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={handleInstallCert}
                      disabled={certInstalling}
                    >
                      <ShieldCheckIcon className="size-3.5" />
                      {certInstalling ? t('settings.saving') : t('settings.installCert')}
                    </Button>
                  </div>
                </div>

                {/* 导出证书 */}
                <div className="rounded-lg border border-border bg-surface-deep p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="grid gap-0.5">
                      <span className="text-ui-md font-medium text-foreground">
                        {t('settings.certExportTitle')}
                      </span>
                      <span className="text-ui-sm text-muted-foreground">
                        {t('settings.certExportDesc')}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={handleExportCert}
                    >
                      <DownloadIcon className="size-3.5" />
                      {t('settings.exportCert')}
                    </Button>
                  </div>
                </div>

                {certMsg && (
                  <Alert variant={certMsg.includes('already') || certMsg.includes('installed') ? 'default' : 'destructive'}>
                    <AlertDescription>{certMsg}</AlertDescription>
                  </Alert>
                )}
              </TabsContent>
            </div>
          </Tabs>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('settings.cancel')}
          </Button>
          <Button variant="outline" onClick={handleSave} disabled={loading || saving}>
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
