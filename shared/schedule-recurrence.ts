export type RecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";
export type RecurrenceEndMode = "count" | "until" | "never";

export interface ScheduleRecurrenceRule {
  first_start_at: string;
  first_end_at: string;
  recurrence_frequency: RecurrenceFrequency;
  recurrence_interval: number;
  weekdays: number[];
  end_mode: RecurrenceEndMode;
  occurrence_count: number | null;
  until_at: string | null;
}

export interface ScheduleOccurrence {
  index: number;
  start_at: string;
  end_at: string;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

function localParts(ms: number): LocalParts {
  const date = new Date(ms + KST_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    weekday: date.getUTCDay(),
  };
}

function localMs(parts: Omit<LocalParts, "weekday">): number {
  return Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second) - KST_OFFSET_MS;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addLocalDays(base: LocalParts, days: number): number {
  const marker = new Date(Date.UTC(base.year, base.month, base.day + days));
  return localMs({
    year: marker.getUTCFullYear(), month: marker.getUTCMonth(), day: marker.getUTCDate(),
    hour: base.hour, minute: base.minute, second: base.second,
  });
}

function addLocalMonths(base: LocalParts, months: number): number {
  const marker = new Date(Date.UTC(base.year, base.month + months, 1));
  const year = marker.getUTCFullYear();
  const month = marker.getUTCMonth();
  const day = Math.min(base.day, daysInMonth(year, month));
  return localMs({ year, month, day, hour: base.hour, minute: base.minute, second: base.second });
}

function validateRule(rule: ScheduleRecurrenceRule) {
  const start = new Date(rule.first_start_at).valueOf();
  const end = new Date(rule.first_end_at).valueOf();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("반복 일정의 시작/종료 시간을 확인해 주세요.");
  if (!Number.isInteger(rule.recurrence_interval) || rule.recurrence_interval < 1 || rule.recurrence_interval > 31) throw new Error("반복 간격을 확인해 주세요.");
  if (!["none", "daily", "weekly", "monthly"].includes(rule.recurrence_frequency)) throw new Error("반복 주기를 확인해 주세요.");
  if (rule.recurrence_frequency === "weekly") {
    const unique = new Set(rule.weekdays);
    if (unique.size < 1 || unique.size > 7 || [...unique].some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("반복 요일을 확인해 주세요.");
  } else if (rule.weekdays.length !== 0) throw new Error("주간 반복이 아닐 때는 요일을 지정할 수 없습니다.");
  if (rule.end_mode === "count" && (!Number.isInteger(rule.occurrence_count) || (rule.occurrence_count ?? 0) < 1 || (rule.occurrence_count ?? 0) > 500)) throw new Error("반복 횟수를 확인해 주세요.");
  if (rule.end_mode === "until" && !Number.isFinite(new Date(rule.until_at ?? "").valueOf())) throw new Error("반복 종료일을 확인해 주세요.");
  if (rule.recurrence_frequency === "none" && (rule.end_mode !== "count" || rule.occurrence_count !== 1)) throw new Error("반복 없음 일정은 1회 일정이어야 합니다.");
}

export function generateScheduleOccurrences(
  rule: ScheduleRecurrenceRule,
  options: { horizon_at?: string; max_occurrences?: number } = {},
): ScheduleOccurrence[] {
  validateRule(rule);
  const firstStart = new Date(rule.first_start_at).valueOf();
  const firstEnd = new Date(rule.first_end_at).valueOf();
  const duration = firstEnd - firstStart;
  const firstLocal = localParts(firstStart);
  const maxOccurrences = Math.min(Math.max(options.max_occurrences ?? 500, 1), 5000);
  const horizon = rule.end_mode === "never"
    ? new Date(options.horizon_at ?? new Date(Date.now() + 180 * DAY_MS).toISOString()).valueOf()
    : Number.POSITIVE_INFINITY;
  const until = rule.end_mode === "until" ? new Date(rule.until_at!).valueOf() : Number.POSITIVE_INFINITY;
  const countLimit = rule.end_mode === "count" ? rule.occurrence_count! : Number.POSITIVE_INFINITY;
  const result: ScheduleOccurrence[] = [];

  const accept = (candidate: number): boolean => {
    if (candidate < firstStart || candidate > until || candidate > horizon) return false;
    if (result.length >= countLimit || result.length >= maxOccurrences) return false;
    result.push({ index: result.length, start_at: new Date(candidate).toISOString(), end_at: new Date(candidate + duration).toISOString() });
    return true;
  };

  if (rule.recurrence_frequency === "none") {
    accept(firstStart);
    return result;
  }

  if (rule.recurrence_frequency === "daily") {
    for (let step = 0; step < maxOccurrences * rule.recurrence_interval + 2; step += rule.recurrence_interval) {
      const candidate = addLocalDays(firstLocal, step);
      if (candidate > until || candidate > horizon || result.length >= countLimit) break;
      accept(candidate);
    }
    return result;
  }

  if (rule.recurrence_frequency === "monthly") {
    for (let step = 0; step < maxOccurrences * rule.recurrence_interval + 2; step += rule.recurrence_interval) {
      const candidate = addLocalMonths(firstLocal, step);
      if (candidate > until || candidate > horizon || result.length >= countLimit) break;
      accept(candidate);
    }
    return result;
  }

  const selected = new Set(rule.weekdays);
  const anchorDate = Date.UTC(firstLocal.year, firstLocal.month, firstLocal.day);
  const anchorWeekStart = anchorDate - firstLocal.weekday * DAY_MS;
  for (let dayOffset = 0; dayOffset < maxOccurrences * 7 * rule.recurrence_interval + 14; dayOffset += 1) {
    const candidate = addLocalDays(firstLocal, dayOffset);
    if (candidate > until || candidate > horizon || result.length >= countLimit || result.length >= maxOccurrences) break;
    const parts = localParts(candidate);
    if (!selected.has(parts.weekday)) continue;
    const localDate = Date.UTC(parts.year, parts.month, parts.day);
    const weekIndex = Math.floor((localDate - anchorWeekStart) / (7 * DAY_MS));
    if (weekIndex < 0 || weekIndex % rule.recurrence_interval !== 0) continue;
    accept(candidate);
  }
  return result;
}
