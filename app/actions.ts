"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isPaymentMethod, isPaymentTerm } from "@/lib/payments";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
// "" and "none" (the select's "— None —" option) both mean no project manager
const pmId = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s && s !== "none" ? s : null;
};

// Accept "example.com" as well as "https://example.com"
const normalizeUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

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
