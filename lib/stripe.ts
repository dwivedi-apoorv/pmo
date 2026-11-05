import "server-only";

// Sends invoices through Stripe's API (plain fetch, no SDK). The key is only ever read from the environment.
const API = "https://api.stripe.com/v1";
const key = () => process.env.STRIPE_SECRET_KEY?.trim() || "";

export const stripeConfigured = () => !!key();
/** True for a test key, so invoices sent are test invoices. */
export const stripeTestMode = () => /^(sk|rk)_test_/.test(key());

// Currencies Stripe counts in whole units (no cents). Everything else is in 1/100.
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
export const toMinorUnits = (amount: number, currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100));

type Json = Record<string, any>;

async function call(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, string>, idempotencyKey?: string): Promise<Json> {
  if (!key()) throw new Error("Stripe isn't set up: STRIPE_SECRET_KEY is missing on the server.");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key()}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(`Stripe: ${json?.error?.message ?? `request failed (${res.status})`}`);
  return json;
}

export async function ensureCustomer(existingId: string | null, name: string, email: string, projectId: string): Promise<string> {
  if (existingId) {
    try {
      await call("POST", `/customers/${existingId}`, { name, email }); // keep the name and email current
      return existingId;
    } catch (e) {
      if (!/No such customer/i.test(e instanceof Error ? e.message : "")) throw e;
    }
  }
  const c = await call("POST", "/customers", { name, email, "metadata[project_id]": projectId });
  return c.id as string;
}

export type SentInvoice = { id: string; url: string | null };

/**
 * Creates an invoice for one payment, adds the line, finalizes it and emails it to the client.
 * Stripe emails the client an invoice with a pay-online link. Due in `daysUntilDue` days (Stripe needs one).
 * `recordId` is called as soon as the draft exists, so a half-finished attempt can be found and cleaned up.
 */
export async function createAndSendInvoice(opts: {
  customerId: string; amount: number; currency: string; description: string; projectId: string; dueDate: string; daysUntilDue?: number;
  recordId: (id: string) => Promise<void>;
}): Promise<SentInvoice> {
  const tag = `${opts.projectId}-${opts.dueDate}`;
  const invoice = await call("POST", "/invoices", {
    customer: opts.customerId,
    collection_method: "send_invoice",
    days_until_due: String(opts.daysUntilDue ?? 7),
    auto_advance: "false",
    currency: opts.currency.toLowerCase(),
    "metadata[project_id]": opts.projectId,
    "metadata[invoice_date]": opts.dueDate,
  });
  await opts.recordId(invoice.id);
  await call("POST", "/invoiceitems", {
    customer: opts.customerId,
    invoice: invoice.id,
    amount: String(toMinorUnits(opts.amount, opts.currency)),
    currency: opts.currency.toLowerCase(),
    description: opts.description,
  });
  const finalized = await call("POST", `/invoices/${invoice.id}/finalize`, { auto_advance: "false" });
  await call("POST", `/invoices/${invoice.id}/send`, {});
  return { id: invoice.id as string, url: (finalized.hosted_invoice_url as string | null) ?? null };
}

/** Clears a half-finished earlier attempt: a draft is deleted, an open invoice is voided. Returns false if it was already paid. */
export async function discardInvoice(id: string): Promise<boolean> {
  let inv: Json;
  try {
    inv = await call("GET", `/invoices/${id}`);
  } catch (e) {
    if (/No such invoice/i.test(e instanceof Error ? e.message : "")) return true;
    throw e;
  }
  if (inv.status === "paid") return false;
  if (inv.status === "draft") await call("DELETE", `/invoices/${id}`);
  else if (inv.status === "open" || inv.status === "uncollectible") await call("POST", `/invoices/${id}/void`, {});
  return true;
}
