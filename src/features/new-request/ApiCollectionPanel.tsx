// src/features/new-request/ApiCollectionPanel.tsx

import { RefreshCwIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { ApiCollection, ApiRequestNode } from "@/types/collection";
import { ApiTreeView } from "./ApiTreeView";

interface ApiCollectionPanelProps {
  collections: ApiCollection[];
  selectedId: number | null;
  renamingId: number | null;
  onClearRenamingId: () => void;
  onSelectRequest: (node: ApiRequestNode) => void;
  addFolder: (parentId: number) => void;
  addRequest: (parentId: number) => void;
  removeNode: (nodeId: number) => void;
  renameNode: (nodeId: number, newName: string) => void;
  duplicateRequest: (nodeId: number) => void;
  onImportCurl?: (parentId: number) => void;
  renameCollection: (collectionId: number, newName: string) => void;
  onRefresh: () => void;
}

export function ApiCollectionPanel({
  collections,
  selectedId,
  renamingId,
  onClearRenamingId,
  onSelectRequest,
  addFolder,
  addRequest,
  removeNode,
  renameNode,
  duplicateRequest,
  onImportCurl,
  renameCollection,
  onRefresh,
}: ApiCollectionPanelProps) {
  const { t } = useLocale();
  const [spinning, setSpinning] = useState(false);

  const handleRefresh = useCallback(() => {
    setSpinning(true);
    onRefresh();
    setTimeout(() => setSpinning(false), 600);
  }, [onRefresh]);

  return (
    <div className="flex h-full flex-col bg-surface-base/30">
      {/* 标题栏 */}
      <div className="flex items-center px-3 py-2">
        <span className="text-ui-xs font-bold uppercase tracking-wider text-muted-foreground flex-1">
          {t("collection.title")}
        </span>
        <button
          onClick={handleRefresh}
          className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <RefreshCwIcon className={cn("size-3.5", spinning && "animate-spin")} />
        </button>
      </div>

      <Separator />

      {/* 树形菜单 */}
      <ApiTreeView
        collections={collections}
        selectedId={selectedId}
        renamingId={renamingId}
        onClearRenamingId={onClearRenamingId}
        onSelectRequest={onSelectRequest}
        onRemoveNode={removeNode}
        onRenameNode={renameNode}
        onDuplicateRequest={duplicateRequest}
        onAddFolder={addFolder}
        onAddRequest={addRequest}
        onImportCurl={onImportCurl}
        onRenameCollection={renameCollection}
      />
    </div>
  );
}
