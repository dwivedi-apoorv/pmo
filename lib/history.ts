import { daysUntil, todayISO } from "@/lib/reporting";

// One stretch of someone working on a project (see supabase/migration-011.sql).
export type TeamPeriod = {
  id: string;
  project_id: string;
  employee_id: string | null; // blank if the employee was deleted later; employee_name still shows who it was
  employee_name: string;
  role: "manager" | "member";
  started_on: string;
  ended_on: string | null; // null = still on the project
};

export const ROLE_LABEL = { manager: "Project manager", member: "Team member" } as const;

/** How long a stretch lasted, counting both the first and last day: "1 day", "45 days", "5 mo", "1 yr 3 mo". */
export function formatDuration(from: string, to: string): string {
  const days = daysUntil(to, from) + 1;
  if (days < 1) return "1 day";
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.round(days / 30.4375);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} mo`;
  return rest === 0 ? `${years} yr` : `${years} yr ${rest} mo`;
}

/** Duration of a stretch, running to today if it is still open. */
export const periodDuration = (p: TeamPeriod, today = todayISO()) => formatDuration(p.started_on, p.ended_on ?? today);

/** Newest first, with people still on the project above anyone who left on the same day. */
export const newestFirst = (rows: TeamPeriod[]) =>
  [...rows].sort(
    (a, b) =>
      b.started_on.localeCompare(a.started_on) ||
      Number(b.ended_on === null) - Number(a.ended_on === null) ||
      a.employee_name.localeCompare(b.employee_name)
  );
