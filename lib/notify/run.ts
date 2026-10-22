import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { appUrl } from "@/lib/ms/config";
import { todayISO } from "@/lib/reporting";
import type { Due } from "@/lib/dues";
import type { ReportSend } from "@/lib/reports";
import { reportAttention } from "@/lib/reports";
import { buildDigests, type DigestEmployee, type DigestProject } from "@/lib/notify/digest";
import type { Notice } from "@/lib/notify/notice";
import type { ProjectStatus } from "@/lib/status";
import { assignedNotice, paymentPaidNotice, reportNudgeNotice, statusChangedNotice, teamChangedNotice, type AssignedProject } from "@/lib/notify/project";
import { Sender, getDisabledKinds, type Recipient } from "@/lib/notify/send";

export type DigestRun = { method: string; people: number; nudged: number; sent: number; failed: number; skipped: number; alreadySent: number; failures: string[] };

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
  const run: DigestRun = { method: sender.method, people: digests.size, nudged: 0, sent: 0, failed: 0, skipped: 0, alreadySent: 0, failures: [] };
  if (sender.method === "off") {
    run.skipped = digests.size;
    return run;
  }

  // Overdue-report reminders go to the manager: the morning after a report was due, and for up to 3 days.
  if (!(await getDisabledKinds()).has("report_nudge")) {
    const overdue = reportAttention(
      projects.filter((p) => p.status === "active"),
      sendsRes.data ?? [],
      todayISO()
    ).filter((r) => r.days < 0 && r.days >= -3);
    const nudges = overdue.flatMap((r) => {
      const p = projects.find((x) => x.id === r.project_id);
      const m = p?.project_manager_id ? employees.find((e) => e.id === p.project_manager_id) : undefined;
      return p && m && canMessage(m) ? [{ p, m, r, notice: reportNudgeNotice({ project: p.name, client: p.client_name, due: r.due, daysLate: -r.days }) }] : [];
    });
    if (nudges.length) {
      const already = new Set(
        ((await supabaseAdmin.from("notification_log").select("employee_id, summary").eq("kind", "nudge").eq("status", "sent").in("summary", nudges.map((n) => n.notice.title))).data ?? []).map(
          (l) => `${l.employee_id}|${l.summary}`
        )
      );
      for (const n of nudges) {
        if (!opts.force && already.has(`${n.m.id}|${n.notice.title}`)) continue;
        const result = await sender.send({ id: n.m.id, name: n.m.name, email: n.m.email }, n.notice, "nudge");
        if (result.ok) run.nudged++;
        else if (!result.skipped) run.failures.push(`${n.m.name} (reminder): ${result.detail ?? "failed"}`);
      }
    }
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

/** "The project was halted / completed / lost": to the manager and the team. Never throws. */
export async function notifyStatusChanged(projectId: string, status: ProjectStatus, reasons: string[], actorName: string) {
  try {
    if ((await getDisabledKinds()).has("status_changed")) return;
    const [{ data: project }, { data: team }] = await Promise.all([
      supabaseAdmin.from("projects").select("name, client_name, project_manager_id").eq("id", projectId).maybeSingle(),
      supabaseAdmin.from("project_assignments").select("employee_id").eq("project_id", projectId),
    ]);
    if (!project) return;
    const ids = [...new Set([project.project_manager_id as string | null, ...(team ?? []).map((t) => t.employee_id as string)].filter((x): x is string => !!x))];
    const { data: people } = await supabaseAdmin.from("employees").select("id, name, email, is_active").in("id", ids);
    const manager = people?.find((p) => p.id === project.project_manager_id)?.name ?? null;
    const notice = statusChangedNotice({ name: project.name, client: project.client_name, manager, status, reasons, by: actorName });
    if (!notice) return;
    const sender = await Sender.open();
    if (sender.method === "off") return;
    for (const e of people ?? []) {
      if (!e.is_active || !e.email) continue;
      await sender.send({ id: e.id, name: e.name, email: e.email } as Recipient, notice, "status");
    }
  } catch (e) {
    console.error("[notify] could not send status notices:", e instanceof Error ? e.message : e);
  }
}

/** "A payment was marked as paid": to the project's manager. Never throws. */
export async function notifyPaymentPaid(projectId: string, due: string, amount: string, actorName: string) {
  try {
    if ((await getDisabledKinds()).has("payment_paid")) return;
    const { data: project } = await supabaseAdmin.from("projects").select("name, client_name, project_manager_id").eq("id", projectId).maybeSingle();
    if (!project?.project_manager_id) return;
    const { data: m } = await supabaseAdmin.from("employees").select("id, name, email, is_active").eq("id", project.project_manager_id).maybeSingle();
    if (!m?.is_active || !m.email) return;
    const sender = await Sender.open();
    if (sender.method === "off") return;
    await sender.send({ id: m.id, name: m.name, email: m.email } as Recipient, paymentPaidNotice({ project: project.name, client: project.client_name, amount, due, by: actorName }), "payment");
  } catch (e) {
    console.error("[notify] could not send payment notice:", e instanceof Error ? e.message : e);
  }
}
