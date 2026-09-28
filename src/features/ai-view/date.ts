export interface DateRange {
  /** 本地时区 YYYY-MM-DD（含起止当天） */
  start: string;
  end: string;
}

export type RangePreset = "today" | "7d" | "month" | "year";

/** 按预设返回本地时区起止日期（含起止当天） */
export function resolvePreset(preset: RangePreset): DateRange {
  const now = new Date();
  if (preset === "today") {
    const s = toDateString(now);
    return { start: s, end: s };
  }
  if (preset === "7d") {
    return {
      start: toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)),
      end: toDateString(now),
    };
  }
  if (preset === "month") {
    return {
      start: toDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: toDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  return {
    start: toDateString(new Date(now.getFullYear(), 0, 1)),
    end: toDateString(new Date(now.getFullYear(), 11, 31)),
  };
}

/** 解析 YYYY-MM-DD 为本地时区当日 0 点；非法/不存在日期返回 null */
export function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const date = new Date(y, mo, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  return date;
}

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayString(): string {
  return toDateString(new Date());
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** 以 month 所在月为基准，返回周日起始的 6×7=42 天（扁平数组） */
export function getCalendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export function monthOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
