import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  addDays,
  getCalendarDays,
  isSameDay,
  isSameMonth,
  monthOf,
  parseDate,
  toDateString,
  todayString,
} from "./date";

interface CalendarProps {
  /** 展示月（取当月 1 号） */
  month: Date;
  onMonthChange: (month: Date) => void;
  /** 草稿起止（YYYY-MM-DD），用于高亮 */
  start: string;
  end: string;
  onSelectDay: (day: string) => void;
  locale: string;
}

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

function stepDate(current: Date, key: string): Date {
  switch (key) {
    case "ArrowLeft":
      return addDays(current, -1);
    case "ArrowRight":
      return addDays(current, 1);
    case "ArrowUp":
      return addDays(current, -7);
    case "ArrowDown":
      return addDays(current, 7);
    case "Home":
      return new Date(current.getFullYear(), current.getMonth(), 1);
    case "End":
      return new Date(current.getFullYear(), current.getMonth() + 1, 0);
    default:
      return current;
  }
}

export function Calendar({ month, onMonthChange, start, end, onSelectDay, locale }: CalendarProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(() => start || todayString());
  const gridRef = useRef<HTMLTableElement>(null);

  const today = new Date();
  const days = useMemo(() => getCalendarDays(month), [month]);
  const rows = useMemo(() => Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7)), [days]);
  const daySet = useMemo(() => new Set(days.map(toDateString)), [days]);

  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => ({
        id: i,
        label: new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2024, 0, 7 + i)),
      })),
    [locale],
  );

  // 聚焦某天：更新 tabbable 目标，并在渲染后把焦点真正移过去
  const focusDay = (ds: string) => {
    setFocused(ds);
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${ds}"]`)?.focus();
    });
  };

  const goToMonth = (nextMonth: Date) => {
    onMonthChange(nextMonth);
    const anchor = parseDate(start);
    focusDay(anchor && isSameMonth(anchor, nextMonth) ? start : toDateString(nextMonth));
  };

  const onGridKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (!NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    const cur = parseDate(focused);
    if (!cur) return;
    const next = stepDate(cur, e.key);
    const ds = toDateString(next);
    if (!isSameMonth(next, month)) onMonthChange(monthOf(next));
    focusDay(ds);
  };

  const rangeValid = start !== "" && end !== "" && start <= end;
  // 确保有且仅有一个 tabbable 日期，且落在当前网格内
  const tabbable = daySet.has(focused) ? focused : daySet.has(start) ? start : toDateString(month);

  return (
    <div className="rounded-lg border border-border/60 bg-surface-deep/40 p-2">
      {/* 月份导航 */}
      <div className="flex items-center gap-1 mb-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("aiUsage.prevMonth")}
          onClick={() => goToMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="flex-1 text-center text-ui-sm font-medium text-foreground">
          {month.toLocaleDateString(locale, { year: "numeric", month: "long" })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-ui-xs"
          onClick={() => goToMonth(monthOf(new Date()))}
        >
          {t("aiUsage.today")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("aiUsage.nextMonth")}
          onClick={() => goToMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <ChevronRightIcon />
        </Button>
      </div>

      <table
        ref={gridRef}
        aria-label={month.toLocaleDateString(locale, { year: "numeric", month: "long" })}
        className="w-full border-collapse"
        onKeyDown={onGridKeyDown}
      >
        <thead>
          <tr>
            {weekdayLabels.map(({ id, label }) => (
              <th key={id} scope="col" className="p-0 pb-1 text-center text-ui-2xs font-normal text-muted-foreground">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={toDateString(row[0])}>
              {row.map((day) => {
                const ds = toDateString(day);
                const isCurrentMonth = day.getMonth() === month.getMonth();
                const isToday = isSameDay(day, today);
                const isStart = ds === start;
                const isEnd = ds === end;
                const inRange = rangeValid && ds >= start && ds <= end;
                const isEndpoint = isStart || isEnd;
                return (
                  <td key={ds} className="p-0 text-center">
                    <button
                      type="button"
                      data-date={ds}
                      tabIndex={ds === tabbable ? 0 : -1}
                      aria-pressed={isEndpoint}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={day.toLocaleDateString(locale)}
                      className={cn(
                        "h-7 w-full rounded text-ui-md tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        !isCurrentMonth && "text-muted-foreground/35",
                        isCurrentMonth && !inRange && "text-foreground hover:bg-muted",
                        inRange && !isEndpoint && "bg-violet-500/10 text-violet-500 dark:text-violet-400",
                        isEndpoint && "bg-primary text-primary-foreground font-medium",
                        isToday && !isEndpoint && "ring-1 ring-inset ring-ring/60",
                      )}
                      onClick={() => {
                        setFocused(ds);
                        onSelectDay(ds);
                      }}
                    >
                      {day.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
