// Recurring dates. A project's anchor date repeats every `stepMonths` months on the same
// day-of-month (a month shorter than the day uses its last day: 31st -> 30th/28th).
// Reports use step 1 (monthly); payments use 1, 3 or 6. Dates are "YYYY-MM-DD" strings and
// "today" is taken in the business timezone.

const TZ = "Asia/Kolkata";

export const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

const toUTC = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The first date in the series (anchor, anchor + step, anchor + 2*step, …) that is today or later. */
export function nextOccurrence(anchor: string, stepMonths: number, today = todayISO()): string {
  const t = toUTC(today);
  if (toUTC(anchor) >= t) return anchor; // the first one hasn't happened yet

  const day = Number(anchor.slice(8, 10));
  const ay = Number(anchor.slice(0, 4));
  const am = Number(anchor.slice(5, 7)) - 1;
  const monthsApart = (Number(today.slice(0, 4)) - ay) * 12 + (Number(today.slice(5, 7)) - 1 - am);

  for (let k = Math.floor(monthsApart / stepMonths), i = 0; i < 3; k++, i++) {
    const idx = am + k * stepMonths;
    const y = ay + Math.floor(idx / 12);
    const m = ((idx % 12) + 12) % 12;
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const candidate = Date.UTC(y, m, Math.min(day, daysInMonth));
    if (candidate >= t) return toISO(candidate);
  }
  return anchor; // unreachable
}

export const nextReportDate = (anchor: string, today = todayISO()) => nextOccurrence(anchor, 1, today);

export const daysUntil = (iso: string, today = todayISO()) =>
  Math.round((toUTC(iso) - toUTC(today)) / 86_400_000);

export const dueLabel = (days: number) =>
  days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
