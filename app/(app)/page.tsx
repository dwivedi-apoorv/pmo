import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { loadPeople } from "@/lib/people";
import { addDays, todayISO } from "@/lib/reporting";
import { formatUSD, projectionMonths, type PaymentPlan } from "@/lib/payments";
import { attentionRows, monthItems } from "@/lib/dues";
import { loadPaymentsData } from "@/lib/payments-data";
import { reportAttention, type ReportSend } from "@/lib/reports";
import { describeRisk, riskByProject } from "@/lib/risk";
import { serviceCoverage, type Service, type WithServices } from "@/lib/services";
import type { EmployeeOption } from "@/components/employee-select";
import { AttentionList } from "@/components/attention-list";
import { PageHeader } from "@/components/page-header";
import { ReportList, type ReportProjectInfo } from "@/components/report-list";
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
  created_at: string;
  project_manager_id: string | null;
  project_assignments: { employees: EmployeeOption | null }[];
} & PaymentPlan &
  WithServices;

export default async function Home() {
  const month = projectionMonths(todayISO(), 1)[0];
  const [projectsRes, peopleRes, payments, onboardedRes, changesRes, sendsRes, tagsRes, servicesRes] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, client_name, website, onboarding_date, reporting_date, created_at, payment_date, payment_term, payment_method, payment_amount_usd, project_manager_id, project_assignments(employees(id, name, role)), project_services(services(id, name))"
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
    supabase.from("report_log").select("project_id, due_date, sent_at").returns<ReportSend[]>(),
    // Every project's services (including halted and ended ones, whose already-received payments still count).
    supabase.from("project_services").select("project_id, services(id, name)").returns<{ project_id: string; services: Service | null }[]>(),
    supabase.from("services").select("id, name").order("name").returns<Service[]>(),
  ]);

  const error = projectsRes.error ?? peopleRes.error ?? payments.error ?? onboardedRes.error ?? changesRes.error ?? sendsRes.error ?? tagsRes.error ?? servicesRes.error;
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
  const today = todayISO();
  const managerName = (id: string | null | undefined) => (id ? everyoneById.get(id)?.name : undefined);

  // Reports: overdue ones first, then ones due in the next 3 days (marking them sent is on the Reports page).
  const reportRows = reportAttention(projects, sendsRes.data ?? [], today);
  const reportOverdue = reportRows.filter((r) => r.days < 0).length;
  const reportInfo = new Map<string, ReportProjectInfo>(
    projects.map((p) => [
      p.id,
      {
        name: p.name,
        client: p.client_name,
        manager: managerName(p.project_manager_id),
        team: p.project_assignments.flatMap((a) => (a.employees ? [a.employees.name] : [])),
      },
    ])
  );

  // Payments: the short version. The full list, history and "Mark as paid" live on the Payments page.
  const { active, ledger, info, labelOf } = payments;
  const attention = attentionRows(active, ledger);
  const overdueRows = attention.filter((r) => r.days < 0);
  const overdueTotal = overdueRows.reduce((sum, r) => sum + r.amount, 0);
  const SHOWN = 3;

  // At risk: an ACTIVE project with an overdue report or an overdue payment.
  const risk = riskByProject(new Set(projects.map((p) => p.id)), attention, reportRows);
  const atRisk = projects
    .filter((p) => risk.has(p.id))
    .sort(
      (a, b) =>
        risk.get(b.id)!.length - risk.get(a.id)!.length ||
        Math.min(...risk.get(a.id)!.map((r) => r.days)) - Math.min(...risk.get(b.id)!.map((r) => r.days)) ||
        a.name.localeCompare(b.name)
    );
  const AT_RISK_SHOWN = 5;

  // Revenue for the current month only: real amounts from the ledger, plus scheduled payments of active
  // projects the ledger hasn't opened yet.
  const onboarded = onboardedRes.count ?? 0;
  const halted = (changesRes.data ?? []).filter((c) => c.status === "halted").length;
  const lost = (changesRes.data ?? []).filter((c) => c.status === "ended").length;
  const monthRows = monthItems(month, active, ledger, labelOf);
  const monthExpected = monthRows.reduce((sum, it) => sum + it.amount, 0);
  const monthReceived = monthRows.filter((it) => it.paid).reduce((sum, it) => sum + it.amount, 0);

  // Services: how many active projects (and clients) each service is on.
  const servicesByProject = new Map<string, Service[]>();
  for (const t of tagsRes.data ?? []) {
    if (t.services) servicesByProject.set(t.project_id, [...(servicesByProject.get(t.project_id) ?? []), t.services]);
  }
  const serviceRows = serviceCoverage(
    servicesRes.data ?? [],
    servicesByProject,
    projects.map((p) => p.id),
    (id) => info.get(id)?.client,
    [...info.keys()] // every project, so clients of halted and ended ones count toward "so far"
  );
  const mostProjects = Math.max(1, ...serviceRows.map((r) => r.projects));

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
      <PageHeader title="Dashboard" description="An overview of whats happening!" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
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
        <Card className={atRisk.length > 0 ? "border-destructive/40" : ""}>
          <CardHeader className="sm:flex sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                At risk
                <span className="ml-2 text-sm font-normal text-muted-foreground">{atRisk.length}</span>
              </CardTitle>
              <CardDescription>Active projects with an overdue report or an overdue payment.</CardDescription>
            </div>
            {atRisk.length > 0 && (
              <Link href="/projects?risk=1" className="text-sm font-medium underline-offset-4 hover:underline">
                {atRisk.length > AT_RISK_SHOWN ? `View all ${atRisk.length} →` : "Open in projects →"}
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {atRisk.length === 0 ? (
              <p className="text-sm text-muted-foreground">All clear. No active project has an overdue report or payment.</p>
            ) : (
              <ul className="divide-y">
                {atRisk.slice(0, AT_RISK_SHOWN).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
                    <Badge variant="destructive">At risk</Badge>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-sm text-muted-foreground">{p.client_name}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {risk.get(p.id)!.map((r) => (
                        <Badge key={`${r.kind}-${r.due}`} variant="outline" className="border-destructive/40 text-destructive">
                          {describeRisk(r)}
                        </Badge>
                      ))}
                    </span>
                    <span className="basis-full text-sm text-muted-foreground">
                      {managerName(p.project_manager_id) ? `PM: ${managerName(p.project_manager_id)}` : "No project manager"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Services</CardTitle>
            <CardDescription>
              How many active projects each service is on, and for how many different clients. A project with several
              services counts under each one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {serviceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No services yet. Add them from the New project form.</p>
            ) : (
              <ul className="grid gap-x-8 gap-y-4 xl:grid-cols-2">
                {serviceRows.map((r) => (
                  <li key={r.name} className="grid gap-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      {r.name === "No service" ? (
                        <span className="truncate text-sm font-medium text-muted-foreground">{r.name}</span>
                      ) : (
                        <Link
                          href={`/projects?${new URLSearchParams({ service: r.name })}`}
                          className="truncate text-sm font-medium underline-offset-4 hover:underline"
                        >
                          {r.name}
                        </Link>
                      )}
                      <span className="shrink-0 text-sm tabular-nums">
                        <span className="font-semibold">{r.projects}</span>{" "}
                        <span className="text-muted-foreground">{r.projects === 1 ? "project" : "projects"}</span>
                      </span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={r.projects}
                      aria-valuemin={0}
                      aria-valuemax={mostProjects}
                      aria-label={`${r.name}: ${r.projects} active ${r.projects === 1 ? "project" : "projects"}`}
                    >
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(r.projects / mostProjects) * 100}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {r.clients} {r.clients === 1 ? "client" : "clients"}
                      {r.clientsEver > r.clients && (
                        <span title="Different clients ever given this service, including halted and ended projects">
                          {" · "}
                          {r.clientsEver} so far
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              Reports
              <span className="ml-2 text-sm font-normal text-muted-foreground">{reportRows.length}</span>
              {reportOverdue > 0 && (
                <Badge variant="destructive" className="ml-2 align-middle">{reportOverdue} overdue</Badge>
              )}
            </CardTitle>
            <CardDescription>Overdue first, then due in the next 3 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {reportRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every report is sent or not due yet.</p>
            ) : (
              <ReportList rows={reportRows.slice(0, SHOWN)} info={reportInfo} compact />
            )}
            <Link href="/reports" className="inline-block text-sm font-medium underline-offset-4 hover:underline">
              {reportRows.length > SHOWN ? `View all ${reportRows.length} reports →` : "Open reports →"}
            </Link>
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
