// src/features/new-request/ApiTreeView.tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import type { ApiCollection, ApiRequestNode, ApiTreeNode } from '@/types/collection'
import { useLocale } from '@/hooks/useLocale'
import { ApiTreeItem } from './ApiTreeItem'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyTitle } from '@/components/core/Empty'

/** Find all ancestor IDs for a node in the tree. */
function findAncestorIds(collections: ApiCollection[], targetId: number): number[] {
  function walk(children: ApiTreeNode[], parents: number[]): number[] | null {
    for (const child of children) {
      if (child.id === targetId) return parents
      if (child.type === 'folder') {
        const result = walk(child.children, [...parents, child.id])
        if (result != null) return result
      }
    }
    return null
  }
  for (const col of collections) {
    if (col.id === targetId) return []
    const result = walk(col.children, [col.id])
    if (result != null) return result
  }
  return []
}

interface ApiTreeViewProps {
  collections: ApiCollection[]
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
  onRenameCollection: (collectionId: number, newName: string) => void
}

export function ApiTreeView({
  collections,
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
  onRenameCollection,
}: ApiTreeViewProps) {
  const { t } = useLocale()
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => {
    // 默认展开所有 Collection 根节点
    return new Set(collections.map(c => c.id))
  })
  const [forceExpandId, setForceExpandId] = useState<number | null>(null)
  const prevRenamingIdRef = useRef<number | null>(null)

  // 当 renamingId 从 null 变为有值时，force expand 其父节点
  useEffect(() => {
    if (renamingId != null && renamingId !== prevRenamingIdRef.current) {
      // 标记需要展开（等新建的节点ID在树中出现后自动展开其祖先）
      setForceExpandId(renamingId)
    }
    prevRenamingIdRef.current = renamingId
  }, [renamingId])

  // force expand: 当 forceExpandId 在树中存在时，展开所有祖先
  useEffect(() => {
    if (forceExpandId == null) return
    // 找到该节点所有祖先的 parent chain 并展开
    const ancestors = findAncestorIds(collections, forceExpandId)
    if (ancestors.length > 0) {
      setExpandedIds(prev => {
        const next = new Set(prev)
        for (const id of ancestors) next.add(id)
        return next
      })
    }
    setForceExpandId(null)
  }, [forceExpandId, collections])

  const handleToggleExpand = useCallback((nodeId: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  return (
    <ScrollArea className="flex-1 min-h-0 py-1">
      {collections.map(col => (
        <div key={col.id}>
          {/* Collection 根节点作为 folder 类型渲染 */}
          <ApiTreeItem
            node={{
              id: col.id,
              type: 'folder',
              name: col.name,
              children: col.children,
            }}
            depth={0}
            selectedId={selectedId}
            renamingId={renamingId}
            onClearRenamingId={onClearRenamingId}
            onSelectRequest={onSelectRequest}
            onRemoveNode={onRemoveNode}
            onRenameNode={(nodeId, newName) => {
              // 根节点重命名走 renameCollection
              if (nodeId === col.id) {
                onRenameCollection(col.id, newName)
              } else {
                onRenameNode(nodeId, newName)
              }
            }}
            onDuplicateRequest={onDuplicateRequest}
            onAddFolder={onAddFolder}
            onAddRequest={onAddRequest}
            onImportCurl={onImportCurl}
            expandedIds={expandedIds}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      ))}

      {/* 空状态 */}
      {collections.length === 0 && (
        <div className="px-4 py-6">
          <Empty><EmptyTitle>{t('collection.emptyTree')}</EmptyTitle></Empty>
        </div>
      )}
    </ScrollArea>
  )
}
