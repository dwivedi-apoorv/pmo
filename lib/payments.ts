import { formatMoney } from "@/lib/currency";
import { addDays, lastOccurrenceOnOrBefore, nextOccurrence, todayISO } from "@/lib/reporting";

export const PAYMENT_TERMS = [
  { value: "one_off", label: "One-off" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly (every 3 months)" },
  { value: "biannual", label: "Biannual (every 6 months)" },
] as const;

export const PAYMENT_METHODS = [
  { value: "subscription", label: "Subscription (auto-charge)" },
  { value: "stripe_link", label: "Stripe link" },
  { value: "bank_wire", label: "Bank wire" },
] as const;

export type PaymentTerm = (typeof PAYMENT_TERMS)[number]["value"];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

export const isPaymentTerm = (v: string): v is PaymentTerm => PAYMENT_TERMS.some((t) => t.value === v);
export const isPaymentMethod = (v: string): v is PaymentMethod => PAYMENT_METHODS.some((m) => m.value === v);

const SHORT_TERM: Record<PaymentTerm, string> = {
  one_off: "One-off",
  monthly: "Monthly",
  quarterly: "Quarterly",
  biannual: "Biannual",
};
const SHORT_METHOD: Record<PaymentMethod, string> = {
  subscription: "Subscription",
  stripe_link: "Stripe link",
  bank_wire: "Bank wire",
};
export const termLabel = (t: PaymentTerm | null) => (t ? SHORT_TERM[t] : "");
export const methodLabel = (m: PaymentMethod | null) => (m ? SHORT_METHOD[m] : "");

const STEP_MONTHS = { monthly: 1, quarterly: 3, biannual: 6 } as const;

export type PaymentPlan = {
  payment_date: string | null;
  payment_term: PaymentTerm | null;
  payment_method: PaymentMethod | null;
  payment_amount_usd: number | null; // in the project's currency (the column keeps its old name)
  currency?: string | null; // USD unless the project is billed in another currency
};

/** Next payment due on/after today, or null (no plan, or a one-off that has passed). */
export function nextPaymentDate(p: Pick<PaymentPlan, "payment_date" | "payment_term">, today = todayISO()) {
  if (!p.payment_date || !p.payment_term) return null;
  if (p.payment_term === "one_off") return p.payment_date >= today ? p.payment_date : null;
  return nextOccurrence(p.payment_date, STEP_MONTHS[p.payment_term], today);
}

/** How many days ahead a payment shows as "due soon". Manual methods need lead time. */
export const paymentWindowDays = (method: PaymentMethod | null) => (method === "subscription" ? 3 : 7);

export const formatUSD = (n: number | null) => formatMoney(n, "USD");

/** The most recent payment date before today and the next one on/after today (either can be null). */
export function paymentSchedule(
  p: Pick<PaymentPlan, "payment_date" | "payment_term">,
  today = todayISO()
): { prev: string | null; next: string | null } {
  if (!p.payment_date || !p.payment_term) return { prev: null, next: null };
  if (p.payment_term === "one_off") {
    return p.payment_date < today ? { prev: p.payment_date, next: null } : { prev: null, next: p.payment_date };
  }
  const step = STEP_MONTHS[p.payment_term];
  return {
    prev: lastOccurrenceOnOrBefore(p.payment_date, step, addDays(today, -1)),
    next: nextOccurrence(p.payment_date, step, today),
  };
}

/** Key for a scheduled payment, used to look up whether it has been marked paid. */
export const paymentKey = (projectId: string, dueDate: string) => `${projectId}|${dueDate}`;

/** Every payment date for a plan that falls between `start` and `end` (inclusive). */
export function paymentDatesBetween(
  p: Pick<PaymentPlan, "payment_date" | "payment_term">,
  start: string,
  end: string
): string[] {
  if (!p.payment_date || !p.payment_term) return [];
  if (p.payment_term === "one_off") return p.payment_date >= start && p.payment_date <= end ? [p.payment_date] : [];

  const step = STEP_MONTHS[p.payment_term];
  const dates: string[] = [];
  let d = nextOccurrence(p.payment_date, step, start);
  while (d <= end && dates.length < 60) {
    dates.push(d);
    d = nextOccurrence(p.payment_date, step, addDays(d, 1));
  }
  return dates;
}

/** The current month and the next `count - 1`, each with its first and last day. */
export function projectionMonths(today: string, count: number) {
  const y0 = Number(today.slice(0, 4));
  const m0 = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) => {
    const y = y0 + Math.floor((m0 + i) / 12);
    const m = (m0 + i) % 12;
    const mm = String(m + 1).padStart(2, "0");
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return {
      key: `${y}-${mm}`,
      label: new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
      start: `${y}-${mm}-01`,
      end: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
    };
  });
}
