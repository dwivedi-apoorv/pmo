"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifyAssigned, notifyPaymentPaid, notifyStatusChanged, notifyTeamChanged } from "@/lib/notify/run";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isPaymentMethod, isPaymentTerm, projectionMonths } from "@/lib/payments";
import { backfillPaidPayments, openDuesForMonth } from "@/lib/open-dues";
import { todayISO } from "@/lib/reporting";
import { isProjectStatus, reasonRequired } from "@/lib/status";
import { isNoteKind } from "@/lib/notes";
import { requireAdmin, requirePermission, requireProject, type Access } from "@/lib/access";
import { sendEmail } from "@/lib/email";
import { generateCode, hashCode, isCodeShape } from "@/lib/otp";
import { employeeNames, firstName, list, logActivity } from "@/lib/activity";
import { formatUSD, methodLabel, termLabel } from "@/lib/payments";
import ExcelJS from "exceljs";
import { rowFromCells, rowKey, rowToFields, validateRows, type ImportContext, type ImportRow } from "@/lib/import-projects";

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

const usd = (n: number | null) => (n === null || n === undefined ? "none" : formatUSD(Number(n)));
async function projectLabel(id: string) {
  const { data } = await supabaseAdmin.from("projects").select("name").eq("id", id).maybeSingle();
  return (data?.name as string | undefined) ?? "a project";
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
  await createProjectCore(access, formData, { notify: true, log: true, paymentOptional: false });
  revalidatePath("/payments");
  revalidatePath("/");
}

type CreateOptions = {
  notify: boolean; // tell the new team in Teams
  log: boolean; // write a line to the activity log
  paymentOptional: boolean; // a project may be created without a payment plan (bulk import)
};

/** Creates one project from form-style fields. Shared by the New project form and the Excel import. */
async function createProjectCore(access: Access, formData: FormData, opts: CreateOptions): Promise<string> {
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
  const hasPaymentFields = ["payment_date", "payment_term", "payment_method", "payment_amount_usd"].some((k) => str(formData.get(k)));
  const payment = access.can("payments") && (hasPaymentFields || !opts.paymentOptional) ? parsePayment(formData) : null;
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
    if (added.length && opts.notify) after(() => notifyAssigned(data.id, added)); // after the response, so saving never waits on Teams
  } catch (e) {
    throw new Error(
      `The project was saved, but assigning the team failed: ${e instanceof Error ? e.message : "unknown error"}. Open Edit project to assign them.`
    );
  }

  await runBackfill(data.id, payment, backfillUntil);

  const who = await employeeNames([project_manager_id, ...assignees]);
  const team = assignees.map((id) => who.get(id)).filter((n): n is string => !!n);
  if (opts.log) await logActivity({
    actor: me,
    group: "project",
    action: "project_created",
    projectId: data.id,
    projectName: name,
    summary: `${firstName(me.name)} created the project ${name} for ${client_name}${project_manager_id ? `, managed by ${who.get(project_manager_id)}` : ""}${team.length ? `, with ${list(team)}` : ""}`,
  });
  return data.id as string;
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

  const { data: old } = await supabaseAdmin
    .from("projects")
    .select("name, client_name, website, onboarding_date, reporting_date, payment_date, payment_term, payment_method, payment_amount_usd")
    .eq("id", project_id)
    .maybeSingle();
  const servicesOf = async () =>
    ((await supabaseAdmin.from("project_services").select("services(name)").eq("project_id", project_id)).data ?? [])
      .map((r: any) => (Array.isArray(r.services) ? r.services[0]?.name : r.services?.name) as string | undefined)
      .filter((n): n is string => !!n)
      .sort();
  const servicesBefore = await servicesOf();

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

  // ---- activity log: one line for each kind of change ----
  const who = firstName(me.name);
  const log = (group: "project" | "payment", action: string, summary: string, details?: unknown) =>
    logActivity({ actor: me, group, action, summary, projectId: project_id, projectName: name, details });
  const shown = (v: unknown) => (v === null || v === undefined || v === "" ? "empty" : String(v));
  const changes: { field: string; from: string; to: string }[] = [];
  const track = (field: string, from: unknown, to: unknown) => from !== to && changes.push({ field, from: shown(from), to: shown(to) });
  if (old) {
    track("project name", old.name, name);
    track("client", old.client_name, client_name);
    track("website", old.website, normalizeUrl(websiteRaw));
    track("onboarding date", old.onboarding_date, onboarding_date);
    track("reporting date", old.reporting_date, reporting_date);
  }
  if (changes.length) await log("project", "project_edited", `${who} edited ${name}: ${changes.map((c) => `${c.field} ${c.from} → ${c.to}`).join("; ")}`, changes);

  const servicesAfter = await servicesOf();
  const addedSvc = servicesAfter.filter((x) => !servicesBefore.includes(x));
  const removedSvc = servicesBefore.filter((x) => !servicesAfter.includes(x));
  if (addedSvc.length || removedSvc.length) {
    await log("project", "services_changed", `${who} changed the services of ${name}${addedSvc.length ? `: added ${list(addedSvc)}` : ""}${removedSvc.length ? `${addedSvc.length ? ";" : ":"} removed ${list(removedSvc)}` : ""}`);
  }

  const gone = [...before.members].filter((m) => !newMembers.includes(m) && m !== newManager);
  const came = newMembers.filter((m) => !before.members.has(m) && m !== newManager);
  if (newManager !== before.manager || gone.length || came.length) {
    const nm = await employeeNames([before.manager, newManager, ...gone, ...came]);
    const parts: string[] = [];
    if (newManager !== before.manager) parts.push(`manager ${before.manager ? nm.get(before.manager) ?? "someone" : "none"} → ${newManager ? nm.get(newManager) ?? "someone" : "none"}`);
    if (came.length) parts.push(`added ${list(came.map((id) => nm.get(id) ?? "someone"))}`);
    if (gone.length) parts.push(`removed ${list(gone.map((id) => nm.get(id) ?? "someone"))}`);
    await log("project", "team_changed", `${who} changed the team of ${name}: ${parts.join("; ")}${effective !== todayISO() ? ` (effective ${effective})` : ""}`);
  }

  if (old && payment) {
    const pc: string[] = [];
    if (Number(old.payment_amount_usd) !== payment.payment_amount_usd) pc.push(`amount ${usd(old.payment_amount_usd)} → ${usd(payment.payment_amount_usd)}`);
    if (old.payment_term !== payment.payment_term) pc.push(`term ${termLabel(old.payment_term) || "none"} → ${termLabel(payment.payment_term)}`);
    if (old.payment_method !== payment.payment_method) pc.push(`method ${methodLabel(old.payment_method) || "none"} → ${methodLabel(payment.payment_method)}`);
    if (old.payment_date !== payment.payment_date) pc.push(`first payment ${shown(old.payment_date)} → ${payment.payment_date}`);
    if (pc.length) await log("payment", "payment_plan_changed", `${who} changed the payment plan of ${name}: ${pc.join("; ")}`);
  }
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
  await logActivity({ actor: me, group: "people", action: "employee_added", summary: `${firstName(me.name)} added the employee ${name} (${role}, ${email})` });

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

  const { data: oldEmp } = await supabaseAdmin.from("employees").select("name, email, role").eq("id", employee_id).maybeSingle();
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
  if (oldEmp) {
    const newRole = await canonicalRole(roleRaw);
    const ch: string[] = [];
    if (oldEmp.name !== name) ch.push(`name ${oldEmp.name} → ${name}`);
    if ((oldEmp.email as string | null)?.toLowerCase() !== email) ch.push(`email ${oldEmp.email} → ${email}`);
    if (oldEmp.role !== newRole) ch.push(`role ${oldEmp.role ?? "none"} → ${newRole}`);
    if (ch.length) await logActivity({ actor: me, group: "people", action: "employee_edited", summary: `${firstName(me.name)} edited ${oldEmp.name}: ${ch.join("; ")}` });
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

  const managerTo = str(formData.get("manager_to")) || null;
  const assigneeTo = str(formData.get("assignee_to")) || null;
  const { error } = await supabaseAdmin.rpc("deactivate_employee", {
    p_employee: employee_id,
    p_manager_to: managerTo,
    p_assignee_to: assigneeTo,
  });
  if (error) throw new Error(error.message);
  {
    const nm = await employeeNames([employee_id, managerTo, assigneeTo]);
    const handed = [managerTo && `projects they managed to ${nm.get(managerTo)}`, assigneeTo && `their team work to ${nm.get(assigneeTo)}`].filter(Boolean) as string[];
    await logActivity({ actor: me, group: "people", action: "employee_deactivated", summary: `${firstName(me.name)} deactivated ${nm.get(employee_id) ?? "an employee"}${handed.length ? `, handing over ${list(handed)}` : ""}` });
  }

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
  await logActivity({ actor: me, group: "people", action: "employee_reactivated", summary: `${firstName(me.name)} reactivated ${(await employeeNames([employee_id])).get(employee_id) ?? "an employee"}` });

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
    .select("is_active, name")
    .eq("id", employee_id)
    .maybeSingle();
  if (gErr) throw new Error(gErr.message);
  if (!data) throw new Error("Employee not found.");
  if (data.is_active) throw new Error("Deactivate this employee first.");

  const { error } = await supabaseAdmin.from("employees").delete().eq("id", employee_id);
  if (error) throw new Error(error.message);
  await logActivity({ actor: me, group: "people", action: "employee_deleted", summary: `${firstName(me.name)} permanently deleted the employee ${data.name}` });

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
  const paidInfo = async () => {
    const [name, { data: row }] = await Promise.all([
      projectLabel(project_id),
      supabaseAdmin.from("payment_dues").select("amount_usd").eq("project_id", project_id).eq("due_date", due_date).maybeSingle(),
    ]);
    return { name, amount: usd(row?.amount_usd as number | null) };
  };
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
  const pi = await paidInfo();
  after(() => notifyPaymentPaid(project_id, due_date, pi.amount, me.name));
  await logActivity({ actor: me, group: "payment", action: "payment_paid", projectId: project_id, projectName: pi.name, summary: `${firstName(me.name)} marked the ${pi.amount} payment for ${pi.name} (due ${due_date}) as paid` });

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
  {
    const [name, { data: row }] = await Promise.all([
      projectLabel(project_id),
      supabaseAdmin.from("payment_dues").select("amount_usd").eq("project_id", project_id).eq("due_date", due_date).maybeSingle(),
    ]);
    await logActivity({ actor: me, group: "payment", action: "payment_unpaid", projectId: project_id, projectName: name, summary: `${firstName(me.name)} put the ${usd(row?.amount_usd as number | null)} payment for ${name} (due ${due_date}) back to unpaid` });
  }

  revalidatePath("/");
  revalidatePath("/projects");
}

/** Runs the monthly job for the current month on demand (same code the scheduled job runs). */
export async function openDuesNow(): Promise<{ ok: boolean; message: string }> {
  const { user: me } = await requirePermission("payments");
  try {
    const month = projectionMonths(todayISO(), 1)[0];
    const r = await openDuesForMonth(month);
    if (r.created > 0) await logActivity({ actor: me, group: "payment", action: "dues_generated", summary: `${firstName(me.name)} generated ${r.created} new ${r.created === 1 ? "due" : "dues"} for ${month.label}` });
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
  const note = str(formData.get("reason")); // a free note, only used when a project is resumed or reopened

  if (!project_id || !isProjectStatus(status)) throw new Error("Missing project or status.");

  // Reasons: every ticked one plus any typed in. A new one joins the list (matching an existing one ignoring
  // capitals and spacing), so the next person can pick it, and so reasons can be counted.
  const tidy = (v: string) => v.trim().replace(/\s+/g, " ");
  const asked = [...formData.getAll("reasons"), ...formData.getAll("new_reasons")].map((v) => tidy(String(v))).filter(Boolean);
  if (asked.some((r) => r.length > 80)) throw new Error("Keep each reason under 80 characters.");
  const reasons: string[] = [];
  if (status !== "active") {
    const { data: known } = await supabaseAdmin.from("status_reasons").select("name").eq("status", status);
    for (const r of asked) {
      const match = (known ?? []).find((k) => (k.name as string).trim().toLowerCase() === r.toLowerCase());
      const name = match ? (match.name as string) : r;
      if (!match) {
        const { error: rErr } = await supabaseAdmin.from("status_reasons").insert({ status, name });
        if (rErr && !/duplicate/i.test(rErr.message)) throw new Error(rErr.message);
        known?.push({ name });
      }
      if (!reasons.some((x) => x.toLowerCase() === name.toLowerCase())) reasons.push(name);
    }
  }
  if (reasonRequired(status) && reasons.length === 0) throw new Error("Please choose at least one reason.");

  // One database step updates the status and writes the history row, so they can't drift apart.
  const { data: prev } = await supabaseAdmin.from("projects").select("name, status").eq("id", project_id).maybeSingle();
  const { error } = await supabaseAdmin.rpc("set_project_status", {
    p_project: project_id,
    p_status: status,
    p_reason: note || null,
    p_reasons: reasons,
  });
  if (error) throw new Error(error.message);
  {
    const verb: Record<string, string> = { halted: "halted", completed: "marked as completed", ended: "marked as lost", active: prev?.status === "halted" ? "resumed" : "reopened" };
    if (status === "halted" || status === "completed" || status === "ended") after(() => notifyStatusChanged(project_id, status, reasons, me.name));
    const why = reasons.length ? ` (${list(reasons)})` : note ? ` (${note})` : "";
    await logActivity({ actor: me, group: "project", action: `status_${status}`, projectId: project_id, projectName: prev?.name as string | undefined, details: { from: prev?.status, to: status, reasons, note: note || undefined }, summary: `${firstName(me.name)} ${verb[status]} ${prev?.name ?? "a project"}${why}` });
  }

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
  {
    const name = await projectLabel(project_id);
    await logActivity({ actor: me, group: "report", action: "report_sent", projectId: project_id, projectName: name, summary: `${firstName(me.name)} marked the report for ${name} (due ${due_date}) as sent` });
  }

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
  {
    const name = await projectLabel(project_id);
    await logActivity({ actor: me, group: "report", action: "report_unsent", projectId: project_id, projectName: name, summary: `${firstName(me.name)} put the report for ${name} (due ${due_date}) back to not sent` });
  }

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
  {
    const name = await projectLabel(project_id);
    await logActivity({ actor: me, group: "note", action: "note_added", projectId: project_id, projectName: name, summary: `${firstName(me.name)} added ${kind === "onboarding" ? "the onboarding" : `a ${kind}`} note to ${name}` });
  }
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
  {
    const { data: n } = await supabaseAdmin.from("project_notes").select("kind, project_id").eq("id", id).maybeSingle();
    const name = n ? await projectLabel(n.project_id as string) : "a project";
    await logActivity({ actor: me, group: "note", action: "note_edited", projectId: (n?.project_id as string | undefined) ?? null, projectName: name, summary: `${firstName(me.name)} edited ${n?.kind === "onboarding" ? "the onboarding" : `a ${n?.kind ?? ""}`} note on ${name}` });
  }
  refreshNotes();
}

/** Deletes a note, except onboarding notes: those can be edited but never removed. */
export async function deleteNote(formData: FormData) {
  const access = await requirePermission("edit_notes");
  const me = access.user;
  const id = str(formData.get("id"));
  if (!id) return;
  await requireNoteAccess(access, id);

  const { data, error: gErr } = await supabaseAdmin.from("project_notes").select("kind, project_id").eq("id", id).maybeSingle();
  if (gErr) throw new Error(gErr.message);
  if (!data) return;
  if (data.kind === "onboarding") throw new Error("Onboarding notes can be edited but not deleted.");

  const { error } = await supabaseAdmin.from("project_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
  {
    const name = await projectLabel(data.project_id as string);
    await logActivity({ actor: me, group: "note", action: "note_deleted", projectId: data.project_id as string, projectName: name, summary: `${firstName(me.name)} deleted a ${data.kind} note from ${name}` });
  }
  refreshNotes();
}

// ---------------------------------------------------------------------------------------------------------------
// Bulk import from Excel: read the file into preview rows, then create the rows that passed the checks.
// ---------------------------------------------------------------------------------------------------------------

const MAX_IMPORT_ROWS = 500;

async function importContext(access: Access): Promise<ImportContext & { allServices: { id: string; name: string }[] }> {
  const [emps, svc, projs] = await Promise.all([
    supabaseAdmin.from("employees").select("id, name, email").eq("is_active", true),
    supabaseAdmin.from("services").select("id, name"),
    supabaseAdmin.from("projects").select("name, client_name"),
  ]);
  const error = emps.error ?? svc.error ?? projs.error;
  if (error) throw new Error(error.message);
  return {
    employees: (emps.data ?? []) as ImportContext["employees"],
    services: (svc.data ?? []) as ImportContext["services"],
    allServices: (svc.data ?? []) as ImportContext["services"],
    existing: (projs.data ?? []).map((p) => rowKey(p.name as string, p.client_name as string)),
    canPay: access.can("payments"),
    today: todayISO(),
  };
}

/** Text of an Excel cell, whatever it holds (plain text, a link, formatted text, a formula result). */
function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("result" in o) return o.result instanceof Date ? o.result : String(o.result ?? "");
    if ("text" in o) return String(o.text ?? "");
    return "";
  }
  return String(v);
}

export async function parseProjectsFile(formData: FormData): Promise<{ ok: true; rows: ImportRow[]; blank: number } | { ok: false; error: string }> {
  try {
    const access = await requirePermission("manage_projects");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an Excel file (.xlsx) first." };
    if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: "That isn't an .xlsx file. Save the sheet as Excel Workbook (.xlsx) and try again." };
    if (file.size > 2_000_000) return { ok: false, error: "That file is too large (2 MB at most)." };

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet("Projects") ?? wb.worksheets[0];
    if (!ws) return { ok: false, error: "The file has no sheets." };

    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => (headers[col] = String(cellValue(cell.value) instanceof Date ? "" : cellValue(cell.value)).trim()));
    if (!headers.some((h) => /project/i.test(h ?? ""))) return { ok: false, error: "Couldn't find a “Project name” column in the first row. Use the template." };

    const ctx = await importContext(access);
    const rows: ImportRow[] = [];
    let blank = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
      const cells: Record<string, unknown> = {};
      let any = false;
      headers.forEach((h, col) => {
        if (!h) return;
        const v = cellValue(ws.getRow(r).getCell(col).value);
        if (v instanceof Date || String(v).trim()) any = true;
        cells[h] = v;
      });
      if (!any) { blank++; continue; }
      if (rows.length >= MAX_IMPORT_ROWS) return { ok: false, error: `That's more than ${MAX_IMPORT_ROWS} projects. Split the file and import it in parts.` };
      rows.push(rowFromCells(cells, ctx));
    }
    if (rows.length === 0) return { ok: false, error: "The sheet has no projects in it (only the header row)." };
    return { ok: true, rows, blank };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `Couldn't read that file. ${e.message}` : "Couldn't read that file." };
  }
}

/**
 * Creates the projects that pass the checks, one at a time, through the same code as the New project form (but
 * without Teams messages, and with a single line in the activity log). Returns what happened to each row.
 */
export async function importProjects(rows: ImportRow[]): Promise<{ ok: boolean; error?: string }[]> {
  const access = await requirePermission("manage_projects");
  if (!Array.isArray(rows) || rows.length === 0) return [];
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} projects at a time.`);

  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const list_ = (v: unknown) => (Array.isArray(v) ? v.map(text) : []);
  const clean: ImportRow[] = rows.map((r) => ({
    name: text(r.name), client: text(r.client), website: text(r.website), onboarded: text(r.onboarded), reporting: text(r.reporting),
    services: list_(r.services).map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean), managerId: text(r.managerId), managerRaw: text(r.managerRaw),
    teamIds: list_(r.teamIds), teamRaw: list_(r.teamRaw), notes: text(r.notes), payDate: text(r.payDate), amount: text(r.amount), term: text(r.term),
    method: text(r.method), collectedUpTo: text(r.collectedUpTo),
  }));

  const ctx = await importContext(access);
  const problems = validateRows(clean, ctx);
  const results: { ok: boolean; error?: string }[] = [];
  let created = 0;
  for (let i = 0; i < clean.length; i++) {
    const first = Object.values(problems[i])[0];
    if (first) { results.push({ ok: false, error: first }); continue; }
    try {
      const fd = new FormData();
      for (const f of rowToFields(clean[i], ctx.canPay)) fd.append(f.name, f.value);
      for (const name of clean[i].services) {
        const known = ctx.allServices.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (known) fd.append("services", known.id);
        else fd.append("new_services", name);
      }
      await createProjectCore(access, fd, { notify: false, log: false, paymentOptional: true });
      results.push({ ok: true });
      created++;
      ctx.existing.push(rowKey(clean[i].name, clean[i].client));
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  if (created > 0) {
    await logActivity({ actor: access.user, group: "project", action: "projects_imported", summary: `${firstName(access.user.name)} imported ${created} ${created === 1 ? "project" : "projects"} from Excel${created < clean.length ? ` (${clean.length - created} skipped)` : ""}` });
  }
  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/");
  return results;
}

// ---------------------------------------------------------------------------------------------------------------
// Permanently deleting a project (admins only): a warning with what will go, the project's name typed back, and a
// one-time code emailed to the admin. The code is made for this one project, so a login code can't be used here.
// ---------------------------------------------------------------------------------------------------------------

const deleteCodeHash = (email: string, projectId: string, code: string) => hashCode(email, `delete:${projectId}:${code}`);

/** What deleting this project would remove, for the warning. */
export async function getDeleteSummary(projectId: string): Promise<{ ok: true; name: string; client: string; payments: number; paid: number; paidTotal: string; reports: number; notes: number; statusChanges: number; teamHistory: number; activity: number } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const count = async (table: string, col = "project_id") => (await supabaseAdmin.from(table).select("*", { count: "exact", head: true }).eq(col, projectId)).count ?? 0;
    const [{ data: p }, { data: dues }, reports, notes, statusChanges, teamHistory, activity] = await Promise.all([
      supabaseAdmin.from("projects").select("name, client_name").eq("id", projectId).maybeSingle(),
      supabaseAdmin.from("payment_dues").select("amount_usd, status").eq("project_id", projectId),
      count("report_log"), count("project_notes"), count("project_status_log"), count("project_team_history"), count("activity_log"),
    ]);
    if (!p) return { ok: false, error: "Project not found." };
    const paid = (dues ?? []).filter((d) => d.status === "paid");
    return {
      ok: true, name: p.name as string, client: p.client_name as string, payments: (dues ?? []).length, paid: paid.length,
      paidTotal: formatUSD(paid.reduce((sum, d) => sum + Number(d.amount_usd ?? 0), 0)), reports, notes, statusChanges, teamHistory, activity,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** Emails the admin a code that allows deleting this one project. */
export async function requestDeleteCode(projectId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { user } = await requireAdmin();
    const { data: p } = await supabaseAdmin.from("projects").select("name").eq("id", projectId).maybeSingle();
    if (!p) return { ok: false, message: "Project not found." };
    const code = generateCode();
    const { data, error } = await supabaseAdmin.rpc("login_issue_code", { p_email: user.email, p_code_hash: deleteCodeHash(user.email, projectId, code), p_ip: null });
    if (error) return { ok: false, message: "Something went wrong. Please try again." };
    if (data === "limited") return { ok: false, message: "A code was just sent. Wait a minute before asking for another." };
    if (data !== "sent") return { ok: false, message: "Couldn't send a code to your account." };
    const sent = await sendEmail([user.email], `[PMO] Code to delete ${p.name}: ${code}`, `Your code to permanently delete the project "${p.name}" is ${code}\n\nIt works once and expires in 10 minutes. If you did not ask to delete a project, ignore this email and make sure nobody else has access to your account.\n`);
    if (!sent.ok && process.env.NODE_ENV === "production") return { ok: false, message: `We couldn't send the email. ${sent.detail ?? ""}` };
    return { ok: true, message: `We emailed a 6-digit code to ${user.email}. It expires in 10 minutes.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** Deletes the project and everything linked to it, once the name and the emailed code are right. */
export async function deleteProject(input: { projectId: string; typedName: string; code: string; eraseActivity: boolean }): Promise<{ ok: boolean; message: string }> {
  try {
    const { user } = await requireAdmin();
    const summary = await getDeleteSummary(input.projectId);
    if (!summary.ok) return { ok: false, message: summary.error };
    if (input.typedName.trim() !== summary.name) return { ok: false, message: "The name you typed doesn't match the project's name." };
    const code = input.code.replace(/\s/g, "");
    if (!isCodeShape(code)) return { ok: false, message: "Enter the 6-digit code from the email." };

    const { data: who, error: cErr } = await supabaseAdmin.rpc("login_check_code", { p_email: user.email, p_code_hash: deleteCodeHash(user.email, input.projectId, code) });
    if (cErr) return { ok: false, message: "Something went wrong. Please try again." };
    if (!who) return { ok: false, message: "That code is wrong or has expired. Ask for a new one if needed." };

    if (input.eraseActivity) await supabaseAdmin.from("activity_log").delete().eq("project_id", input.projectId);
    const { error } = await supabaseAdmin.from("projects").delete().eq("id", input.projectId);
    if (error) return { ok: false, message: error.message };

    await logActivity({
      actor: user, group: "project", action: "project_deleted", projectName: summary.name,
      summary: `${firstName(user.name)} permanently deleted the project ${summary.name} (${summary.client}), with ${summary.payments} ${summary.payments === 1 ? "payment" : "payments"}, ${summary.reports} report ${summary.reports === 1 ? "record" : "records"} and ${summary.notes} ${summary.notes === 1 ? "note" : "notes"}${input.eraseActivity ? ", and erased its earlier activity" : ""}`,
    });
    revalidatePath("/");
    revalidatePath("/projects");
    revalidatePath("/payments");
    revalidatePath("/onboarding");
    return { ok: true, message: `${summary.name} was deleted.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
