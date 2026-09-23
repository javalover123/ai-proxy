import { CheckIcon, XIcon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** 「测试」按钮文案 */
  runLabel: string;
  onRun: () => void;
  /** null = 尚未测试或结果已失效；true/false = 是否有已启用规则命中 */
  hit: boolean | null;
  /** ✓/✗ 图标的悬浮提示（如「命中 2 条」） */
  title?: string;
}

/**
 * 配置弹窗列表底部的「匹配测试」行：输入 URL 后点「测试」（或回车），
 * 由父级配合 useMatchTest 高亮命中的规则行。纯展示组件，不含请求逻辑。
 */
export function MatchTestRow({ value, onChange, placeholder, runLabel, onRun, hit, title }: Props) {
  return (
    <div className="sticky bottom-0 z-10 flex h-8 items-center gap-2 border-t border-border bg-[color-mix(in_oklab,var(--popover),var(--foreground)_3%)] px-3">
      <ZapIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <Input
        className="h-6 flex-1 rounded-sm border-transparent px-1.5 font-mono text-xs md:text-xs transition-colors hover:border-input/60 focus-visible:ring-1 dark:bg-transparent"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onRun();
        }}
        placeholder={placeholder}
        spellCheck={false}
      />
      {hit !== null && title ? (
        <Tooltip>
          <TooltipTrigger className="shrink-0 inline-flex">
            <span>
              {hit ? (
                <CheckIcon className="size-3.5" style={{ color: "var(--badge-success)" }} />
              ) : (
                <XIcon className="size-3.5 text-muted-foreground" />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="bg-popover text-popover-foreground text-ui-sm">
            {title}
          </TooltipContent>
        </Tooltip>
      ) : hit !== null ? (
        <span className="shrink-0">
          {hit ? (
            <CheckIcon className="size-3.5" style={{ color: "var(--badge-success)" }} />
          ) : (
            <XIcon className="size-3.5 text-muted-foreground" />
          )}
        </span>
      ) : null}
      <Button variant="ghost" size="xs" className="shrink-0" disabled={value.trim() === ""} onClick={onRun}>
        {runLabel}
      </Button>
    </div>
  );
}
