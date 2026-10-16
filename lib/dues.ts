import { daysUntil, todayISO } from "@/lib/reporting";
import {
  paymentDatesBetween,
  paymentKey,
  paymentSchedule,
  paymentWindowDays,
  type PaymentMethod,
  type PaymentPlan,
  type PaymentTerm,
} from "@/lib/payments";

// The payment ledger. A row exists for every payment that has been opened (by the monthly job, or
// by marking a payment paid). Rows are never removed when a project is halted or ended.
export type Due = {
  project_id: string;
  due_date: string;
  amount_usd: number;
  term: PaymentTerm | null;
  method: PaymentMethod | null;
  status: "due" | "paid";
  paid_at: string | null;
};

/** An active project with its payment plan. */
export type PlanProject = { id: string } & PaymentPlan;

export type AttentionRow = {
  project_id: string;
  due: string;
  days: number; // negative = overdue
  amount: number;
  term: PaymentTerm | null;
  method: PaymentMethod | null;
};

const index = (ledger: Due[]) => new Map(ledger.map((d) => [paymentKey(d.project_id, d.due_date), d]));

/**
 * Payments that need action, most overdue first:
 *  - every UNPAID ledger row that is overdue or inside its method's window, whatever the project's
 *    status (a halted or ended project that hasn't paid still owes the money), and
 *  - for ACTIVE projects, scheduled payments with no ledger row yet (the monthly job hasn't opened
 *    them), so nothing is missed between runs or before the first run.
 */
export function attentionRows(active: PlanProject[], ledger: Due[], today = todayISO()): AttentionRow[] {
  const byKey = index(ledger);
  const rows: AttentionRow[] = [];

  for (const d of ledger) {
    if (d.status !== "due") continue;
    const days = daysUntil(d.due_date, today);
    if (days <= paymentWindowDays(d.method)) {
      rows.push({ project_id: d.project_id, due: d.due_date, days, amount: d.amount_usd, term: d.term, method: d.method });
    }
  }

  for (const p of active) {
    const { prev, next } = paymentSchedule(p, today);
    const window = paymentWindowDays(p.payment_method);
    const row = (due: string): AttentionRow => ({
      project_id: p.id,
      due,
      days: daysUntil(due, today),
      amount: p.payment_amount_usd ?? 0,
      term: p.payment_term,
      method: p.payment_method,
    });
    if (prev && !byKey.has(paymentKey(p.id, prev))) rows.push(row(prev));
    if (next && !byKey.has(paymentKey(p.id, next)) && daysUntil(next, today) <= window) rows.push(row(next));
  }

  return rows.sort((a, b) => a.days - b.days || a.project_id.localeCompare(b.project_id));
}

/** The date a project's oldest unpaid, overdue payment was due, or null. */
export function overdueSince(
  project: { id: string; active: boolean } & Pick<PaymentPlan, "payment_date" | "payment_term">,
  ledger: Due[],
  today = todayISO()
): string | null {
  const byKey = index(ledger);
  const dates = ledger
    .filter((d) => d.project_id === project.id && d.status === "due" && d.due_date < today)
    .map((d) => d.due_date);
  if (project.active) {
    const { prev } = paymentSchedule(project, today);
    if (prev && !byKey.has(paymentKey(project.id, prev))) dates.push(prev);
  }
  return dates.length ? dates.sort()[0] : null;
}

export type ProjectionItem = { project_id: string; project: string; date: string; amount: number; paid: boolean };

/**
 * Everything that belongs to one month of the revenue view:
 *  - every ledger row due in the month (real amounts, any project status, paid or not), plus
 *  - if `includeUnopened`, scheduled payments of ACTIVE projects the ledger hasn't opened yet. That is
 *    right for the current month; for past months only real ledger rows are shown.
 * `label` turns a project id into the name shown, e.g. "Acme Store (halted)".
 */
export function monthItems(
  month: { start: string; end: string },
  active: (PlanProject)[],
  ledger: Due[],
  label: (projectId: string) => string,
  includeUnopened = true
): ProjectionItem[] {
  const byKey = index(ledger);
  const fromLedger = ledger
    .filter((d) => d.due_date >= month.start && d.due_date <= month.end)
    .map((d) => ({ project_id: d.project_id, project: label(d.project_id), date: d.due_date, amount: d.amount_usd, paid: d.status === "paid" }));
  const forecast = includeUnopened
    ? active.flatMap((p) =>
        paymentDatesBetween(p, month.start, month.end)
          .filter((date) => !byKey.has(paymentKey(p.id, date)))
          .map((date) => ({ project_id: p.id, project: label(p.id), date, amount: p.payment_amount_usd ?? 0, paid: false }))
      )
    : [];
  return [...fromLedger, ...forecast].sort((a, b) => a.date.localeCompare(b.date) || a.project.localeCompare(b.project));
}
