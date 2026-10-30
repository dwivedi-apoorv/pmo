import { NextResponse } from "next/server";
import { limitTo, getAccess } from "@/lib/access";
import { firstName, logActivity } from "@/lib/activity";
import { attentionRows, overdueSince, type Due } from "@/lib/dues";
import { buildWorkbook, dateCell, type Cell } from "@/lib/export-projects";
import { loadPeople } from "@/lib/people";
import { methodLabel, nextPaymentDate, termLabel, type PaymentPlan } from "@/lib/payments";
import { reportAttention, type ReportSend } from "@/lib/reports";
import { nextReportDate, todayISO } from "@/lib/reporting";
import { riskByProject } from "@/lib/risk";
import { servicesOf, type WithServices } from "@/lib/services";
import { STATUS_LABEL, isProjectStatus, type ProjectStatus } from "@/lib/status";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Row = {
  id: string; name: string; client_name: string; website: string | null; onboarding_date: string; reporting_date: string; created_at: string;
  status: ProjectStatus; project_manager_id: string | null;
  project_assignments: { employees: { name: string } | { name: string }[] | null }[];
} & PaymentPlan & WithServices;

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

// Downloads the projects as an Excel file: the same ones, in the same order, as the Projects page shows with
// its current tab, search and filters. Payment columns are left out for people who can't see payments.
export async function GET(request: Request) {
  const access = await getAccess();
  if (!access) return new NextResponse("Please sign in.", { status: 401 });
  const canPay = access.can("payments");
  const sp = new URL(request.url).searchParams;
  const tab = sp.get("status") === "all" ? "all" : isProjectStatus(sp.get("status") ?? "") ? (sp.get("status") as ProjectStatus) : "active";
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const service = (sp.get("service") ?? "").trim().toLowerCase();
  const riskOnly = sp.get("risk") === "1";
  const sort = sp.get("sort") ?? "name";
  const dir = sp.get("dir") === "desc" ? -1 : 1;
  const today = todayISO();
  const { scope } = access;

  const [projectsRes, people, ledgerRes, sendsRes, logRes, notesRes] = await Promise.all([
    limitTo(
      supabase.from("projects").select(
        "id, name, client_name, website, onboarding_date, reporting_date, created_at, status, project_manager_id, payment_date, payment_term, payment_method, payment_amount_usd, currency, project_assignments(employees(name)), project_services(services(id, name))"
      ),
      scope,
      "id"
    ).returns<Row[]>(),
    loadPeople(),
    canPay ? limitTo(supabase.from("payment_dues").select("project_id, due_date, amount_usd, currency, term, method, status, paid_at"), scope).returns<Due[]>() : Promise.resolve({ data: [] as Due[], error: null }),
    limitTo(supabase.from("report_log").select("project_id, due_date, sent_at"), scope).returns<ReportSend[]>(),
    limitTo(supabase.from("project_status_log").select("project_id, status, reason, changed_at").order("changed_at", { ascending: false }), scope).returns<{ project_id: string; status: string; reason: string | null; changed_at: string }[]>(),
    limitTo(supabase.from("project_notes").select("project_id, body").eq("kind", "onboarding"), scope).returns<{ project_id: string; body: string }[]>(),
  ]);
  const error = projectsRes.error ?? people.error ?? ledgerRes.error ?? sendsRes.error ?? logRes.error ?? notesRes.error;
  if (error) return new NextResponse(`Could not load the projects: ${error.message}`, { status: 500 });

  const ledger = ledgerRes.data ?? [];
  const all = (projectsRes.data ?? []).map((p) => (canPay ? p : { ...p, payment_date: null, payment_term: null, payment_method: null, payment_amount_usd: null }));
  const nameOf = new Map(people.people.map((e) => [e.id, e.name]));
  const lastChange = new Map<string, { status: string; reason: string | null; changed_at: string }>();
  for (const r of logRes.data ?? []) if (!lastChange.has(r.project_id)) lastChange.set(r.project_id, r);
  const notes = new Map((notesRes.data ?? []).map((n) => [n.project_id, n.body]));

  // Same filters as the page: tab, "at risk", service, search.
  const active = all.filter((p) => p.status === "active");
  const risk = riskByProject(new Set(active.map((p) => p.id)), attentionRows(active, ledger), reportAttention(active, sendsRes.data ?? [], today));
  const team = (p: Row) => p.project_assignments.flatMap((a) => (Array.isArray(a.employees) ? a.employees[0] : a.employees)?.name ?? []).sort();
  const picked = all.filter((p) => {
    if (tab !== "all" && p.status !== tab) return false;
    if (riskOnly && !risk.has(p.id)) return false;
    if (service && !servicesOf(p).some((x) => x.name.toLowerCase() === service)) return false;
    if (q) {
      const hay = [p.name, p.client_name, p.website ?? "", termLabel(p.payment_term), methodLabel(p.payment_method), nameOf.get(p.project_manager_id ?? "") ?? "", ...team(p), STATUS_LABEL[p.status], lastChange.get(p.id)?.reason ?? "", ...servicesOf(p).map((x) => x.name)].join(" ").toLowerCase();
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const key = (p: Row): string | number =>
    sort === "client" ? p.client_name
    : sort === "website" ? (p.website ?? "")
    : sort === "onboarded" ? p.onboarding_date
    : sort === "manager" ? (nameOf.get(p.project_manager_id ?? "") ?? "")
    : sort === "assigned" ? p.project_assignments.length
    : sort === "payment" ? (nextPaymentDate(p) ?? "9999-12-31")
    : sort === "reporting" ? nextReportDate(p.reporting_date)
    : p.name;
  picked.sort((a, b) => {
    const ka = key(a), kb = key(b);
    const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
    return (c || a.name.localeCompare(b.name)) * dir;
  });

  const headers = ["Project", "Client", "Website", "Status", "Status since", "Status reason", "Services", "Onboarded", "Report day", "Next report", "Project manager", "Team", "Onboarding notes",
    ...(canPay ? ["Payment amount", "Currency", "Payment term", "Payment method", "First payment", "Next payment", "Overdue since"] : [])];
  const rows: Cell[][] = picked.map((p) => {
    const change = lastChange.get(p.id);
    const isActive = p.status === "active";
    const base: Cell[] = [
      p.name, p.client_name, p.website, STATUS_LABEL[p.status],
      p.status === "active" ? null : dateCell(change?.changed_at ? new Date(change.changed_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null),
      p.status === "active" ? null : (change?.reason ?? null),
      servicesOf(p).map((x) => x.name).join(", "), dateCell(p.onboarding_date),
      `Monthly, on the ${ordinal(Number(p.reporting_date.slice(8, 10)))}`, isActive ? dateCell(nextReportDate(p.reporting_date)) : null,
      nameOf.get(p.project_manager_id ?? "") ?? null, team(p).join(", "), notes.get(p.id) ?? null,
    ];
    if (!canPay) return base;
    return [...base, p.payment_amount_usd === null ? null : Number(p.payment_amount_usd), p.payment_amount_usd === null ? null : (p.currency || "USD"), termLabel(p.payment_term) || null, methodLabel(p.payment_method) || null,
      dateCell(p.payment_date), isActive ? dateCell(nextPaymentDate(p)) : null, dateCell(overdueSince({ ...p, active: isActive }, ledger, today))];
  });

  const file = await buildWorkbook("Projects", headers, rows);
  await logActivity({ actor: access.user, group: "project", action: "projects_exported", summary: `${firstName(access.user.name)} exported ${rows.length} ${rows.length === 1 ? "project" : "projects"} to Excel` });
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="projects-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
