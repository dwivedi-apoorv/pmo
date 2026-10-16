import { nextOccurrence, todayISO } from "@/lib/reporting";

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
  payment_amount_usd: number | null;
};

/** Next payment due on/after today, or null (no plan, or a one-off that has passed). */
export function nextPaymentDate(p: Pick<PaymentPlan, "payment_date" | "payment_term">, today = todayISO()) {
  if (!p.payment_date || !p.payment_term) return null;
  if (p.payment_term === "one_off") return p.payment_date >= today ? p.payment_date : null;
  return nextOccurrence(p.payment_date, STEP_MONTHS[p.payment_term], today);
}

/** How many days ahead a payment shows as "due soon". Manual methods need lead time. */
export const paymentWindowDays = (method: PaymentMethod | null) => (method === "subscription" ? 3 : 7);

export const formatUSD = (n: number | null) =>
  n === null ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
