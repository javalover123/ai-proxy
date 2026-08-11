// src/features/new-request/SaveToCollectionDialog.tsx
import { useState, useCallback, useMemo, useRef } from 'react'
import { PlusIcon, FolderIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useLocale } from '@/hooks/useLocale'
import { cn } from '@/lib/utils'
import type { ApiCollection, ApiTreeNode } from '@/types/collection'

interface SaveToCollectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  collections: ApiCollection[]
  /** The initial request name, pre-filled from the tab */
  initialRequestName: string
  addFolder: (parentId: number, name: string) => Promise<number | null>
  onConfirm: (parentId: number, requestName: string) => void
}

/** Collect all folder nodes (collections + sub-folders) in a flat list for selection. */
interface FlatFolder {
  id: number
  name: string
  depth: number
}

function collectFolders(collections: ApiCollection[]): FlatFolder[] {
  const result: FlatFolder[] = []
  for (const col of collections) {
    result.push({ id: col.id, name: col.name, depth: 0 })
    walkNodes(col.children, 1)
  }
  return result

  function walkNodes(nodes: ApiTreeNode[], depth: number) {
    for (const n of nodes) {
      if (n.type === 'folder') {
        result.push({ id: n.id, name: n.name, depth })
        walkNodes(n.children, depth + 1)
      }
    }
  }
}

export function SaveToCollectionDialog({
  open,
  onOpenChange,
  collections,
  initialRequestName,
  addFolder,
  onConfirm,
}: SaveToCollectionDialogProps) {
  const { t } = useLocale()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [requestName, setRequestName] = useState(initialRequestName)

  // --- inline new-folder state ---
  const [addingToId, setAddingToId] = useState<number | null>(null) // which folder we're adding under
  const [newFolderName, setNewFolderName] = useState('')
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  const folders = useMemo(() => collectFolders(collections), [collections])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setSelectedId(null)
      setAddingToId(null)
      setNewFolderName('')
    } else {
      // sync request name from tab when opening
      setRequestName(initialRequestName)
    }
    onOpenChange(open)
  }, [onOpenChange, initialRequestName])

  const handleConfirm = useCallback(() => {
    if (selectedId == null) return
    const folder = folders.find(f => f.id === selectedId)
    if (folder) {
      onConfirm(folder.id, requestName.trim() || initialRequestName)
    }
    handleOpenChange(false)
  }, [selectedId, folders, requestName, initialRequestName, onConfirm, handleOpenChange])

  // --- new folder creation ---
  const startAddFolder = useCallback((parentId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setAddingToId(parentId)
    setNewFolderName('')
    // focus the input after render
    requestAnimationFrame(() => newFolderInputRef.current?.focus())
  }, [])

  const commitNewFolder = useCallback(() => {
    const name = newFolderName.trim()
    if (!name || addingToId == null) {
      setAddingToId(null)
      return
    }
    addFolder(addingToId, name).then(nodeId => {
      if (nodeId != null) setSelectedId(nodeId)
    })
    setAddingToId(null)
    setNewFolderName('')
  }, [newFolderName, addingToId, addFolder])

  const cancelAddFolder = useCallback(() => {
    setAddingToId(null)
    setNewFolderName('')
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>{t('collection.saveToCollection')}</DialogTitle>
          <DialogDescription>{t('collection.saveToCollectionDesc')}</DialogDescription>
        </DialogHeader>

        {/* Request name field */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t('collection.requestName')}
          </label>
          <Input
            value={requestName}
            onChange={e => setRequestName(e.target.value)}
            className="h-8 text-xs"
            placeholder={initialRequestName}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm() }}
          />
        </div>

        {/* Folder tree with inline add-folder buttons */}
        <ScrollArea className="max-h-[240px] border rounded-md">
          {folders.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {t('collection.emptyTree')}
            </div>
          ) : (
            <div className="py-1">
              {folders.map(f => (
                <div key={f.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'group flex items-center gap-1.5 pr-1 cursor-pointer rounded-sm text-xs transition-colors list-item-base',
                      selectedId === f.id
                        ? 'list-item-selected text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50',
                    )}
                    style={{ paddingLeft: `${f.depth * 14 + 8}px`, borderLeftWidth: 3 }}
                    onClick={() => setSelectedId(f.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') setSelectedId(f.id)
                    }}
                  >
                    <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1 py-1.5">{f.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity [&_svg]:size-3"
                      onClick={e => startAddFolder(f.id, e)}
                    >
                      <PlusIcon />
                    </Button>
                  </div>

                  {/* Inline new-folder input */}
                  {addingToId === f.id && (
                    <div
                      className="flex items-center gap-1 px-2 py-1"
                      style={{ paddingLeft: `${(f.depth + 1) * 14 + 8}px` }}
                    >
                      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <Input
                        ref={newFolderInputRef}
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                        className="h-7 text-xs flex-1"
                        placeholder={t('collection.newFolder')}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitNewFolder()
                          if (e.key === 'Escape') cancelAddFolder()
                        }}
                        onBlur={commitNewFolder}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('settings.cancel')}
          </Button>
          <Button variant="outline" onClick={handleConfirm} disabled={selectedId == null}>
            {t('settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
