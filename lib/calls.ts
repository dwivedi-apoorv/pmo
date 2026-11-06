// Weekly client calls: a weekday and a time (India time) that repeat every week.
export const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
] as const;

export type Call = {
  id: string;
  project_id: string;
  weekday: number; // 1 = Monday ... 7 = Sunday
  call_time: string; // "HH:MM" or "HH:MM:SS"
  duration_min: number | null;
  link: string | null;
  notes: string | null;
};

export const weekdayName = (n: number) => WEEKDAYS[n - 1]?.label ?? "";
/** Monday = 1 ... Sunday = 7, for a YYYY-MM-DD date. */
export const isoWeekday = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "10:30" -> "10:30 am" */
export const formatTime = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
export const byDayAndTime = (a: Pick<Call, "weekday" | "call_time">, b: Pick<Call, "weekday" | "call_time">) =>
  a.weekday - b.weekday || a.call_time.localeCompare(b.call_time);
