import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { EditRequestDialog } from '@/features/proxy'
import { SettingsDialog } from '@/features/settings'
import { AboutDialog } from '@/features/about'
import { SslConfigDialog } from '@/features/ssl-config'
import { ScriptConfigDialog } from '@/features/script-config'
import { AiConfigDialog } from '@/features/ai-config'
import { TitleBar } from '@/features/title-bar'
import { ToolBar } from '@/features/tool-bar'
import { BottomBar, type DetailPosition } from '@/features/bottom-bar'
import { AiView } from '@/features/ai-view'
import { NewRequestView } from '@/features/new-request'
import { ProxyView } from '@/features/proxy'
import type { ViewId, ScriptTab } from '@/types/view'
import type { ProxyJumpTarget } from '@/types/proxy'
import { useProxyEvents } from '@/hooks/useProxyEvents'
import { useTheme } from '@/hooks/useTheme'
import { useProseFontSize } from '@/hooks/useProseFontSize'
import { copyToClipboard } from '@/lib/clipboard'
import { classifyEntry, type TypeFilter } from '@/lib/format'
import { formatCurl } from '@/lib/curl'
import { TooltipProvider } from '@/components/ui/tooltip'
import ScriptEditor from '@/features/script-config/ScriptEditor'
import type { ScriptItem } from '@/types/settings'

function nextScriptId(used: string[]): number {
  const nums = used
    .map(k => { const m = k.match(/^script-(\d+)$/); return m ? parseInt(m[1], 10) : 0 })
    .filter(n => n > 0)
  for (let i = 1; ; i++) {
    if (!nums.includes(i)) return i
  }
}

function App() {
  const [status, setStatus] = useState('Stopped')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [sslConfigOpen, setSslConfigOpen] = useState(false)
  const [scriptConfigOpen, setScriptConfigOpen] = useState(false)
  const [aiConfigOpen, setAiConfigOpen] = useState(false)
  const [sendRequestOpen, setSendRequestOpen] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [detailPosition, setDetailPosition] = useState<DetailPosition>('bottom')
  const [scriptEnabled, setScriptEnabled] = useState(false)
  const [sslEnabled, setSslEnabled] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [toolbarExpanded, setToolbarExpanded] = useState(false)
  // 从 AI 视图跳转到代理视图并定位某条流量的指令（含自增 nonce）。
  const [proxyJump, setProxyJump] = useState<ProxyJumpTarget | null>(null)
  // 清空流量联动清空 AI 会话的递增信号（AiView 消费）
  const [aiClearNonce, setAiClearNonce] = useState(0)
  // 从 AI 视图导入请求到 new-request 编辑器（含自增 nonce 确保重复触发）
  const [importEditorTrigger, setImportEditorTrigger] = useState<{ entryId: number; nonce: number } | null>(null)
  // mountedViews: which views have their component currently mounted.
  // Closing a tab = unmount (remove from set) + switch to proxy.
  // Clicking a tab = mount (add to set) + switch to it.
  const [mountedViews, setMountedViews] = useState<Set<ViewId>>(new Set(['proxy']))
  // Script editor tabs
  const [scriptTabs, setScriptTabs] = useState<ScriptTab[]>([])
  // Floating script editor (overlay, not yet in a tab)
  const [floatingScript, setFloatingScript] = useState<{ tab: ScriptTab } | null>(null)
  // activeTabId: either a ViewId or a script fileKey
  const [activeTabId, setActiveTabId] = useState<string>('proxy')

  const handleViewChange = useCallback((view: ViewId) => {
    setMountedViews(prev => new Set(prev).add(view))
    setActiveTabId(view)
  }, [])

  // Script tab management
  const handleEditScript = useCallback(async (item: ScriptItem) => {
    const key = item.file_name || `script-${nextScriptId([...scriptTabs.map(t => t.fileKey), floatingScript?.tab.fileKey].filter((k): k is string => !!k))}`
    const label = item.name || key

    // If already in a tab, just switch to it
    const existingTab = scriptTabs.find(t => t.fileKey === key)
    if (existingTab) {
      setActiveTabId(key)
      return
    }

    // If already floating, just switch to it
    if (floatingScript?.tab.fileKey === key) return

    // Load content from disk for existing scripts, use template for new ones
    let content = `// ${label}\nfunction onRequest(req) {\n  return req;\n}\n\nfunction onResponse(res) {\n  return res;\n}\n`
    if (item.file_name) {
      try {
        content = await invoke<string>('get_script_content', { fileName: item.file_name })
      } catch (_) {
        // If loading fails, keep the default template
      }
    }

    const newTab: ScriptTab = {
      fileKey: key,
      label,
      content,
      method: item.method || '',
      domain: item.domain || '',
      dirty: false,
      saved: !!item.file_name,
    }
    // Open as floating overlay, close config dialog so they don't stack
    setScriptConfigOpen(false)
    setFloatingScript({ tab: newTab })
  }, [scriptTabs, floatingScript])

  const handleCloseFloatingScript = useCallback(() => {
    setFloatingScript(null)
    // Re-open config dialog if it was closed when the floating editor opened
    setScriptConfigOpen(true)
  }, [])

  const handleMaximizeScript = useCallback(() => {
    if (!floatingScript) return
    setScriptConfigOpen(false)
    setScriptTabs(prev => [...prev, floatingScript.tab])
    setActiveTabId(floatingScript.tab.fileKey)
    setFloatingScript(null)
  }, [floatingScript])

  const handleRestoreScript = useCallback((fileKey: string) => {
    const tab = scriptTabs.find(t => t.fileKey === fileKey)
    if (!tab) return
    // Remove from tabs and open as floating
    setScriptTabs(prev => prev.filter(t => t.fileKey !== fileKey))
    setFloatingScript({ tab })
    setActiveTabId('proxy')
  }, [scriptTabs])

  const handleSelectScriptTab = useCallback((fileKey: string) => {
    setActiveTabId(fileKey)
  }, [])

  const handleCloseScriptTab = useCallback((fileKey: string) => {
    setScriptTabs(prev => prev.filter(t => t.fileKey !== fileKey))
    setActiveTabId('proxy')
  }, [])

  const handleUpdateScriptDraft = useCallback((fileKey: string, content: string) => {
    setScriptTabs(prev => prev.map(t =>
      t.fileKey === fileKey ? { ...t, content, dirty: true } : t
    ))
  }, [])

  const handleUpdateScriptMethod = useCallback((fileKey: string, method: string) => {
    setScriptTabs(prev => prev.map(t =>
      t.fileKey === fileKey ? { ...t, method, dirty: true } : t
    ))
  }, [])

  const handleUpdateScriptDomain = useCallback((fileKey: string, domain: string) => {
    setScriptTabs(prev => prev.map(t =>
      t.fileKey === fileKey ? { ...t, domain, dirty: true } : t
    ))
  }, [])

  const handleUpdateScriptName = useCallback((fileKey: string, name: string) => {
    setScriptTabs(prev => prev.map(t =>
      t.fileKey === fileKey ? { ...t, label: name, dirty: true } : t
    ))
  }, [])

  const handleScriptSaved = useCallback((fileKey: string, savedTab: ScriptTab) => {
    setScriptTabs(prev => prev.map(t =>
      t.fileKey === fileKey ? savedTab : t
    ))
    // Also update floating script if it matches
    setFloatingScript(prev => {
      if (prev && prev.tab.fileKey === fileKey) {
        return { tab: savedTab }
      }
      return prev
    })
  }, [])

  // AI 气泡 → 代理视图：切视图并下发定位指令。清类型过滤，避免目标请求被过滤掉。
  const handleJumpToProxy = useCallback((requestId: number) => {
    setTypeFilter('all')
    setMountedViews(prev => new Set(prev).add('proxy'))
    setActiveTabId('proxy')
    setProxyJump(prev => ({ id: Number(requestId), nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  const handleNewRequestSuccess = useCallback((_entryId: number) => {
    // 不跳转，保持在 new-request 视图查看响应
  }, [])
  const { entries, clear } = useProxyEvents()

  const handleCloseTab = useCallback((view: ViewId) => {
    if (view === 'proxy') return
    setMountedViews(prev => {
      const next = new Set(prev)
      next.delete(view)
      return next
    })
    setActiveTabId('proxy')
    // 关闭 AI tab → AiView 卸载，useAiSessions 随之退订并释放内存
  }, [])

  // AI 气泡右键 → 复制 cURL：用 entries 中同 id 的原始代理请求数据生成
  const handleCopyCurl = useCallback((requestId: number) => {
    const entry = entries.find(e => e.id === requestId)
    if (!entry) return
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(entry.requestHeaders)) {
      // 跳过 host header，curl 会自动设置
      if (k.toLowerCase() === 'host') continue
      headers[k] = v
    }
    const curl = formatCurl({
      method: entry.method,
      url: entry.uri,
      headers,
      body: entry.requestBody,
    })
    copyToClipboard(curl)
  }, [entries])

  // AI 气泡右键 → 导入编辑器：切视图并下发导入指令
  const handleImportToEditor = useCallback((requestId: number) => {
    setMountedViews(prev => new Set(prev).add('new-request'))
    setActiveTabId('new-request')
    setImportEditorTrigger(prev => ({ entryId: requestId, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])
  const { theme, setTheme } = useTheme()
  const { proseFontSize, setProseFontSize } = useProseFontSize()

  const typeCounts = useMemo(() => {
    const counts = new Map<TypeFilter, number>()
    for (const e of entries) {
      const t = classifyEntry(e)
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    counts.set('all', entries.length)
    return counts
  }, [entries])

  useEffect(() => {
    checkStatus()
    loadScriptAndSslState()
  }, [])

  useEffect(() => {
    const unsubs: Array<() => void> = []

    listen('open-settings', () => setSettingsOpen(true)).then((unlisten) => {
      unsubs.push(unlisten)
    })

    getCurrentWindow()
      .listen('open-settings', () => setSettingsOpen(true))
      .then((unlisten) => {
        unsubs.push(unlisten)
      })

    return () => {
      unsubs.forEach((unlisten) => unlisten())
    }
  }, [])

  async function checkStatus() {
    try {
      const s = await invoke<string>('get_status')
      if (s.startsWith('Running')) {
        setStatus(s)
        setRunning(true)
      } else {
        setStatus(s)
        setRunning(false)
      }
    } catch (_) {}
  }

  async function loadScriptAndSslState() {
    try {
      const settings = await invoke<{ ssl: { enabled: boolean }; script: { enabled: boolean } }>('get_settings')
      setSslEnabled(settings.ssl.enabled)
      setScriptEnabled(settings.script.enabled)
    } catch (_) {}
    try {
      const aiConfig = await invoke<{ enabled: boolean }>('get_ai_config')
      setAiEnabled(aiConfig.enabled)
    } catch (_) {}
  }

  async function toggleScript() {
    const next = !scriptEnabled
    setScriptEnabled(next)
    try {
      // 只切总开关，脚本列表由后端原样保留
      await invoke('set_script_enabled', { enabled: next })
    } catch (_) {}
  }

  async function toggleSsl() {
    const next = !sslEnabled
    setSslEnabled(next)
    try {
      // 只切总开关，域名白名单由后端原样保留
      await invoke('set_ssl_enabled', { enabled: next })
    } catch (_) {}
  }

  async function toggleAi() {
    const next = !aiEnabled
    setAiEnabled(next)
    try {
      await invoke('set_ai_enabled', { enabled: next })
    } catch (_) {}
  }

  async function startProxy() {
    setError('')
    try {
      const result = await invoke<string>('start_proxy')
      setStatus(result)
      setRunning(true)
    } catch (err) {
      setError(String(err))
    }
  }

  async function stopProxy() {
    setError('')
    try {
      const result = await invoke<string>('stop_proxy')
      setStatus(result)
      setRunning(false)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden bg-surface-deep text-foreground">
      <TitleBar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenSslConfig={() => setSslConfigOpen(true)}
        onOpenScriptConfig={() => setScriptConfigOpen(true)}
        onOpenAiConfig={() => setAiConfigOpen(true)}
        running={running}
        onStartProxy={startProxy}
        onStopProxy={stopProxy}
        onClearTraffic={() => { clear(); setAiClearNonce(n => n + 1) }}
        mountedViews={mountedViews}
        onViewChange={handleViewChange}
        onCloseTab={handleCloseTab}
        toolbarExpanded={toolbarExpanded}
        onToolbarToggle={setToolbarExpanded}
        scriptTabs={scriptTabs}
        activeTabId={activeTabId}
        onSelectScriptTab={handleSelectScriptTab}
        onCloseScriptTab={handleCloseScriptTab}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ToolBar activeTabId={activeTabId} mountedViews={mountedViews} onViewChange={handleViewChange} />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Proxy view — always mounted once opened, hidden via CSS when inactive */}
          {mountedViews.has('proxy') && (
            <div className={activeTabId === 'proxy' ? 'flex flex-col min-h-0 flex-1' : 'hidden'}>
              <ProxyView
                entries={entries}
                error={error}
                showSidebar={showSidebar}
                detailPosition={detailPosition}
                onAutoOpenDetail={() => setDetailPosition('bottom')}
                typeFilter={typeFilter}
                typeCounts={typeCounts}
                onTypeFilterChange={setTypeFilter}
                running={running}
                status={status}
                jumpTarget={proxyJump}
              />
            </div>
          )}
          {/* New-request view — always mounted once opened, hidden via CSS when inactive */}
          {mountedViews.has('new-request') && (
            <div className={activeTabId === 'new-request' ? 'min-h-0 flex-1' : 'hidden'}>
              <NewRequestView
                onSendSuccess={handleNewRequestSuccess}
                entries={entries}
                showSidebar={showSidebar}
                detailPosition={detailPosition}
                importEditorTrigger={importEditorTrigger}
              />
            </div>
          )}
          {/* AI view — always mounted once opened, hidden via CSS when inactive */}
          {mountedViews.has('ai') && (
            <div className={activeTabId === 'ai' ? 'min-h-0 flex-1' : 'hidden'}>
              <AiView
                showSidebar={showSidebar}
                clearNonce={aiClearNonce}
                onJumpToProxy={handleJumpToProxy}
                onCopyCurl={handleCopyCurl}
                onImportToEditor={handleImportToEditor}
              />
            </div>
          )}
            {/* Script editor tabs */}
            {scriptTabs.map(tab => (
              <div key={tab.fileKey} className={activeTabId === tab.fileKey ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
                <ScriptEditor
                  mode="tab"
                  tab={tab}
                  onUpdateDraft={(content) => handleUpdateScriptDraft(tab.fileKey, content)}
                  onSaved={handleScriptSaved}
                  onRestore={() => handleRestoreScript(tab.fileKey)}
                  onMethodChange={(method) => handleUpdateScriptMethod(tab.fileKey, method)}
                  onDomainChange={(domain) => handleUpdateScriptDomain(tab.fileKey, domain)}
                  onNameChange={(name) => handleUpdateScriptName(tab.fileKey, name)}
                />
              </div>
            ))}
            {/* Floating script editor overlay — Portal to body so it's above all dialogs */}
            {floatingScript && createPortal(
              <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6">
                <div className="flex h-[66%] w-[75%] flex-col overflow-hidden rounded-xl border border-border bg-surface-deep shadow-2xl">
                  <ScriptEditor
                    mode="floating"
                    tab={floatingScript.tab}
                    onUpdateDraft={(content) => {
                      setFloatingScript(prev => prev ? { tab: { ...prev.tab, content, dirty: true } } : null)
                    }}
                    onSaved={handleScriptSaved}
                    onClose={handleCloseFloatingScript}
                    onMaximize={handleMaximizeScript}
                    onMethodChange={(method) => {
                      setFloatingScript(prev => prev ? { tab: { ...prev.tab, method, dirty: true } } : null)
                    }}
                    onDomainChange={(domain) => {
                      setFloatingScript(prev => prev ? { tab: { ...prev.tab, domain, dirty: true } } : null)
                    }}
                    onNameChange={(name) => {
                      setFloatingScript(prev => prev ? { tab: { ...prev.tab, label: name, dirty: true } } : null)
                    }}
                  />
                </div>
              </div>,
              document.body
            )}
          </div>
      </div>

      <BottomBar
        showSidebar={showSidebar}
        onToggleSidebar={() => setShowSidebar(v => !v)}
        detailPosition={detailPosition}
        onToggleDetailPosition={setDetailPosition}
        scriptEnabled={scriptEnabled}
        onToggleScript={toggleScript}
        sslEnabled={sslEnabled}
        onToggleSsl={toggleSsl}
        aiEnabled={aiEnabled}
        onToggleAi={toggleAi}
      />

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <SslConfigDialog open={sslConfigOpen} onOpenChange={setSslConfigOpen} />
      <ScriptConfigDialog open={scriptConfigOpen} onOpenChange={setScriptConfigOpen} onEditScript={handleEditScript} />
      <AiConfigDialog
        open={aiConfigOpen}
        onOpenChange={(open) => {
          setAiConfigOpen(open)
          // 保存 AI 配置可能联动打开 SSL 解密，关闭弹窗后刷新底部栏开关状态
          if (!open) loadScriptAndSslState()
        }}
      />
      <EditRequestDialog
        open={sendRequestOpen}
        onOpenChange={setSendRequestOpen}
        entry={null}
        entries={entries}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        theme={theme}
        onThemeChange={setTheme}
        proseFontSize={proseFontSize}
        onProseFontSizeChange={setProseFontSize}
      />
    </div>
    </TooltipProvider>
  )
}

export default App
