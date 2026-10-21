"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifyAssigned, notifyTeamChanged } from "@/lib/notify/run";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isPaymentMethod, isPaymentTerm, projectionMonths } from "@/lib/payments";
import { backfillPaidPayments, openDuesForMonth } from "@/lib/open-dues";
import { todayISO } from "@/lib/reporting";
import { isProjectStatus, reasonRequired } from "@/lib/status";
import { isNoteKind } from "@/lib/notes";
import { requirePermission, requireProject, type Access } from "@/lib/access";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
// "" and "none" (the select's "— None —" option) both mean no project manager
const pmId = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s && s !== "none" ? s : null;
};

// Accept "example.com" as well as "https://example.com"
const normalizeUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

/** "Earlier payments were already collected": returns the date to back-fill up to, or null when not requested. */
function parseBackfill(formData: FormData, firstPaymentDate: string) {
  if (str(formData.get("backfill")) !== "1") return null;
  const until = str(formData.get("backfill_until"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Choose the date payments were collected up to.");
  if (until > todayISO()) throw new Error("The collected-up-to date can't be in the future.");
  if (until < firstPaymentDate) throw new Error("The collected-up-to date is before the first payment date.");
  return until;
}

async function runBackfill(projectId: string, payment: ReturnType<typeof parsePayment> | null, until: string | null) {
  if (!until || !payment) return;
  try {
    await backfillPaidPayments(projectId, payment, until);
  } catch (e) {
    throw new Error(
      `The project was saved, but recording the earlier payments failed: ${e instanceof Error ? e.message : "unknown error"}. Open Edit project to try again.`
    );
  }
}

function parsePayment(formData: FormData) {
  const payment_date = str(formData.get("payment_date"));
  const payment_term = str(formData.get("payment_term"));
  const payment_method = str(formData.get("payment_method"));
  const amountRaw = str(formData.get("payment_amount_usd"));
  const amount = Number(amountRaw);

  if (!payment_date || !isPaymentTerm(payment_term) || !isPaymentMethod(payment_method)) {
    throw new Error("Payment date, term and method are required.");
  }
  if (!amountRaw || !Number.isFinite(amount) || amount < 0) {
    throw new Error("Enter a valid payment amount in USD.");
  }
  return { payment_date, payment_term, payment_method, payment_amount_usd: Math.round(amount * 100) / 100 };
}

/** Who is on a project right now: used to tell people when they have just been added. */
async function currentTeam(projectId: string) {
  const [p, a] = await Promise.all([
    supabaseAdmin.from("projects").select("project_manager_id").eq("id", projectId).maybeSingle(),
    supabaseAdmin.from("project_assignments").select("employee_id").eq("project_id", projectId),
  ]);
  return {
    manager: (p.data?.project_manager_id as string | null) ?? null,
    members: new Set((a.data ?? []).map((r) => r.employee_id as string)),
  };
}

/** People who are on the new team but weren't on the old one. */
function newlyAdded(before: { manager: string | null; members: Set<string> }, manager: string | null, members: string[]) {
  const added: { employeeId: string; role: "Project manager" | "Team member" }[] = [];
  if (manager && manager !== before.manager) added.push({ employeeId: manager, role: "Project manager" });
  for (const m of members) if (!before.members.has(m) && m !== manager) added.push({ employeeId: m, role: "Team member" });
  return added;
}

/** How many services were chosen: ticked ones plus new names typed in. */
function serviceCount(formData: FormData) {
  const ids = formData.getAll("services").map(String).filter(Boolean);
  const names = formData.getAll("new_services").map((v) => String(v).trim()).filter(Boolean);
  return ids.length + names.length;
}

/** Saves a project's services. New names are created first (typing an existing name just picks it). */
async function saveServices(projectId: string, formData: FormData) {
  const ids = formData.getAll("services").map(String).filter(Boolean);
  for (const raw of formData.getAll("new_services")) {
    const name = String(raw).trim();
    if (!name) continue;
    const { data, error } = await supabaseAdmin.rpc("add_service", { p_name: name });
    if (error) throw new Error(error.message);
    ids.push(data as string);
  }
  const { error } = await supabaseAdmin.rpc("set_project_services", { p_project: projectId, p_services: [...new Set(ids)] });
  if (error) throw new Error(error.message);
}

/**
 * Sets the manager and team through the database, which also records who worked on the project and
 * from when to when. `effective` is the date the change took effect (earlier than today for a handover
 * that already happened).
 */
async function setTeam(projectId: string, managerId: string | null, memberIds: string[], effective: string) {
  const { error } = await supabaseAdmin.rpc("set_project_team", {
    p_project: projectId,
    p_manager: managerId,
    p_members: memberIds,
    p_effective: effective,
  });
  if (error) throw new Error(error.message);
}

export async function createProject(formData: FormData) {
  const access = await requirePermission("manage_projects");
  const me = access.user;
  const name = str(formData.get("name"));
  const client_name = str(formData.get("client_name"));
  const websiteRaw = str(formData.get("website"));
  const onboarding_date = str(formData.get("onboarding_date"));
  const reporting_date = str(formData.get("reporting_date"));
  const project_manager_id = pmId(formData.get("project_manager_id"));
  const assignees = formData.getAll("assignees").map(String).filter(Boolean);

  if (!name || !client_name || !websiteRaw || !onboarding_date || !reporting_date) {
    throw new Error("Name, client, website, onboarding date and reporting date are required.");
  }
  // Payment details are only read from people who may see payments; for anyone else the project starts without a plan.
  const payment = access.can("payments") ? parsePayment(formData) : null;
  const backfillUntil = payment ? parseBackfill(formData, payment.payment_date) : null;
  if (serviceCount(formData) === 0) throw new Error("Choose at least one service.");

  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert({
      name,
      client_name,
      website: normalizeUrl(websiteRaw),
      onboarding_date,
      reporting_date,
      ...(payment ?? {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  try {
    await saveServices(data.id, formData);
  } catch (e) {
    throw new Error(
      `The project was saved, but saving its services failed: ${e instanceof Error ? e.message : "unknown error"}. Open Edit project to set them.`
    );
  }

  const onboardingNotes = str(formData.get("onboarding_notes"));
  if (onboardingNotes) {
    const { error: nErr } = await supabaseAdmin.rpc("add_project_note", {
      p_project: data.id,
      p_kind: "onboarding",
      p_body: onboardingNotes,
      p_author: me.id,
    });
    if (nErr) {
      throw new Error(`The project was saved, but the onboarding notes were not: ${nErr.message} Add them from the Onboarding notes button.`);
    }
  }

  // The team starts working on the project from its onboarding date.
  try {
    await setTeam(data.id, project_manager_id, assignees, onboarding_date);
    const added = newlyAdded({ manager: null, members: new Set() }, project_manager_id, assignees);
    if (added.length) after(() => notifyAssigned(data.id, added)); // after the response, so saving never waits on Teams
  } catch (e) {
    throw new Error(
      `The project was saved, but assigning the team failed: ${e instanceof Error ? e.message : "unknown error"}. Open Edit project to assign them.`
    );
  }

  await runBackfill(data.id, payment, backfillUntil);
  revalidatePath("/payments");

  revalidatePath("/");
}

export async function updateProject(formData: FormData) {
  const access = await requirePermission("manage_projects");
  const me = access.user;
  const project_id = str(formData.get("project_id"));
  requireProject(access, project_id);
  const name = str(formData.get("name"));
  const client_name = str(formData.get("client_name"));
  const websiteRaw = str(formData.get("website"));
  const onboarding_date = str(formData.get("onboarding_date"));
  const reporting_date = str(formData.get("reporting_date"));

  if (!project_id || !name || !client_name || !websiteRaw || !onboarding_date || !reporting_date) {
    throw new Error("Name, client, website, onboarding date and reporting date are required.");
  }
  // Payment details are left as they are unless this person may see payments.
  const payment = access.can("payments") ? parsePayment(formData) : null;
  const backfillUntil = payment ? parseBackfill(formData, payment.payment_date) : null;
  if (serviceCount(formData) === 0) throw new Error("Choose at least one service.");

  const { error } = await supabaseAdmin
    .from("projects")
    .update({
      name,
      client_name,
      website: normalizeUrl(websiteRaw),
      onboarding_date,
      reporting_date,
      ...(payment ?? {}),
    })
    .eq("id", project_id);
  if (error) throw new Error(error.message);

  await saveServices(project_id, formData);

  // Manager and team: the database closes the stretch of anyone who left and opens one for anyone who
  // joined, dated `effective_date` (today unless you record an earlier handover).
  const effective = str(formData.get("effective_date")) || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) throw new Error("Enter a valid date for when the change took effect.");
  if (effective > todayISO()) throw new Error("The change can't take effect in the future.");
  const newManager = pmId(formData.get("project_manager_id"));
  const newMembers = formData.getAll("assignees").map(String).filter(Boolean);
  const before = await currentTeam(project_id);
  await setTeam(project_id, newManager, newMembers, effective);
  const added = newlyAdded(before, newManager, newMembers);
  if (added.length) after(() => notifyAssigned(project_id, added));
  after(() => notifyTeamChanged(project_id, before, newManager, newMembers, added.map((a) => a.employeeId)));

  await runBackfill(project_id, payment, backfillUntil);
  revalidatePath("/payments");
  revalidatePath("/");
}

/** Reuse an existing role's exact spelling ("project manager" -> "Project Manager"). */
async function canonicalRole(roleRaw: string) {
  const { data: existing, error } = await supabaseAdmin.from("employees").select("role");
  if (error) throw new Error(error.message);
  return (existing ?? []).map((r) => r.role as string | null).find((r) => r?.toLowerCase() === roleRaw.toLowerCase()) ?? roleRaw;
}

export async function createEmployee(formData: FormData) {
  const access = await requirePermission("manage_people");
  const me = access.user;
  const name = str(formData.get("name"));
  const email = str(formData.get("email")).toLowerCase();
  const roleRaw = str(formData.get("role"));

  if (!name || !email || !roleRaw) throw new Error("Name, email and role are required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");

  const role = await canonicalRole(roleRaw);

  const { error } = await supabaseAdmin.from("employees").insert({ name, email, role });
  if (error) {
    if (error.code === "23505") throw new Error("An employee with this email already exists.");
    throw new Error(error.message);
  }

  revalidatePath("/");
}

export async function updateEmployee(formData: FormData) {
  const access = await requirePermission("manage_people");
  const me = access.user;
  const employee_id = str(formData.get("employee_id"));
  const name = str(formData.get("name"));
  const email = str(formData.get("email")).toLowerCase();
  const roleRaw = str(formData.get("role"));

  if (!employee_id) throw new Error("Missing employee.");
  if (!name || !email || !roleRaw) throw new Error("Name, email and role are required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");

  const { error } = await supabaseAdmin.rpc("update_employee", {
    p_employee: employee_id,
    p_name: name,
    p_email: email,
    p_role: await canonicalRole(roleRaw),
  });
  if (error) {
    if (error.code === "23505") throw new Error("Another employee already uses this email.");
    throw new Error(error.message);
  }

  revalidatePath("/");
  revalidatePath("/people");
  revalidatePath("/projects");
}

export async function deactivateEmployee(formData: FormData) {
  const access = await requirePermission("manage_people");
  const me = access.user;
  const employee_id = str(formData.get("employee_id"));
  if (!employee_id) return;

  const { error } = await supabaseAdmin.rpc("deactivate_employee", {
    p_employee: employee_id,
    p_manager_to: str(formData.get("manager_to")) || null,
    p_assignee_to: str(formData.get("assignee_to")) || null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/people");
}

export async function reactivateEmployee(formData: FormData) {
  const access = await requirePermission("manage_people");
  const me = access.user;
  const employee_id = str(formData.get("employee_id"));
  if (!employee_id) return;

  const { error } = await supabaseAdmin.from("employees").update({ is_active: true }).eq("id", employee_id);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/people");
}

export async function deleteEmployee(formData: FormData) {
  const access = await requirePermission("manage_people");
  const me = access.user;
  const employee_id = str(formData.get("employee_id"));
  if (!employee_id) return;

  // Safety net: only deactivated people can be deleted, so their open projects were already handed over.
  const { data, error: gErr } = await supabaseAdmin
    .from("employees")
    .select("is_active")
    .eq("id", employee_id)
    .maybeSingle();
  if (gErr) throw new Error(gErr.message);
  if (!data) throw new Error("Employee not found.");
  if (data.is_active) throw new Error("Deactivate this employee first.");

  const { error } = await supabaseAdmin.from("employees").delete().eq("id", employee_id);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/people");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function markPaid(formData: FormData) {
  const access = await requirePermission("payments");
  const me = access.user;
  const project_id = str(formData.get("project_id"));
  requireProject(access, project_id);
  const due_date = str(formData.get("due_date"));
  if (!project_id || !DATE_RE.test(due_date)) throw new Error("Missing project or due date.");

  const { data: existing, error: eErr } = await supabaseAdmin
    .from("payment_dues")
    .select("status")
    .eq("project_id", project_id)
    .eq("due_date", due_date)
    .maybeSingle();
  if (eErr) throw new Error(eErr.message);

  const paid_at = new Date().toISOString();
  if (existing) {
    if (existing.status === "paid") return; // already paid, nothing to do
    // Keep the amount the due was opened with; only flip it to paid.
    const { error } = await supabaseAdmin
      .from("payment_dues")
      .update({ status: "paid", paid_at })
      .eq("project_id", project_id)
      .eq("due_date", due_date);
    if (error) throw new Error(error.message);
  } else {
    // The monthly job hasn't opened this payment yet: record it from the project's plan, as paid.
    const { data: project, error: pErr } = await supabaseAdmin
      .from("projects")
      .select("payment_amount_usd, payment_term, payment_method")
      .eq("id", project_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!project) throw new Error("Project not found.");

    const { error } = await supabaseAdmin.from("payment_dues").insert({
      project_id,
      due_date,
      amount_usd: project.payment_amount_usd ?? 0,
      term: project.payment_term,
      method: project.payment_method,
      status: "paid",
      paid_at,
      source: "manual",
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/");
  revalidatePath("/projects");
}

/** Puts a paid payment back to unpaid. The row stays; nothing is deleted. */
export async function undoPaid(formData: FormData) {
  const access = await requirePermission("payments");
  const me = access.user;
  const project_id = str(formData.get("project_id"));
  requireProject(access, project_id);
  const due_date = str(formData.get("due_date"));
  if (!project_id || !DATE_RE.test(due_date)) return;

  const { error } = await supabaseAdmin
    .from("payment_dues")
    .update({ status: "due", paid_at: null })
    .eq("project_id", project_id)
    .eq("due_date", due_date);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/projects");
}

/** Runs the monthly job for the current month on demand (same code the scheduled job runs). */
export async function openDuesNow(): Promise<{ ok: boolean; message: string }> {
  await requirePermission("payments");
  try {
    const month = projectionMonths(todayISO(), 1)[0];
    const r = await openDuesForMonth(month);
    revalidatePath("/");
    revalidatePath("/projects");
    return {
      ok: true,
      message:
        r.created > 0
          ? `Opened ${r.created} new ${r.created === 1 ? "due" : "dues"} for ${month.label}.`
          : `${month.label} is already up to date (${r.scheduled} ${r.scheduled === 1 ? "payment" : "payments"} scheduled, none new).`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

export async function changeProjectStatus(formData: FormData) {
  const access = await requirePermission("manage_projects");
  const me = access.user;
  const project_id = str(formData.get("project_id"));
  requireProject(access, project_id);
  const status = str(formData.get("status"));
  const reason = str(formData.get("reason"));

  if (!project_id || !isProjectStatus(status)) throw new Error("Missing project or status.");
  if (reasonRequired(status) && !reason) throw new Error("Please choose a reason.");
  if (reason.length > 80 && status !== "active") throw new Error("Keep the reason under 80 characters.");

  // A reason typed for the first time joins the list (matching an existing one ignoring capitals and spacing),
  // so the next person can pick it, and so reasons can be counted.
  let chosen = reason.replace(/\s+/g, " ");
  if (chosen && status !== "active") {
    const { data: known } = await supabaseAdmin.from("status_reasons").select("name").eq("status", status);
    const match = (known ?? []).find((r) => (r.name as string).trim().toLowerCase() === chosen.toLowerCase());
    if (match) chosen = match.name as string;
    else {
      const { error: rErr } = await supabaseAdmin.from("status_reasons").insert({ status, name: chosen });
      if (rErr) throw new Error(rErr.message);
    }
  }

  // One database step updates the status and writes the history row, so they can't drift apart.
  const { error } = await supabaseAdmin.rpc("set_project_status", {
    p_project: project_id,
    p_status: status,
    p_reason: chosen || null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath("/people");
}

/** Records that a project's report for `due_date` has been sent. */
export async function markReportSent(formData: FormData) {
  const access = await requirePermission("reports");
  const me = access.user;
  const project_id = str(formData.get("project_id"));
  requireProject(access, project_id);
  const due_date = str(formData.get("due_date"));
  if (!project_id || !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) throw new Error("Missing project or report date.");

  const { error } = await supabaseAdmin
    .from("report_log")
    .upsert({ project_id, due_date }, { onConflict: "project_id,due_date", ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/reports");
  revalidatePath("/projects");
}

/** Puts a report back to "not sent". The row is removed, nothing else changes. */
export async function undoReportSent(formData: FormData) {
  const access = await requirePermission("reports");
  const me = access.user;
  const project_id = str(formData.get("project_id"));
  requireProject(access, project_id);
  const due_date = str(formData.get("due_date"));
  if (!project_id || !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) return;

  const { error } = await supabaseAdmin.from("report_log").delete().eq("project_id", project_id).eq("due_date", due_date);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/reports");
  revalidatePath("/projects");
}

/** A note can only be changed by someone who can see the project it belongs to. */
async function requireNoteAccess(access: Access, noteId: string) {
  const { data } = await supabaseAdmin.from("project_notes").select("project_id").eq("id", noteId).maybeSingle();
  if (data) requireProject(access, data.project_id as string);
}

function refreshNotes() {
  revalidatePath("/projects");
  revalidatePath("/onboarding");
}

/** Adds a note. The database refuses a second onboarding note for a project and requires an author. */
export async function addNote(formData: FormData) {
  const access = await requirePermission("edit_notes");
  const me = access.user;
  const project_id = str(formData.get("project_id"));
  requireProject(access, project_id);
  const kind = str(formData.get("kind")) || "general";
  if (!project_id) throw new Error("Missing project.");
  if (!isNoteKind(kind)) throw new Error("Choose a type for the note.");

  const { error } = await supabaseAdmin.rpc("add_project_note", {
    p_project: project_id,
    p_kind: kind,
    p_body: str(formData.get("body")),
    p_author: me.id,
  });
  if (error) throw new Error(error.message);
  refreshNotes();
}

/** Edits a note's text. The database keeps the previous version and records who edited. */
export async function updateNote(formData: FormData) {
  const access = await requirePermission("edit_notes");
  const me = access.user;
  const id = str(formData.get("id"));
  if (!id) throw new Error("Missing note.");
  await requireNoteAccess(access, id);

  const { error } = await supabaseAdmin.rpc("edit_project_note", {
    p_note: id,
    p_body: str(formData.get("body")),
    p_editor: me.id,
  });
  if (error) throw new Error(error.message);
  refreshNotes();
}

/** Deletes a note, except onboarding notes: those can be edited but never removed. */
export async function deleteNote(formData: FormData) {
  const access = await requirePermission("edit_notes");
  const me = access.user;
  const id = str(formData.get("id"));
  if (!id) return;
  await requireNoteAccess(access, id);

  const { data, error: gErr } = await supabaseAdmin.from("project_notes").select("kind").eq("id", id).maybeSingle();
  if (gErr) throw new Error(gErr.message);
  if (!data) return;
  if (data.kind === "onboarding") throw new Error("Onboarding notes can be edited but not deleted.");

  const { error } = await supabaseAdmin.from("project_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
  refreshNotes();
}
