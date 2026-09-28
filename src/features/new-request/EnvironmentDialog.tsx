// src/features/new-request/EnvironmentDialog.tsx

import { PencilIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { EnvController } from "@/hooks/useEnvironments";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { EnvStore, EnvVariable } from "@/types/env";
import { EnvVariablesEditor } from "./EnvVariablesEditor";

type Scope = { kind: "global" } | { kind: "env"; id: number };

interface EnvironmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: EnvController;
}

/** 深拷贝当前环境快照，作为弹窗内的本地草稿。 */
function cloneStore(controller: EnvController): EnvStore {
  return {
    environments: controller.environments.map((e) => ({
      ...e,
      variables: e.variables.map((v) => ({ ...v })),
    })),
    globalVariables: controller.globalVariables.map((v) => ({ ...v })),
    activeEnvId: controller.activeEnvId,
  };
}

export function EnvironmentDialog({ open, onOpenChange, controller }: EnvironmentDialogProps) {
  const { t } = useLocale();
  const [scope, setScope] = useState<Scope>({ kind: "global" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draft, setDraft] = useState<EnvStore | null>(null);
  const [saving, setSaving] = useState(false);
  const nextTempId = useRef(-1);

  // 打开时把当前快照拷贝进草稿；所有修改只写草稿，点保存才落库
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅在打开时拷贝一次快照
  useEffect(() => {
    if (open) {
      setDraft(cloneStore(controller));
      setScope(controller.activeEnvId != null ? { kind: "env", id: controller.activeEnvId } : { kind: "global" });
      setEditingId(null);
      setDraftName("");
    }
  }, [open]);

  const scopeVars: EnvVariable[] =
    draft == null
      ? []
      : scope.kind === "global"
        ? draft.globalVariables
        : (draft.environments.find((e) => e.id === scope.id)?.variables ?? []);

  const scopeTitle =
    scope.kind === "global" ? t("tab.envGlobal") : (draft?.environments.find((e) => e.id === scope.id)?.name ?? "");

  const handleVariablesChange = (vars: EnvVariable[]) => {
    setDraft((prev) => {
      if (prev == null) return prev;
      if (scope.kind === "global") {
        return { ...prev, globalVariables: vars };
      }
      return {
        ...prev,
        environments: prev.environments.map((e) => (e.id === scope.id ? { ...e, variables: vars } : e)),
      };
    });
  };

  const handleSelectEnv = (id: number) => {
    setScope({ kind: "env", id });
    setDraft((prev) => (prev == null ? prev : { ...prev, activeEnvId: id }));
  };

  const handleDeleteEnv = (id: number) => {
    setDraft((prev) => {
      if (prev == null) return prev;
      const environments = prev.environments.filter((e) => e.id !== id);
      let activeEnvId = prev.activeEnvId;
      if (activeEnvId === id) {
        activeEnvId = environments.length > 0 ? environments[0].id : null;
      }
      return { ...prev, environments, activeEnvId };
    });
    if (scope.kind === "env" && scope.id === id) {
      setScope({ kind: "global" });
    }
  };

  const handleNewEnv = () => {
    const id = nextTempId.current--;
    setDraft((prev) => {
      if (prev == null) return prev;
      return {
        ...prev,
        environments: [...prev.environments, { id, name: t("tab.envNewEnvName"), variables: [], protected: false }],
        activeEnvId: id,
      };
    });
    setScope({ kind: "env", id });
  };

  const startRename = (id: number, name: string) => {
    setEditingId(id);
    setDraftName(name);
  };

  const commitRename = () => {
    if (editingId != null && draftName.trim()) {
      const id = editingId;
      const name = draftName.trim();
      setDraft((prev) =>
        prev == null
          ? prev
          : {
              ...prev,
              environments: prev.environments.map((e) => (e.id === id ? { ...e, name } : e)),
            },
      );
    }
    setEditingId(null);
  };

  const handleSave = async () => {
    if (draft == null || saving) return;
    setSaving(true);
    try {
      await controller.saveStore(draft);
      onOpenChange(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (saving) return;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("tab.envManagement")}</DialogTitle>
        </DialogHeader>

        {draft == null ? null : (
          <>
            <div className="grid grid-cols-[200px_1fr] gap-4 h-[440px]">
              {/* 左栏 */}
              <div className="flex flex-col border-r border-border pr-3">
                {/* 上半：全局变量 */}
                <button
                  type="button"
                  onClick={() => setScope({ kind: "global" })}
                  className={cn(
                    "flex items-center rounded-md px-2 py-1.5 text-left text-prose-sm transition-colors",
                    scope.kind === "global"
                      ? "bg-surface-elevated text-foreground"
                      : "text-muted-foreground hover:bg-surface-elevated/50 hover:text-foreground",
                  )}
                >
                  {t("tab.envGlobal")}
                </button>

                <div className="my-2 border-t border-border/60" />

                {/* 下半：环境列表 */}
                <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-0.5">
                  {draft.environments.map((e) => {
                    const isActive = e.id === draft.activeEnvId;
                    const isSelected = scope.kind === "env" && scope.id === e.id;
                    const isEditing = editingId === e.id;
                    return (
                      <div
                        key={e.id}
                        onClick={() => handleSelectEnv(e.id)}
                        className={cn(
                          "group flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer transition-colors",
                          isSelected
                            ? "bg-surface-elevated text-foreground"
                            : "text-muted-foreground hover:bg-surface-elevated/50 hover:text-foreground",
                        )}
                      >
                        {isEditing ? (
                          <Input
                            autoFocus
                            value={draftName}
                            onChange={(ev) => setDraftName(ev.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") commitRename();
                              else if (ev.key === "Escape") setEditingId(null);
                            }}
                            onClick={(ev) => ev.stopPropagation()}
                            className="flex-1 h-6 min-w-0 px-1 text-prose-sm border-0 rounded-md bg-transparent focus-visible:ring-0 focus-visible:bg-surface-elevated/70"
                          />
                        ) : (
                          <span className="flex-1 min-w-0 truncate">{e.name || t("tab.envName")}</span>
                        )}
                        {isActive && (
                          <span className="shrink-0 text-ui-2xs text-accent-foreground">{t("tab.envCurrent")}</span>
                        )}
                        {!e.protected && (
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              startRename(e.id, e.name);
                            }}
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={t("tab.envRename")}
                          >
                            <PencilIcon className="size-3" />
                          </button>
                        )}
                        {!e.protected && (
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              handleDeleteEnv(e.id);
                            }}
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={t("tab.envDelete")}
                          >
                            <XIcon className="size-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 新建环境按钮 */}
                <Button variant="outline" size="sm" className="mt-2 w-full text-xs" onClick={handleNewEnv}>
                  + {t("tab.envNewEnv")}
                </Button>
              </div>

              {/* 右栏：变量编辑 */}
              <div className="min-w-0 flex flex-col">
                <div className="mb-1 px-2 text-ui-sm text-muted-foreground">{scopeTitle}</div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <EnvVariablesEditor entries={scopeVars} onChange={handleVariablesChange} />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCancel} disabled={saving}>
                {t("tab.envCancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? t("tab.envSaving") : t("tab.envSave")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
