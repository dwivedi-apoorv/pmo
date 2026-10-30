// Money in more than one currency. Amounts are never converted: each is shown in its own currency, and totals are
// kept per currency ("$4,200.00 USD and CA$1,800.00 CAD").

export const DEFAULT_CURRENCY = "USD";

/** A real ISO currency code like USD or CAD (capital letters, and one the browser/server knows). */
export function isCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    const known = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency");
    return known ? known.includes(code) : true;
  } catch {
    return true;
  }
}

/** What someone typed ("cad ", "Cad") as a code, or "" if it isn't one. */
export const normalizeCurrency = (v: string) => {
  const code = v.trim().toUpperCase();
  return isCurrencyCode(code) ? code : "";
};

/** 800 + "CAD" -> "CA$800.00"; 500 + "USD" -> "$500.00". */
export function formatMoney(n: number | null | undefined, code: string | null | undefined = DEFAULT_CURRENCY): string {
  if (n === null || n === undefined) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code || DEFAULT_CURRENCY }).format(n);
}

/** Money per currency code, for example { USD: 4200, CAD: 1800 }. */
export type Totals = Record<string, number>;

export const addTo = (t: Totals, code: string | null | undefined, amount: number) => {
  const c = code || DEFAULT_CURRENCY;
  t[c] = (t[c] ?? 0) + amount;
  return t;
};

export const sumByCurrency = <T,>(items: T[], pick: (item: T) => { currency?: string | null; amount: number }): Totals => {
  const totals: Totals = {};
  for (const it of items) {
    const { currency, amount } = pick(it);
    addTo(totals, currency, amount);
  }
  return totals;
};

/** USD first, then the others A to Z. */
export const currencyOrder = (codes: string[]) => [...codes].sort((a, b) => (a === DEFAULT_CURRENCY ? -1 : b === DEFAULT_CURRENCY ? 1 : a.localeCompare(b)));

/**
 * "$4,200.00", or with several currencies "$4,200.00 USD + CA$1,800.00 CAD". A currency with nothing in it is left out
 * (unless every one is zero, which shows $0.00 so a total is never blank).
 */
export function formatTotals(t: Totals, ensure: string[] = [DEFAULT_CURRENCY]): string {
  const codes = currencyOrder(Object.keys(t).filter((c) => Math.abs(t[c]) > 0.004));
  if (codes.length === 0) return formatMoney(0, ensure[0] ?? DEFAULT_CURRENCY);
  if (codes.length === 1) return formatMoney(t[codes[0]], codes[0]);
  return codes.map((c) => `${formatMoney(t[c], c)} ${c}`).join(" + ");
}

/** Per-currency subtraction (a - b). */
export function minusTotals(a: Totals, b: Totals): Totals {
  const out: Totals = { ...a };
  for (const [c, v] of Object.entries(b)) out[c] = (out[c] ?? 0) - v;
  return out;
}
