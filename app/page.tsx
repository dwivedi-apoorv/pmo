import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { loadPeople } from "@/lib/people";
import { addDays, daysUntil, dueLabel, nextReportDate, todayISO } from "@/lib/reporting";
import { formatUSD, projectionMonths, type PaymentPlan } from "@/lib/payments";
import { attentionRows, monthItems } from "@/lib/dues";
import { loadPaymentsData } from "@/lib/payments-data";
import type { EmployeeOption } from "@/components/employee-select";
import { AttentionList } from "@/components/attention-list";
import { PageHeader } from "@/components/page-header";
import { RevenueSummary } from "@/components/revenue-summary";
import { WorkloadCard, type WorkloadRow } from "@/components/workload-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic"; // always show fresh data

type Project = {
  id: string;
  name: string;
  client_name: string;
  website: string | null;
  onboarding_date: string;
  reporting_date: string;
  project_manager_id: string | null;
  project_assignments: { employees: EmployeeOption | null }[];
} & PaymentPlan;

export default async function Home() {
  const month = projectionMonths(todayISO(), 1)[0];
  const [projectsRes, peopleRes, payments, onboardedRes, changesRes] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, client_name, website, onboarding_date, reporting_date, payment_date, payment_term, payment_method, payment_amount_usd, project_manager_id, project_assignments(employees(id, name, role))"
      )
      .eq("status", "active")
      .order("reporting_date", { ascending: true })
      .returns<Project[]>(),
    loadPeople(),
    loadPaymentsData(),
    // Projects onboarded this month, whatever their status now.
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .gte("onboarding_date", month.start)
      .lte("onboarding_date", month.end),
    // Status changes made this month (India time): how many projects were halted or lost (ended).
    supabase
      .from("project_status_log")
      .select("status")
      .gte("changed_at", `${month.start}T00:00:00+05:30`)
      .lt("changed_at", `${addDays(month.end, 1)}T00:00:00+05:30`)
      .returns<{ status: string }[]>(),
  ]);

  const error = projectsRes.error ?? peopleRes.error ?? payments.error ?? onboardedRes.error ?? changesRes.error;
  if (error) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <PageHeader title="Dashboard" />
        <p className="text-destructive">Could not load data: {error.message}</p>
      </div>
    );
  }

  const everyoneById = new Map(peopleRes.people.map((e) => [e.id, e]));
  const projects = projectsRes.data ?? [];
  const DUE_SOON_DAYS = 3;
  const dueSoon = projects
    .map((p) => ({ p, next: nextReportDate(p.reporting_date) }))
    .map((x) => ({ ...x, days: daysUntil(x.next) }))
    .filter((x) => x.days <= DUE_SOON_DAYS)
    .sort((a, b) => a.days - b.days || a.p.name.localeCompare(b.p.name));

  // Payments: the short version. The full list, history and "Mark as paid" live on the Payments page.
  const { active, ledger, info, labelOf } = payments;
  const attention = attentionRows(active, ledger);
  const overdueRows = attention.filter((r) => r.days < 0);
  const overdueTotal = overdueRows.reduce((sum, r) => sum + r.amount, 0);
  const SHOWN = 3;
  const managerName = (id: string | null | undefined) => (id ? everyoneById.get(id)?.name : undefined);

  // Revenue for the current month only: real amounts from the ledger, plus scheduled payments of active
  // projects the ledger hasn't opened yet.
  const onboarded = onboardedRes.count ?? 0;
  const halted = (changesRes.data ?? []).filter((c) => c.status === "halted").length;
  const lost = (changesRes.data ?? []).filter((c) => c.status === "ended").length;
  const monthRows = monthItems(month, active, ledger, labelOf);
  const monthExpected = monthRows.reduce((sum, it) => sum + it.amount, 0);
  const monthReceived = monthRows.filter((it) => it.paid).reduce((sum, it) => sum + it.amount, 0);

  const pctOf = (count: number) => (projects.length ? Math.round((count / projects.length) * 100) : 0);
  const byWorkload = (a: WorkloadRow, b: WorkloadRow) => b.count - a.count || a.name.localeCompare(b.name);
  const activeWithRole = (role: string) =>
    peopleRes.people.filter((e) => e.is_active && e.role?.trim().toLowerCase() === role);

  // SEO specialists: share of active projects they're assigned to. A project can have several
  // people, so these percentages are per person and don't add up to 100.
  const seoWorkload: WorkloadRow[] = activeWithRole("seo specialist")
    .map((e) => {
      const count = projects.filter((p) => p.project_assignments.some((a) => a.employees?.id === e.id)).length;
      return { id: e.id, name: e.name, slug: e.slug, count, pct: pctOf(count) };
    })
    .sort(byWorkload);

  // Project managers: share of active projects they run. One manager per project.
  const managerWorkload: WorkloadRow[] = activeWithRole("project manager")
    .map((e) => {
      const count = projects.filter((p) => p.project_manager_id === e.id).length;
      return { id: e.id, name: e.name, slug: e.slug, count, pct: pctOf(count) };
    })
    .sort(byWorkload);
  const withoutManager = projects.filter((p) => !p.project_manager_id).length;

  const managers = peopleRes.people.filter(
    (e) => e.is_active && e.role?.trim().toLowerCase() === "project manager"
  );

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader title="Dashboard" description="Reports and payments coming up" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription>
              <Link href="/projects" className="font-medium text-foreground underline-offset-4 hover:underline">
                Active projects
              </Link>
            </CardDescription>
            <CardTitle className="text-3xl">{projects.length}</CardTitle>
          </CardHeader>
        </Card>
        {managers.map((m) => (
          <Card size="sm" key={m.id}>
            <CardHeader>
              <CardDescription>
                <Link href={`/projects/${m.slug}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                  {m.name}
                </Link>
              </CardDescription>
              <CardTitle className="text-3xl">
                {projects.filter((p) => p.project_manager_id === m.id).length}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              Reports due in the next {DUE_SOON_DAYS} days
              <span className="ml-2 text-sm font-normal text-muted-foreground">{dueSoon.length}</span>
            </CardTitle>
            <CardDescription>Reports go out monthly on each project&apos;s report day.</CardDescription>
          </CardHeader>
          <CardContent>
            {dueSoon.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing due in the next {DUE_SOON_DAYS} days.</p>
            ) : (
              <ul className="divide-y">
                {dueSoon.map(({ p, next, days }) => {
                  const mgr = everyoneById.get(p.project_manager_id ?? "");
                  const team = p.project_assignments.flatMap((a) => (a.employees ? [a.employees.name] : []));
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                      <Badge variant={days === 0 ? "destructive" : "default"} className="w-24 justify-center">
                        {dueLabel(days)}
                      </Badge>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-sm text-muted-foreground">{p.client_name}</span>
                      <span className="text-sm text-muted-foreground">{next}</span>
                      <span className="basis-full text-sm text-muted-foreground">
                        {mgr ? `PM: ${mgr.name}` : "No project manager"}
                        {team.length > 0 && ` · ${team.join(", ")}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Payments
              <span className="ml-2 text-sm font-normal text-muted-foreground">{attention.length}</span>
              {overdueRows.length > 0 && (
                <Badge variant="destructive" className="ml-2 align-middle">
                  {overdueRows.length} overdue · {formatUSD(overdueTotal)}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>Overdue first, then coming up.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is overdue or coming up.</p>
            ) : (
              <AttentionList rows={attention.slice(0, SHOWN)} info={info} managerName={managerName} compact />
            )}
            <Link href="/payments" className="inline-block text-sm font-medium underline-offset-4 hover:underline">
              {attention.length > SHOWN ? `View all ${attention.length} payments →` : "Open payments →"}
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="sm:flex sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                Onboarding
                <span className="ml-2 text-sm font-normal text-muted-foreground">{month.label}</span>
              </CardTitle>
              <CardDescription>Halted and lost count the status changes made this month.</CardDescription>
            </div>
            <Link href="/onboarding" className="text-sm font-medium underline-offset-4 hover:underline">
              Onboarding history →
            </Link>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-4">
              <div>
                <dt className="text-sm text-muted-foreground">Onboarded</dt>
                <dd className="text-2xl font-semibold tabular-nums">{onboarded}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Halted</dt>
                <dd className="text-2xl font-semibold tabular-nums">{halted}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Lost (ended)</dt>
                <dd className="text-2xl font-semibold tabular-nums">{lost}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              Revenue this month
              <span className="ml-2 text-sm font-normal text-muted-foreground">{month.label}</span>
            </CardTitle>
            <CardDescription>From the payment ledger (USD).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <RevenueSummary compact monthLabel={month.label} expected={monthExpected} received={monthReceived} overdue={overdueTotal} />
            <Link href="/payments" className="inline-block text-sm font-medium underline-offset-4 hover:underline">
              See every payment and past months →
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {managerWorkload.length > 0 && (
          <WorkloadCard
            title="Project manager workload"
            description={
              <>
                Share of the {projects.length} active {projects.length === 1 ? "project" : "projects"} each project
                manager runs.
                {withoutManager > 0 && ` ${withoutManager} ${withoutManager === 1 ? "project has" : "projects have"} no manager yet.`}
              </>
            }
            rows={managerWorkload}
            total={projects.length}
          />
        )}

        {seoWorkload.length > 0 && (
          <WorkloadCard
            title="SEO workload"
            description={`Share of the ${projects.length} active ${projects.length === 1 ? "project" : "projects"} each SEO specialist is assigned to. Projects can have several people, so the percentages don't add up to 100.`}
            rows={seoWorkload}
            total={projects.length}
          />
        )}
      </div>
    </div>
  );
}
