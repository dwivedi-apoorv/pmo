import { supabaseAdmin } from "@/lib/supabase-admin";
import { paymentDatesBetween, type PaymentPlan } from "@/lib/payments";
import { backfillDates } from "@/lib/backfill";
import { todayISO } from "@/lib/reporting";

/**
 * Opens the month's dues: for every ACTIVE project, a 'due' ledger row for each payment its plan
 * schedules between `start` and `end`. Safe to run any number of times - payments that already have a
 * row (due or paid) are left untouched. Server-only (uses the service-role key).
 */
export async function openDuesForMonth(month: { start: string; end: string }) {
  const { data: projects, error } = await supabaseAdmin
    .from("projects")
    .select("id, payment_date, payment_term, payment_method, payment_amount_usd")
    .eq("status", "active")
    .not("payment_date", "is", null);
  if (error) throw new Error(error.message);

  const rows = (projects ?? []).flatMap((p) =>
    paymentDatesBetween(p, month.start, month.end).map((due_date) => ({
      project_id: p.id as string,
      due_date,
      amount_usd: (p.payment_amount_usd as number | null) ?? 0,
      term: p.payment_term as string | null,
      method: p.payment_method as string | null,
      status: "due" as const,
      source: "cron" as const,
    }))
  );
  if (rows.length === 0) return { projects: projects?.length ?? 0, scheduled: 0, created: 0 };

  // ignoreDuplicates = ON CONFLICT DO NOTHING; only newly inserted rows come back.
  const { data: inserted, error: upErr } = await supabaseAdmin
    .from("payment_dues")
    .upsert(rows, { onConflict: "project_id,due_date", ignoreDuplicates: true })
    .select("project_id");
  if (upErr) throw new Error(upErr.message);

  return { projects: projects?.length ?? 0, scheduled: rows.length, created: inserted?.length ?? 0 };
}

/**
 * Records every payment of a plan from its first date up to `until` as already PAID (source
 * 'backfill'), for projects that started before the app was used. Payments that already have a ledger
 * row are left alone, so it is safe to run more than once. Server-only.
 */
export async function backfillPaidPayments(projectId: string, plan: PaymentPlan, until: string) {
  const dates = backfillDates(
    { payment_date: plan.payment_date ?? "", payment_term: plan.payment_term },
    until,
    todayISO()
  );
  if (dates.length === 0) return { created: 0 };

  const rows = dates.map((due_date) => ({
    project_id: projectId,
    due_date,
    amount_usd: plan.payment_amount_usd ?? 0,
    term: plan.payment_term,
    method: plan.payment_method,
    status: "paid" as const,
    paid_at: `${due_date}T12:00:00+05:30`, // assume it was paid on the due date
    source: "backfill" as const,
  }));

  const { data, error } = await supabaseAdmin
    .from("payment_dues")
    .upsert(rows, { onConflict: "project_id,due_date", ignoreDuplicates: true })
    .select("project_id");
  if (error) throw new Error(error.message);
  return { created: data?.length ?? 0 };
}
