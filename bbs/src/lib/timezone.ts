export interface ResolvedRange {
  from: Date;
  to: Date;
  label: string;
}

export type ResolveRangeResult = ResolvedRange | { error: "invalid_range" };

/**
 * Get the calendar Y/M/D of a Date as seen in a specific timezone.
 */
function getCalendarDate(date: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Given a calendar date (year/month/day) in a timezone, return the UTC Date
 * corresponding to that date's 00:00:00 local wall-clock time.
 * Works across DST boundaries by iteratively correcting the offset.
 */
function utcFromLocalMidnight(
  year: number,
  month: number,
  day: number,
  tz: string
): Date {
  // Start with a naive guess: UTC midnight of the same Y/M/D.
  let guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  // Correct: find what wall-clock time this guess actually represents in the TZ,
  // and shift by the difference.
  for (let i = 0; i < 3; i++) {
    const cal = getCalendarDate(guess, tz);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(guess);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    // Compute exact day difference using Date.UTC to avoid cross-month/year formula errors
    const dayDiff =
      (Date.UTC(cal.year, cal.month - 1, cal.day) - Date.UTC(year, month - 1, day)) /
      86_400_000;
    const shiftMinutes = dayDiff * 24 * 60 + hour * 60 + minute;
    if (shiftMinutes === 0) break;
    guess = new Date(guess.getTime() - shiftMinutes * 60_000);
  }
  return guess;
}

function addDays(d: Date, days: number, tz: string): Date {
  const cal = getCalendarDate(d, tz);
  return utcFromLocalMidnight(cal.year, cal.month, cal.day + days, tz);
}

function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYmd(s: string): { year: number; month: number; day: number } | null {
  if (!isValidDateString(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: y, month: m, day: d };
}

const PRESETS = new Set([
  "today",
  "yesterday",
  "last-7d",
  "last-30d",
  "this-month",
  "last-month",
  "this-year",
  "all-time",
  "custom"
]);

const LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "last-7d": "Last 7 days",
  "last-30d": "Last 30 days",
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "all-time": "All time"
};

export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  tz: string,
  now: Date = new Date()
): ResolveRangeResult {
  const range = params.range && PRESETS.has(params.range) ? params.range : "last-30d";

  if (range === "custom") {
    const fromParsed = params.from ? parseYmd(params.from) : null;
    const toParsed = params.to ? parseYmd(params.to) : null;
    if (!fromParsed || !toParsed) return { error: "invalid_range" };
    const from = utcFromLocalMidnight(fromParsed.year, fromParsed.month, fromParsed.day, tz);
    // 'to' is inclusive: end of the day = start of next day
    const to = utcFromLocalMidnight(toParsed.year, toParsed.month, toParsed.day + 1, tz);
    if (from.getTime() > to.getTime()) return { error: "invalid_range" };
    return { from, to, label: `${params.from} – ${params.to}` };
  }

  const todayCal = getCalendarDate(now, tz);
  const todayStart = utcFromLocalMidnight(todayCal.year, todayCal.month, todayCal.day, tz);
  const tomorrowStart = addDays(todayStart, 1, tz);

  switch (range) {
    case "today":
      return { from: todayStart, to: tomorrowStart, label: LABELS.today };
    case "yesterday": {
      const yesterday = addDays(todayStart, -1, tz);
      return { from: yesterday, to: todayStart, label: LABELS.yesterday };
    }
    case "last-7d": {
      const from = addDays(todayStart, -6, tz);
      return { from, to: tomorrowStart, label: LABELS["last-7d"] };
    }
    case "last-30d": {
      const from = addDays(todayStart, -29, tz);
      return { from, to: tomorrowStart, label: LABELS["last-30d"] };
    }
    case "this-month": {
      const from = utcFromLocalMidnight(todayCal.year, todayCal.month, 1, tz);
      const to = utcFromLocalMidnight(todayCal.year, todayCal.month + 1, 1, tz);
      return { from, to, label: LABELS["this-month"] };
    }
    case "last-month": {
      const from = utcFromLocalMidnight(todayCal.year, todayCal.month - 1, 1, tz);
      const to = utcFromLocalMidnight(todayCal.year, todayCal.month, 1, tz);
      return { from, to, label: LABELS["last-month"] };
    }
    case "this-year": {
      const from = utcFromLocalMidnight(todayCal.year, 1, 1, tz);
      const to = utcFromLocalMidnight(todayCal.year + 1, 1, 1, tz);
      return { from, to, label: LABELS["this-year"] };
    }
    case "all-time":
      return { from: new Date(0), to: now, label: LABELS["all-time"] };
    default:
      return { from: addDays(todayStart, -29, tz), to: tomorrowStart, label: LABELS["last-30d"] };
  }
}
