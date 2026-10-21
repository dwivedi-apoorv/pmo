import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type ActivityGroup = "project" | "payment" | "report" | "note" | "people" | "access" | "settings";

export const GROUP_LABEL: Record<ActivityGroup, string> = {
  project: "Projects",
  payment: "Payments",
  report: "Reports",
  note: "Notes",
  people: "Employees",
  access: "Access",
  settings: "Settings",
};

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "A", "A and B", "A, B and C". */
export const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Names for some employee ids (unknown ids are skipped). */
export async function employeeNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const { data } = await supabaseAdmin.from("employees").select("id, name").in("id", wanted);
  return new Map((data ?? []).map((e) => [e.id as string, e.name as string]));
}

/**
 * Writes one line to the activity log. The summary is written in full when it happens, so it keeps reading
 * correctly later. Never throws: a logging problem must not stop the change itself.
 */
export async function logActivity(a: {
  actor: { id: string; name: string };
  group: ActivityGroup;
  action: string;
  summary: string;
  projectId?: string | null;
  projectName?: string | null;
  details?: unknown;
}) {
  try {
    const { error } = await supabaseAdmin.from("activity_log").insert({
      actor_id: a.actor.id,
      actor_name: a.actor.name,
      grp: a.group,
      action: a.action,
      summary: a.summary,
      project_id: a.projectId ?? null,
      project_name: a.projectName ?? null,
      details: a.details ?? null,
    });
    if (error) console.error("[activity] could not log:", error.message);
  } catch (e) {
    console.error("[activity] could not log:", e instanceof Error ? e.message : e);
  }
}
