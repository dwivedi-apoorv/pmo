"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isPaymentMethod, isPaymentTerm, projectionMonths } from "@/lib/payments";
import { backfillPaidPayments, openDuesForMonth } from "@/lib/open-dues";
import { todayISO } from "@/lib/reporting";
import { isProjectStatus, reasonRequired } from "@/lib/status";

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

async function runBackfill(projectId: string, payment: ReturnType<typeof parsePayment>, until: string | null) {
  if (!until) return;
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

export async function createProject(formData: FormData) {
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
  const payment = parsePayment(formData);
  const backfillUntil = parseBackfill(formData, payment.payment_date);

  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert({
      name,
      client_name,
      website: normalizeUrl(websiteRaw),
      onboarding_date,
      reporting_date,
      project_manager_id,
      ...payment,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (assignees.length) {
    const { error: aErr } = await supabaseAdmin
      .from("project_assignments")
      .insert(assignees.map((employee_id) => ({ project_id: data.id, employee_id })));
    if (aErr) throw new Error(aErr.message);
  }

  await runBackfill(data.id, payment, backfillUntil);
  revalidatePath("/payments");

  revalidatePath("/");
}

export async function updateProject(formData: FormData) {
  const project_id = str(formData.get("project_id"));
  const name = str(formData.get("name"));
  const client_name = str(formData.get("client_name"));
  const websiteRaw = str(formData.get("website"));
  const onboarding_date = str(formData.get("onboarding_date"));
  const reporting_date = str(formData.get("reporting_date"));

  if (!project_id || !name || !client_name || !websiteRaw || !onboarding_date || !reporting_date) {
    throw new Error("Name, client, website, onboarding date and reporting date are required.");
  }
  const payment = parsePayment(formData);
  const backfillUntil = parseBackfill(formData, payment.payment_date);

  const { error } = await supabaseAdmin
    .from("projects")
    .update({
      name,
      client_name,
      website: normalizeUrl(websiteRaw),
      onboarding_date,
      reporting_date,
      project_manager_id: pmId(formData.get("project_manager_id")),
      ...payment,
    })
    .eq("id", project_id);
  if (error) throw new Error(error.message);

  // Sync assignees: remove the unticked, add the newly ticked.
  const wanted = new Set(formData.getAll("assignees").map(String).filter(Boolean));
  const { data: current, error: cErr } = await supabaseAdmin
    .from("project_assignments")
    .select("employee_id")
    .eq("project_id", project_id);
  if (cErr) throw new Error(cErr.message);

  const have = new Set((current ?? []).map((r) => r.employee_id as string));
  const toRemove = [...have].filter((id) => !wanted.has(id));
  const toAdd = [...wanted].filter((id) => !have.has(id));

  if (toRemove.length) {
    const { error: dErr } = await supabaseAdmin
      .from("project_assignments")
      .delete()
      .eq("project_id", project_id)
      .in("employee_id", toRemove);
    if (dErr) throw new Error(dErr.message);
  }
  if (toAdd.length) {
    const { error: iErr } = await supabaseAdmin
      .from("project_assignments")
      .insert(toAdd.map((employee_id) => ({ project_id, employee_id })));
    if (iErr) throw new Error(iErr.message);
  }

  await runBackfill(project_id, payment, backfillUntil);
  revalidatePath("/payments");
  revalidatePath("/");
}

export async function createEmployee(formData: FormData) {
  const name = str(formData.get("name"));
  const email = str(formData.get("email")).toLowerCase();
  const roleRaw = str(formData.get("role"));

  if (!name || !email || !roleRaw) throw new Error("Name, email and role are required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");

  // Reuse an existing role's exact spelling ("project manager" -> "Project Manager")
  const { data: existing, error: rErr } = await supabaseAdmin.from("employees").select("role");
  if (rErr) throw new Error(rErr.message);
  const role =
    (existing ?? []).map((r) => r.role as string | null).find((r) => r?.toLowerCase() === roleRaw.toLowerCase()) ??
    roleRaw;

  const { error } = await supabaseAdmin.from("employees").insert({ name, email, role });
  if (error) {
    if (error.code === "23505") throw new Error("An employee with this email already exists.");
    throw new Error(error.message);
  }

  revalidatePath("/");
}

export async function deactivateEmployee(formData: FormData) {
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
  const employee_id = str(formData.get("employee_id"));
  if (!employee_id) return;

  const { error } = await supabaseAdmin.from("employees").update({ is_active: true }).eq("id", employee_id);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/people");
}

export async function deleteEmployee(formData: FormData) {
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
  const project_id = str(formData.get("project_id"));
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
  const project_id = str(formData.get("project_id"));
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
  const project_id = str(formData.get("project_id"));
  const status = str(formData.get("status"));
  const reason = str(formData.get("reason"));

  if (!project_id || !isProjectStatus(status)) throw new Error("Missing project or status.");
  if (reasonRequired(status) && !reason) throw new Error("Please give a reason.");

  // One database step updates the status and writes the history row, so they can't drift apart.
  const { error } = await supabaseAdmin.rpc("set_project_status", {
    p_project: project_id,
    p_status: status,
    p_reason: reason || null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath("/people");
}
