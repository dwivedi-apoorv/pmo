import { DEFAULT_CURRENCY, isCurrencyCode } from "@/lib/currency";
import { webLink } from "@/lib/notify/project";

// Bulk import of projects from an Excel sheet. Everything here is plain functions (no database), so the
// preview in the browser and the final check on the server run exactly the same rules.

export const TEMPLATE_HEADERS = [
  "Project name",
  "Client name",
  "Website",
  "Onboarding date",
  "Reporting date",
  "Services",
  "Project manager (email)",
  "Team members (emails)",
  "Onboarding notes",
  "First payment date",
  "Payment amount",
  "Payment term",
  "Payment method",
  "Payments collected up to",
] as const;

/** One project as shown (and edited) in the preview. Everything is text so a half-typed value can be shown and fixed. */
export type ImportRow = {
  name: string;
  client: string;
  website: string;
  onboarded: string; // yyyy-mm-dd
  reporting: string; // yyyy-mm-dd
  services: string[]; // names: existing ones, or new ones to create
  managerId: string; // employee id, "" for none
  managerRaw: string; // what the sheet said when it matched nobody (shown as an error until fixed)
  teamIds: string[];
  teamRaw: string[];
  notes: string;
  payDate: string;
  amount: string;
  currency: string; // USD by default; shown in the preview (not a column in the sheet)
  term: string; // one_off | monthly | quarterly | biannual
  method: string; // subscription | stripe_link | bank_wire
  collectedUpTo: string;
};

export const emptyRow = (): ImportRow => ({
  name: "", client: "", website: "", onboarded: "", reporting: "", services: [], managerId: "", managerRaw: "", teamIds: [], teamRaw: [],
  notes: "", payDate: "", amount: "", currency: DEFAULT_CURRENCY, term: "", method: "", collectedUpTo: "",
});

export type ImportContext = {
  employees: { id: string; name: string; email: string | null }[]; // active employees
  services: { id: string; name: string }[];
  existing: string[]; // rowKey of every project already in the app
  currencies: string[]; // the currencies in the list (USD, CAD, ...)
  canPay: boolean; // may this person set payment plans? if not, payment columns are ignored
  today: string;
};

export type RowErrors = Partial<Record<keyof ImportRow, string>>;

export const TERMS = [
  { value: "one_off", label: "One-off" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "biannual", label: "Biannual" },
] as const;
export const METHODS = [
  { value: "subscription", label: "Subscription" },
  { value: "stripe_link", label: "Stripe link" },
  { value: "bank_wire", label: "Bank wire" },
] as const;

const squash = (s: string) => s.trim().replace(/\s+/g, " ");
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Acme Store" and "acme  store " are the same project name. */
export const rowKey = (name: string, client: string) => `${squash(name).toLowerCase()}|${squash(client).toLowerCase()}`;

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** A date from an Excel cell: a real date, "2026-10-05", or day-first "05/10/2026". Anything else is returned as typed. */
export function toISODate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (isDate(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (isDate(iso)) return iso;
  }
  return s;
}

export function normalizeTerm(v: string): string {
  const k = flat(v);
  return k === "oneoff" || k === "onetime" ? "one_off" : TERMS.find((t) => flat(t.value) === k || flat(t.label) === k)?.value ?? squash(v);
}
export function normalizeMethod(v: string): string {
  const k = flat(v);
  return METHODS.find((m) => flat(m.value) === k || flat(m.label) === k)?.value ?? squash(v);
}

const splitList = (v: string) => v.split(/[,;\n]+/).map(squash).filter(Boolean);

/** Turns one sheet row (header -> cell text) into a preview row, matching people and services against what exists. */
export function rowFromCells(cells: Record<string, unknown>, ctx: Pick<ImportContext, "employees" | "services">): ImportRow {
  const get = (...names: string[]) => {
    for (const n of names) {
      const hit = Object.keys(cells).find((k) => flat(k) === flat(n));
      if (hit !== undefined) return cells[hit];
    }
    return "";
  };
  const text = (...n: string[]) => squash(String(get(...n) ?? ""));
  const person = (v: string) => {
    const k = v.toLowerCase();
    return ctx.employees.find((e) => e.email?.toLowerCase() === k) ?? ctx.employees.find((e) => e.name.toLowerCase() === k);
  };

  const mgr = text("Project manager (email)", "Project manager", "Manager", "Manager email");
  const mgrHit = mgr ? person(mgr) : undefined;
  const team = splitList(text("Team members (emails)", "Team members", "Team", "Assigned to"));
  const teamHits = team.map((t) => ({ t, e: person(t) }));
  const services = splitList(text("Services", "Service")).map((n) => ctx.services.find((s) => s.name.toLowerCase() === n.toLowerCase())?.name ?? n);

  return {
    name: text("Project name", "Project", "Name"),
    client: text("Client name", "Client"),
    website: text("Website", "URL", "Site"),
    onboarded: toISODate(get("Onboarding date", "Onboarded", "Onboarded on")),
    reporting: toISODate(get("Reporting date", "Report date", "Reporting day")),
    services: [...new Set(services)],
    managerId: mgrHit?.id ?? "",
    managerRaw: mgr && !mgrHit ? mgr : "",
    teamIds: [...new Set(teamHits.flatMap((h) => (h.e ? [h.e.id] : [])))],
    teamRaw: teamHits.filter((h) => !h.e).map((h) => h.t),
    notes: String(get("Onboarding notes", "Notes") ?? "").trim(),
    payDate: toISODate(get("First payment date", "Payment date")),
    amount: text("Payment amount (USD)", "Payment amount", "Amount").replace(/[$,\s]/g, ""),
    currency: DEFAULT_CURRENCY,
    term: text("Payment term", "Term") ? normalizeTerm(text("Payment term", "Term")) : "",
    method: text("Payment method", "Method") ? normalizeMethod(text("Payment method", "Method")) : "",
    collectedUpTo: toISODate(get("Payments collected up to", "Collected up to")),
  };
}

export const hasPaymentData = (r: ImportRow) => !!(r.payDate || r.amount || r.term || r.method || r.collectedUpTo);

/** What is wrong with each row (an empty object = ready to import). Also catches duplicates, in the app and in the file. */
export function validateRows(rows: ImportRow[], ctx: ImportContext): RowErrors[] {
  const active = new Set(ctx.employees.map((e) => e.id));
  const existing = new Set(ctx.existing);
  const seen = new Set<string>();
  return rows.map((r) => {
    const e: RowErrors = {};
    if (!squash(r.name)) e.name = "Project name is required";
    if (!squash(r.client)) e.client = "Client name is required";
    if (!r.website.trim()) e.website = "Website is required";
    else if (!webLink(r.website)) e.website = "That doesn't look like a web address";
    if (!r.onboarded) e.onboarded = "Onboarding date is required";
    else if (!isDate(r.onboarded)) e.onboarded = "Use a date like 2026-10-05";
    if (!r.reporting) e.reporting = "Reporting date is required";
    else if (!isDate(r.reporting)) e.reporting = "Use a date like 2026-10-05";
    if (r.services.length === 0) e.services = "Choose at least one service";
    else if (r.services.some((s) => s.length > 40)) e.services = "A service name is too long (40 characters at most)";

    if (r.managerRaw) e.managerId = `No active employee matches “${r.managerRaw}”. Pick one`;
    else if (r.managerId && !active.has(r.managerId)) e.managerId = "That employee isn't active";
    if (r.teamRaw.length) e.teamIds = `No active employee matches ${r.teamRaw.map((t) => `“${t}”`).join(", ")}. Pick from the list`;
    else if (r.teamIds.some((id) => !active.has(id))) e.teamIds = "Someone on the team isn't active";

    if (ctx.canPay && r.currency !== DEFAULT_CURRENCY && !hasPaymentData(r) && !isCurrencyCode(r.currency)) e.currency = "Choose a currency, or type a 3-letter code like GBP";
    if (ctx.canPay && hasPaymentData(r)) {
      if (!r.payDate) e.payDate = "First payment date is required";
      else if (!isDate(r.payDate)) e.payDate = "Use a date like 2026-10-05";
      const amount = Number(r.amount);
      if (!r.amount) e.amount = "Amount is required";
      else if (!Number.isFinite(amount) || amount < 0) e.amount = "Enter an amount in USD, like 500";
      if (!isCurrencyCode(r.currency)) e.currency = "Choose a currency, or type a 3-letter code like GBP";
      if (!TERMS.some((t) => t.value === r.term)) e.term = "Choose a term";
      if (!METHODS.some((m) => m.value === r.method)) e.method = "Choose a method";
      if (r.collectedUpTo) {
        if (!isDate(r.collectedUpTo)) e.collectedUpTo = "Use a date like 2026-10-05";
        else if (r.collectedUpTo > ctx.today) e.collectedUpTo = "Can't be in the future";
        else if (isDate(r.payDate) && r.collectedUpTo < r.payDate) e.collectedUpTo = "Is before the first payment date";
      }
    }

    if (!e.name && !e.client) {
      const key = rowKey(r.name, r.client);
      if (existing.has(key)) e.name = "A project with this name and client already exists";
      else if (seen.has(key)) e.name = "This project appears twice in the file";
      seen.add(key);
    }
    return e;
  });
}

/** The row as the form fields the New project form uses, so importing goes through exactly the same code. */
export function rowToFields(r: ImportRow, canPay: boolean): { name: string; value: string }[] {
  const f: { name: string; value: string }[] = [
    { name: "name", value: squash(r.name) },
    { name: "client_name", value: squash(r.client) },
    { name: "website", value: r.website.trim() },
    { name: "onboarding_date", value: r.onboarded },
    { name: "reporting_date", value: r.reporting },
    { name: "project_manager_id", value: r.managerId || "none" },
    { name: "onboarding_notes", value: r.notes },
    ...r.teamIds.map((id) => ({ name: "assignees", value: id })),
  ];
  if (canPay && !hasPaymentData(r) && r.currency !== DEFAULT_CURRENCY) f.push({ name: "currency", value: r.currency });
  if (canPay && hasPaymentData(r)) {
    f.push({ name: "payment_date", value: r.payDate }, { name: "payment_amount_usd", value: r.amount }, { name: "currency", value: r.currency }, { name: "payment_term", value: r.term }, { name: "payment_method", value: r.method });
    if (r.collectedUpTo) f.push({ name: "backfill", value: "1" }, { name: "backfill_until", value: r.collectedUpTo });
  }
  return f;
}
