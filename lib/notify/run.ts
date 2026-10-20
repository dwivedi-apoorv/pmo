import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { appUrl } from "@/lib/ms/config";
import { todayISO } from "@/lib/reporting";
import type { Due } from "@/lib/dues";
import type { ReportSend } from "@/lib/reports";
import { buildDigests, type DigestEmployee, type DigestProject } from "@/lib/notify/digest";
import type { Notice } from "@/lib/notify/notice";
import { assignedNotice, teamChangedNotice, type AssignedProject } from "@/lib/notify/project";
import { Sender, getDisabledKinds, type Recipient } from "@/lib/notify/send";

export type DigestRun = { method: string; people: number; sent: number; failed: number; skipped: number; alreadySent: number; failures: string[] };

const canMessage = (e: DigestEmployee): e is DigestEmployee & { email: string } => e.is_active && !!e.email;

/**
 * Sends each person's daily summary (only people who have something to act on). A person gets at most
 * one summary per day: running it again the same day skips whoever already got theirs, unless `force`.
 */
export async function runDailyDigest(opts: { force?: boolean } = {}): Promise<DigestRun> {
  const [projectsRes, ledgerRes, sendsRes, employeesRes] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, name, client_name, status, reporting_date, created_at, project_manager_id, payment_date, payment_term, payment_method, payment_amount_usd, project_assignments(employee_id)"),
    supabaseAdmin.from("payment_dues").select("project_id, due_date, amount_usd, term, method, status, paid_at").returns<Due[]>(),
    supabaseAdmin.from("report_log").select("project_id, due_date, sent_at").returns<ReportSend[]>(),
    supabaseAdmin.from("employees").select("id, name, email, is_active"),
  ]);
  const error = projectsRes.error ?? ledgerRes.error ?? sendsRes.error ?? employeesRes.error;
  if (error) throw new Error(error.message);

  const projects = (projectsRes.data ?? []).map((p: any): DigestProject => ({
    ...p,
    assignees: (p.project_assignments ?? []).map((a: { employee_id: string }) => a.employee_id),
  }));
  const employees = (employeesRes.data ?? []) as DigestEmployee[];
  const off = await getDisabledKinds();
  const digests = buildDigests({
    projects,
    ledger: ledgerRes.data ?? [],
    sends: sendsRes.data ?? [],
    employees,
    appUrl: appUrl(),
    include: { reports: !off.has("reports"), payments: !off.has("payments") },
  });

  const sender = await Sender.open();
  const run: DigestRun = { method: sender.method, people: digests.size, sent: 0, failed: 0, skipped: 0, alreadySent: 0, failures: [] };
  if (sender.method === "off") {
    run.skipped = digests.size;
    return run;
  }

  const todayStart = `${todayISO()}T00:00:00+05:30`;
  const doneToday = new Set(
    ((await supabaseAdmin.from("notification_log").select("employee_id").eq("kind", "digest").eq("status", "sent").gte("created_at", todayStart)).data ?? []).map(
      (r) => r.employee_id as string
    )
  );

  for (const [id, notice] of digests) {
    const e = employees.find((x) => x.id === id);
    if (!e || !canMessage(e)) continue;
    if (!opts.force && doneToday.has(id)) {
      run.alreadySent++;
      continue;
    }
    const result = await sender.send({ id: e.id, name: e.name, email: e.email }, notice, "digest");
    if (result.ok) run.sent++;
    else if (result.skipped) run.skipped++;
    else {
      run.failed++;
      run.failures.push(`${e.name}: ${result.detail ?? "failed"}`);
    }
  }
  return run;
}

/** "You've been added to X": sent to everyone newly added as manager or team member (including whoever made the change). Never throws (a Teams problem must not break saving). */
export async function notifyAssigned(
  projectId: string,
  added: { employeeId: string; role: "Project manager" | "Team member" }[]
) {
  try {
    if ((await getDisabledKinds()).has("assigned")) return;
    const who = added;
    if (!who.length) return;
    const [{ data: project }, { data: people }, { data: onboarding }, { data: svc }] = await Promise.all([
      supabaseAdmin
        .from("projects")
        .select("name, client_name, website, onboarding_date, project_manager_id")
        .eq("id", projectId)
        .maybeSingle(),
      supabaseAdmin.from("employees").select("id, name, email, is_active").in("id", who.map((w) => w.employeeId)),
      supabaseAdmin.from("project_notes").select("body").eq("project_id", projectId).eq("kind", "onboarding").maybeSingle(),
      supabaseAdmin.from("project_services").select("services(name)").eq("project_id", projectId),
    ]);
    if (!project) return;
    const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
    const managerName = project.project_manager_id
      ? (await supabaseAdmin.from("employees").select("name").eq("id", project.project_manager_id).maybeSingle()).data?.name ?? null
      : null;
    const details: AssignedProject = {
      ...(project as any),
      manager: managerName,
      onboarding_notes: (onboarding?.body as string | undefined) ?? null,
      services: (svc ?? []).map((t: any) => one<{ name: string }>(t.services)?.name).filter((n): n is string => !!n).sort(),
    };
    const sender = await Sender.open();
    if (sender.method === "off") return;
    for (const w of who) {
      const e = people?.find((p) => p.id === w.employeeId);
      if (!e?.is_active || !e.email) continue;
      const notice: Notice = assignedNotice(details);
      await sender.send({ id: e.id, name: e.name, email: e.email } as Recipient, notice, "assigned");
    }
  } catch (e) {
    console.error("[notify] could not send assignment notices:", e instanceof Error ? e.message : e);
  }
}

/**
 * "The team on X changed": sent to everyone on the project now who isn't getting the "added to a project"
 * welcome (new people get that instead). Does nothing if neither the manager nor the team changed.
 */
export async function notifyTeamChanged(
  projectId: string,
  before: { manager: string | null; members: Set<string> },
  manager: string | null,
  members: string[],
  welcomed: string[]
) {
  try {
    const now = new Set(members);
    const added = members.filter((m) => !before.members.has(m) && m !== manager);
    const removed = [...before.members].filter((m) => !now.has(m) && m !== manager);
    if (manager === before.manager && !added.length && !removed.length) return;
    if ((await getDisabledKinds()).has("team_changed")) return;

    const ids = [...new Set([manager, before.manager, ...members, ...before.members].filter((x): x is string => !!x))];
    const [{ data: project }, { data: people }] = await Promise.all([
      supabaseAdmin.from("projects").select("name").eq("id", projectId).maybeSingle(),
      supabaseAdmin.from("employees").select("id, name, email, is_active").in("id", ids),
    ]);
    if (!project) return;
    const name = (id: string | null) => (id ? people?.find((p) => p.id === id)?.name ?? null : null);
    const names = (xs: string[]) => xs.map(name).filter((n): n is string => !!n).sort();
    const notice = teamChangedNotice({
      project: project.name,
      oldManager: name(before.manager),
      newManager: name(manager),
      added: names(added),
      removed: names(removed),
      team: names(members.filter((m) => m !== manager)),
    });

    const sender = await Sender.open();
    if (sender.method === "off") return;
    const recipients = new Set([manager, ...members].filter((x): x is string => !!x && !welcomed.includes(x)));
    for (const id of recipients) {
      const e = people?.find((p) => p.id === id);
      if (!e?.is_active || !e.email) continue;
      await sender.send({ id: e.id, name: e.name, email: e.email } as Recipient, notice, "assigned");
    }
  } catch (e) {
    console.error("[notify] could not send team-change notices:", e instanceof Error ? e.message : e);
  }
}
