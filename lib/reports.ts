import { addDays, daysUntil, lastOccurrenceOnOrBefore, nextOccurrence, todayISO } from "@/lib/reporting";

// Reports repeat monthly on the day of a project's reporting date. The database only stores the ones
// marked SENT (report_log); everything else is worked out from the schedule.
export type ReportSend = { project_id: string; due_date: string; sent_at: string };
export type ReportProject = { id: string; reporting_date: string; created_at: string };
export type ReportRow = { project_id: string; due: string; days: number }; // negative = overdue

export const REPORT_WINDOW_DAYS = 3;

export const reportKey = (projectId: string, dueDate: string) => `${projectId}|${dueDate}`;
export const sentKeys = (sends: ReportSend[]) => new Set(sends.map((s) => reportKey(s.project_id, s.due_date)));

const istDate = (timestamp: string) => new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * The due date of a project's overdue report, or null. Only the most recent past report counts (older
 * ones are assumed handled, so one missed report never turns into a wall of red), and reports from before
 * the project was added to the app aren't tracked.
 */
export function overdueReportDate(p: ReportProject, sent: Set<string>, today = todayISO()): string | null {
  const prev = lastOccurrenceOnOrBefore(p.reporting_date, 1, addDays(today, -1));
  if (!prev || prev < istDate(p.created_at)) return null;
  return sent.has(reportKey(p.id, prev)) ? null : prev;
}

/** Reports that need action, most overdue first: overdue ones, then ones due within the window. Sent ones drop out. */
export function reportAttention(
  projects: ReportProject[],
  sends: ReportSend[],
  today = todayISO(),
  windowDays = REPORT_WINDOW_DAYS
): ReportRow[] {
  const sent = sentKeys(sends);
  const rows: ReportRow[] = [];
  for (const p of projects) {
    const overdue = overdueReportDate(p, sent, today);
    if (overdue) rows.push({ project_id: p.id, due: overdue, days: daysUntil(overdue, today) });
    const next = nextOccurrence(p.reporting_date, 1, today);
    const days = daysUntil(next, today);
    if (days <= windowDays && !sent.has(reportKey(p.id, next))) rows.push({ project_id: p.id, due: next, days });
  }
  return rows.sort((a, b) => a.days - b.days || a.project_id.localeCompare(b.project_id));
}
