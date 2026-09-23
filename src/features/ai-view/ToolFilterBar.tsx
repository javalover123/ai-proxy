import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface ToolFilterItem {
  toolName: string;
  count: number;
}

/*
  三种展示模式：
  - 'all'        : 全部气泡（默认）
  - 'no_tools'   : 纯对话，隐藏所有工具调用
  - 工具名集合    : 展示选中工具的 ToolCallCard（多选）

  mode 字段统一为 'all' | 'no_tools' | Set<string>。
  对外接口简化为：active mode + selectedTools（set）。
*/

interface ToolFilterBarProps {
  items: ToolFilterItem[];
  /** 'all' | 'no_tools' | Set<string> */
  selectedTools: Set<string>;
  isNoTools: boolean;
  onToggleAll: () => void;
  onToggleNoTools: () => void;
  onToggleTool: (toolName: string) => void;
}

export function ToolFilterBar({
  items,
  selectedTools,
  isNoTools,
  onToggleAll,
  onToggleNoTools,
  onToggleTool,
}: ToolFilterBarProps) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  const isAll = !isNoTools && selectedTools.size === 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-background">
      {/* 全部 */}
      <button
        type="button"
        className={cn(
          "inline-flex items-center px-2.5 py-1 rounded-full text-ui-xs font-medium whitespace-nowrap transition-colors",
          isAll ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/80",
        )}
        onClick={onToggleAll}
      >
        {t("aiView.toolFilterAll", "全部")}
      </button>

      {/* 纯对话 */}
      <button
        type="button"
        className={cn(
          "inline-flex items-center px-2.5 py-1 rounded-full text-ui-xs font-medium whitespace-nowrap transition-colors",
          isNoTools ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/80",
        )}
        onClick={onToggleNoTools}
      >
        {t("aiView.toolFilterNoTools", "纯对话")}
      </button>

      {/* 各工具 pill（多选 toggle） */}
      {items.map((item) => {
        const active = selectedTools.has(item.toolName);
        return (
          <button
            key={item.toolName}
            type="button"
            className={cn(
              "inline-flex items-center px-2.5 py-1 rounded-full text-ui-xs font-medium whitespace-nowrap transition-colors",
              active ? "bg-amber-500 text-white" : "bg-muted text-foreground hover:bg-muted/80",
            )}
            onClick={() => onToggleTool(item.toolName)}
          >
            {item.toolName}
            <span className={cn("ml-1 text-ui-2xs", active ? "opacity-80" : "opacity-50")}>×{item.count}</span>
          </button>
        );
      })}
    </div>
  );
}
