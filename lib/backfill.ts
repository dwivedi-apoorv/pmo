import { paymentDatesBetween, type PaymentTerm } from "@/lib/payments";
import { addDays } from "@/lib/reporting";

/** The last day of last month, the default "collected up to" date. This month's payment is left to handle normally. */
export const lastMonthEnd = (today: string) => addDays(`${today.slice(0, 8)}01`, -1);

/** True when the first payment date is before this month, i.e. there are earlier months to back-fill. */
export const hasEarlierMonths = (paymentDate: string, today: string) => !!paymentDate && paymentDate < `${today.slice(0, 8)}01`;

/**
 * The payments a back-fill would record as paid: every payment from the first payment date up to and
 * including `until` (never later than today). Used for the live preview in the form and by the server,
 * so what you see is exactly what gets saved.
 */
export function backfillDates(
  plan: { payment_date: string; payment_term: PaymentTerm | null },
  until: string,
  today: string
): string[] {
  if (!plan.payment_date || !plan.payment_term || !until) return [];
  const end = until < today ? until : today;
  if (end < plan.payment_date) return [];
  return paymentDatesBetween(plan, plan.payment_date, end);
}
