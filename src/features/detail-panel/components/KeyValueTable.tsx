import { useCallback, useRef, useState } from "react";
import { CopyButton } from "@/components/core/CopyButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const MIN_KEY_RATIO = 0.15;
const MAX_KEY_RATIO = 0.7;

export default function KeyValueTable({ data, emptyLabel }: { data: Record<string, string>; emptyLabel: string }) {
  const entries = Object.entries(data);
  const [keyRatio, setKeyRatio] = useState(0.35);
  const [dragging, setDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const liveKeyRatio = useRef(keyRatio);

  if (!dragging) liveKeyRatio.current = keyRatio;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = Math.max(MIN_KEY_RATIO, Math.min(MAX_KEY_RATIO, (e.clientX - rect.left) / rect.width));
      liveKeyRatio.current = ratio;
      const pct = `${ratio * 100}%`;
      const cols = containerRef.current.querySelectorAll("col");
      if (cols[0]) (cols[0] as HTMLTableColElement).style.width = pct;
      if (cols[1]) (cols[1] as HTMLTableColElement).style.width = `${(1 - ratio) * 100}%`;
      if (handleRef.current) handleRef.current.style.left = pct;
    },
    [dragging],
  );

  const onPointerUp = useCallback(() => {
    setKeyRatio(liveKeyRatio.current);
    setDragging(false);
  }, []);

  const keyPct = `${liveKeyRatio.current * 100}%`;
  const valPct = `${(1 - liveKeyRatio.current) * 100}%`;

  return (
    <div className="relative" ref={containerRef}>
      <div className={dragging ? "cursor-col-resize select-none" : ""}>
        <Table className="table-fixed text-prose-md">
          <colgroup>
            <col style={{ width: keyPct }} />
            <col style={{ width: valPct }} />
          </colgroup>
          <TableHeader>
            <TableRow className="border-b border-surface-elevated bg-surface-elevated/30 text-ui-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <TableHead className="py-1.5 pl-3 pr-2 h-auto text-left font-semibold text-ui-xs overflow-hidden">
                Key
              </TableHead>
              <TableHead className="py-1.5 pr-3 h-auto text-left font-semibold text-ui-xs">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-4 text-center text-muted-foreground">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              entries.map(([key, value]) => <KeyValueRow key={key} entryKey={key} value={value} />)
            )}
          </TableBody>
        </Table>
      </div>

      {/* Full-height drag handle overlay (only when there are entries to resize) */}
      {entries.length > 0 && (
        <div
          ref={handleRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="group/handle absolute top-0 bottom-0 z-10 cursor-col-resize"
          style={{ left: keyPct, width: 5, transform: "translateX(-2.5px)" }}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-surface-elevated group-hover/handle:bg-primary/50 transition-colors" />
        </div>
      )}
    </div>
  );
}

function KeyValueRow({ entryKey, value }: { entryKey: string; value: string }) {
  return (
    <TableRow className="border-b border-surface-elevated/30 group hover:bg-surface-elevated/20 transition-colors">
      <TableCell className="py-1.5 pl-3 pr-2 align-top font-mono text-prose-md text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
        {entryKey}
      </TableCell>
      <TableCell className="py-1.5 pr-2 align-top text-foreground/80 text-prose-xl relative max-w-0">
        <Tooltip>
          <TooltipTrigger className="block w-full cursor-pointer text-left min-w-0">
            <span className="line-clamp-2 break-all">{value}</span>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="max-w-[420px] bg-popover text-popover-foreground text-ui-sm"
          >
            <div className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all font-mono text-ui-sm">
              {value}
            </div>
          </TooltipContent>
        </Tooltip>
        <span className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-all">
          <CopyButton
            text={value}
            size="xs"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50"
          />
        </span>
      </TableCell>
    </TableRow>
  );
}
