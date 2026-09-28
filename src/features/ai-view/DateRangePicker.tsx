import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { CalendarDaysIcon, ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Calendar } from "./Calendar";
import { type DateRange, monthOf, parseDate, type RangePreset, resolvePreset, todayString } from "./date";

const PRESETS: { value: RangePreset; label: string; translate?: boolean }[] = [
  { value: "today", label: "aiUsage.periodToday", translate: true },
  { value: "7d", label: "7d" },
  { value: "month", label: "aiUsage.periodMonth", translate: true },
  { value: "year", label: "aiUsage.periodYear", translate: true },
];

type Field = "start" | "end";

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(value.start);
  const [draftEnd, setDraftEnd] = useState(value.end);
  const [activeField, setActiveField] = useState<Field>("start");
  const [displayMonth, setDisplayMonth] = useState(() => monthOf(parseDate(value.start) ?? new Date()));
  const [error, setError] = useState<string | null>(null);

  const locale = i18n.language?.startsWith("zh") ? "zh-CN" : "en-US";

  // 当前值若正好等于某预设区间，则高亮该预设
  const activePreset = useMemo(() => {
    for (const p of PRESETS) {
      const r = resolvePreset(p.value);
      if (r.start === value.start && r.end === value.end) return p.value;
    }
    return null;
  }, [value]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // 打开时以当前已提交值重置草稿
      const start = value.start || todayString();
      const end = value.end || todayString();
      setDraftStart(start);
      setDraftEnd(end);
      setActiveField("start");
      setDisplayMonth(monthOf(parseDate(start) ?? new Date()));
      setError(null);
    }
    setOpen(next);
  };

  const pickDay = (ds: string) => {
    setError(null);
    if (activeField === "start") {
      setDraftStart(ds);
      if (ds > draftEnd) setDraftEnd(ds);
      setActiveField("end");
    } else if (ds < draftStart) {
      setDraftStart(ds);
      setActiveField("end");
    } else {
      setDraftEnd(ds);
    }
    const d = parseDate(ds);
    if (d && (d.getFullYear() !== displayMonth.getFullYear() || d.getMonth() !== displayMonth.getMonth())) {
      setDisplayMonth(monthOf(d));
    }
  };

  const apply = () => {
    if (!draftStart || !draftEnd) {
      setError(t("aiUsage.customHint"));
      return;
    }
    if (draftStart > draftEnd) {
      setError(t("aiUsage.invalidRange"));
      return;
    }
    onChange({ start: draftStart, end: draftEnd });
    setOpen(false);
  };

  const renderField = (field: Field) => {
    const isActive = activeField === field;
    const ts = field === "start" ? draftStart : draftEnd;
    const setTs = field === "start" ? setDraftStart : setDraftEnd;
    const label = field === "start" ? t("aiUsage.startTime") : t("aiUsage.endTime");
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-2.5 py-1 cursor-pointer transition-colors",
          isActive ? "border-ring/60 bg-surface-elevated" : "border-border/60 hover:border-border",
        )}
        onClick={() => setActiveField(field)}
      >
        <span className="shrink-0 text-ui-xs text-muted-foreground">{label}</span>
        <Input
          type="date"
          className="h-7 flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 text-prose-sm"
          value={ts}
          onChange={(e) => {
            const v = e.target.value;
            setTs(v);
            const d = parseDate(v);
            if (d) setDisplayMonth(monthOf(d));
            setError(null);
          }}
          onFocus={() => setActiveField(field)}
        />
      </div>
    );
  };

  const label = value.start && value.end ? `${value.start} — ${value.end}` : t("aiUsage.customHint");

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-8 w-full justify-start gap-1.5 px-2.5 text-ui-md font-normal text-foreground"
          />
        }
      >
        <CalendarDaysIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-left font-mono tabular-nums">{label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner className="isolate z-50 outline-none" side="bottom" sideOffset={6} align="end">
          <PopoverPrimitive.Popup
            data-slot="date-range-picker"
            className="w-[320px] rounded-xl bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <div className="space-y-2">
              {/* 快捷预设 */}
              <div className="flex flex-wrap gap-1.5 border-b border-border/40 pb-2">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    size="sm"
                    variant={activePreset === preset.value ? "default" : "outline"}
                    className="h-7 px-2.5 text-ui-md"
                    onClick={() => {
                      onChange(resolvePreset(preset.value));
                      setOpen(false);
                    }}
                  >
                    {preset.translate ? t(preset.label) : preset.label}
                  </Button>
                ))}
              </div>

              {renderField("start")}
              {renderField("end")}

              <Calendar
                month={displayMonth}
                onMonthChange={setDisplayMonth}
                start={draftStart}
                end={draftEnd}
                onSelectDay={pickDay}
                locale={locale}
              />

              {error && <p className="text-ui-sm text-destructive">{error}</p>}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="button" size="sm" className="flex-1" onClick={apply}>
                  {t("common.confirm")}
                </Button>
              </div>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
