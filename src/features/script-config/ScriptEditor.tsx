import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import CodeEditor from "@/components/code-editor/CodeEditor";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/hooks/useLocale";
import { METHOD_BG_COLORS } from "@/lib/http-constants";
import type { ScriptTab } from "@/types/view";

interface Props {
  tab: ScriptTab;
  /** 'floating' = overlay mode; 'tab' = embedded in TitleBar tab */
  mode: "floating" | "tab";
  onUpdateDraft: (content: string) => void;
  onSaved: (fileKey: string, savedTab: ScriptTab) => void;
  /** Floating mode: close (← arrow) */
  onClose?: () => void;
  /** Floating mode: maximize into tab */
  onMaximize?: () => void;
  /** Tab mode: restore back to floating */
  onRestore?: () => void;
  /** Method change */
  onMethodChange?: (method: string) => void;
  onDomainChange?: (domain: string) => void;
  /** Name / label change (double-click to edit) */
  onNameChange?: (name: string) => void;
}

const METHOD_ANY = "ANY";
const METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export default function ScriptEditor({
  tab,
  mode,
  onUpdateDraft,
  onSaved,
  onClose,
  onMaximize,
  onRestore,
  onMethodChange,
  onDomainChange,
}: Props) {
  const { t } = useLocale();
  const [content, setContent] = useState(tab.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirtyRef = useRef(tab.dirty);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on fileKey intentionally
  useEffect(() => {
    setContent(tab.content);
    dirtyRef.current = tab.dirty;
  }, [tab.fileKey]);

  function handleChange(v: string) {
    setContent(v);
    dirtyRef.current = true;
    onUpdateDraft(v);
  }

  const handleSave = useCallback(async () => {
    if (!dirtyRef.current) return;
    setSaving(true);
    setError("");
    try {
      const scriptName = tab.label.trim();
      if (!scriptName) {
        throw new Error(t("scriptConfig.nameRequired"));
      }
      // 通过 save_script_config 写入配置后再保存内容
      // 先加载当前配置
      const existing = await invoke<{
        enabled: boolean;
        scripts: { name: string; file_name: string; method: string; domain: string; enabled: boolean }[];
      }>("get_script_config").catch(() => ({
        enabled: true,
        scripts: [] as { name: string; file_name: string; method: string; domain: string; enabled: boolean }[],
      }));
      // 找到或创建同名项
      const scripts = [...existing.scripts];
      const idx = scripts.findIndex((s) => s.name.toLowerCase() === scriptName.toLowerCase());
      const entry =
        idx >= 0
          ? { ...scripts[idx], name: scriptName, method: tab.method, domain: tab.domain, enabled: true }
          : { name: scriptName, method: tab.method, domain: tab.domain, enabled: true, file_name: "" };
      if (idx >= 0) {
        scripts[idx] = entry;
      } else {
        scripts.push(entry);
      }
      await invoke("save_script_config", { script: { enabled: true, scripts } });
      // 重新加载以获取生成的 file_name
      const updated = await invoke<{ scripts: { name: string; file_name: string }[] }>("get_script_config");
      const saved = updated.scripts.find((s) => s.name.toLowerCase() === scriptName.toLowerCase());
      if (!saved?.file_name) {
        throw new Error("Failed to get generated file_name after saving config");
      }
      // 保存内容
      await invoke("save_script_content", { fileName: saved.file_name, content });
      dirtyRef.current = false;
      onSaved(tab.fileKey, {
        fileKey: saved.file_name,
        label: scriptName,
        content,
        method: tab.method,
        domain: tab.domain,
        dirty: false,
        saved: true,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [tab, content, t, onSaved]);

  // Ctrl+S / Cmd+S：只订阅一次，通过 ref 读取最新 handleSave，
  // 避免 content 每敲一个字符都触发重新订阅
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-surface-deep">
      {/* Toolbar: mode-specific buttons + save */}
      <div className="flex shrink-0 items-center justify-between border-b border-surface-elevated px-4 py-2">
        <div className="flex items-center gap-3">
          {mode === "floating" ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onRestore}
              className="inline-flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              <Minimize2 className="size-4" />
            </button>
          )}
          <span className="text-sm font-medium">{tab.label}</span>
          <Select
            value={tab.method || METHOD_ANY}
            onValueChange={(v) => onMethodChange?.(v === METHOD_ANY ? "" : String(v))}
          >
            <SelectTrigger
              className="h-6 w-18 gap-1 rounded-sm border-transparent px-1.5 py-0 text-xs font-medium transition-colors data-[size=default]:h-6 hover:border-input/60 focus-visible:ring-1 dark:bg-transparent dark:hover:bg-transparent"
              style={!tab.method ? undefined : { color: (METHOD_BG_COLORS as Record<string, string>)[tab.method] }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              alignItemWithTrigger={false}
              className="max-h-56 min-w-24 overflow-y-auto [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:text-xs"
            >
              <SelectItem value={METHOD_ANY}>Any</SelectItem>
              {METHOD_OPTIONS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-6 w-36 rounded-sm border-transparent px-1.5 text-xs font-mono transition-colors hover:border-input/60 focus-visible:ring-1 dark:bg-transparent"
            placeholder="domain"
            value={tab.domain}
            onChange={(e) => onDomainChange?.(e.target.value)}
          />
          {tab.dirty && <span className="text-ui-xs text-muted-foreground">● 未保存</span>}
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-destructive">{error}</span>}
          {mode === "floating" && (
            <button
              type="button"
              onClick={onMaximize}
              className="inline-flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              <Maximize2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            disabled={saving || !tab.dirty}
            onClick={handleSave}
            className="inline-flex items-center rounded-md bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <CodeEditor value={content} language="javascript" onChange={handleChange} />
      </div>
    </div>
  );
}
