// src/features/new-request/ApiTreeItem.tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronRightIcon, FolderIcon, Trash2Icon, CopyIcon, PencilIcon, FileIcon, ImportIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurl } from '@/lib/curl'
import { CopyButton } from '@/components/core/CopyButton'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { ApiTreeNode, ApiFolderNode, ApiRequestNode } from '@/types/collection'
import { METHOD_COLORS } from '@/lib/http-constants'
import { useLocale } from '@/hooks/useLocale'

interface ApiTreeItemProps {
  node: ApiTreeNode
  depth: number
  selectedId: number | null
  renamingId: number | null
  onClearRenamingId: () => void
  onSelectRequest: (node: ApiRequestNode) => void
  onRemoveNode: (nodeId: number) => void
  onRenameNode: (nodeId: number, newName: string) => void
  onDuplicateRequest: (nodeId: number) => void
  onAddFolder: (parentId: number) => void
  onAddRequest: (parentId: number) => void
  onImportCurl?: (parentId: number) => void
  expandedIds: Set<number>
  onToggleExpand: (nodeId: number) => void
}

export function ApiTreeItem({
  node,
  depth,
  selectedId,
  renamingId,
  onClearRenamingId,
  onSelectRequest,
  onRemoveNode,
  onRenameNode,
  onDuplicateRequest,
  onAddFolder,
  onAddRequest,
  onImportCurl,
  expandedIds,
  onToggleExpand,
}: ApiTreeItemProps) {
  const { t } = useLocale()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.name)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const isFolder = node.type === 'folder'
  const isSelected = !isFolder && selectedId === node.id
  const isExpanded = isFolder && expandedIds.has(node.id)

  // 重命名时自动 focus
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renaming])

  // 新创建的节点自动进入重命名
  useEffect(() => {
    if (renamingId != null && renamingId === node.id) {
      setRenaming(true)
      setRenameValue(node.name)
      onClearRenamingId()
    }
  }, [renamingId, node.id, node.name, onClearRenamingId])

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== node.name) {
      onRenameNode(node.id, trimmed)
    }
    setRenaming(false)
  }, [renameValue, node.id, node.name, onRenameNode])

  const handleCopyCurl = useCallback(() => {
    const req = node as ApiRequestNode
    const headerMap: Record<string, string> = {}
    for (const h of req.headers) {
      if (h.key.trim()) headerMap[h.key.trim()] = h.value
    }
    return formatCurl({
      method: req.method,
      url: req.url,
      headers: headerMap,
      body: req.body || null,
      bodyType: req.bodyType,
      params: req.params,
      cookies: req.cookies,
    })
  }, [node])

  // 点击事件
  const handleClick = useCallback(() => {
    if (isFolder) {
      onToggleExpand(node.id)
    } else {
      onSelectRequest(node as ApiRequestNode)
    }
  }, [isFolder, node, onToggleExpand, onSelectRequest])

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger>
        <div
          className={cn(
            'group flex items-center gap-1 px-2 py-1 cursor-pointer rounded-sm text-xs transition-colors list-item-base',
            isSelected ? 'list-item-selected text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50',
            contextMenuOpen && 'bg-surface-elevated/50 text-foreground'
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px`, borderLeftWidth: 3 }}
          onClick={handleClick}
          onDoubleClick={() => setRenaming(true)}
        >
          {/* 文件夹：展开/折叠箭头 */}
          {isFolder && (
            <ChevronRightIcon
              className={cn('size-3 shrink-0 transition-transform', isExpanded && 'rotate-90')}
            />
          )}
          {/* 请求：无箭头，留占位 */}
          {!isFolder && <span className="w-3 shrink-0" />}

          {/* 文件夹图标 */}
          {isFolder && <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />}

          {/* 请求：Method badge + 名称 */}
          {!isFolder && !renaming && (
            <>
              <span className={cn('shrink-0 text-ui-xs font-bold', `text-${METHOD_COLORS[(node as ApiRequestNode).method]}`)}>
                {(node as ApiRequestNode).method}
              </span>
              <span className="truncate">{node.name}</span>
            </>
          )}

          {/* 文件夹：名称 */}
          {isFolder && !renaming && (
            <span className="truncate">{node.name}</span>
          )}

          {/* 重命名输入框 */}
          {renaming && (
            <Input
              ref={renameInputRef}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRenameSubmit()
                if (e.key === 'Escape') { setRenaming(false); setRenameValue(node.name) }
              }}
              className="flex-1 min-w-0 h-auto py-0 text-prose-md font-mono"
            />
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="text-xs min-w-32">
        {isFolder ? (
          <>
            <ContextMenuItem onClick={() => onAddRequest(node.id)}>
              <FileIcon className="size-3" />
              <span>{t('collection.newRequest')}</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onAddFolder(node.id)}>
              <FolderIcon className="size-3" />
              <span>{t('collection.newFolder')}</span>
            </ContextMenuItem>
            {onImportCurl && (
              <ContextMenuItem onClick={() => onImportCurl(node.id)}>
                <ImportIcon className="size-3" />
                <span>{t('collection.importCurl')}</span>
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => setRenaming(true)}>
              <PencilIcon className="size-3" />
              <span>{t('collection.rename')}</span>
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onClick={() => onRemoveNode(node.id)}>
              <Trash2Icon className="size-3" />
              <span>{t('collection.delete')}</span>
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={() => setRenaming(true)}>
              <PencilIcon className="size-3" />
              <span>{t('collection.rename')}</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onDuplicateRequest(node.id)}>
              <CopyIcon className="size-3" />
              <span>{t('collection.duplicate')}</span>
            </ContextMenuItem>
            <ContextMenuItem>
              <CopyButton
                text={handleCopyCurl()}
                label={t('collection.copyCurl')}
                size="xs"
                className="w-full"
              />
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => onRemoveNode(node.id)}>
              <Trash2Icon className="size-3" />
              <span>{t('collection.delete')}</span>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>

      {/* 递归渲染子节点 */}
      {isFolder && isExpanded && (
        <div>
          {(node as ApiFolderNode).children.map(child => (
            <ApiTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              renamingId={renamingId}
              onClearRenamingId={onClearRenamingId}
              onSelectRequest={onSelectRequest}
              onRemoveNode={onRemoveNode}
              onRenameNode={onRenameNode}
              onDuplicateRequest={onDuplicateRequest}
              onAddFolder={onAddFolder}
              onAddRequest={onAddRequest}
              onImportCurl={onImportCurl}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </ContextMenu>
  )
}
