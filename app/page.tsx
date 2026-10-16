import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { loadPeople } from "@/lib/people";
import { daysUntil, dueLabel, nextReportDate } from "@/lib/reporting";
import {
  formatUSD,
  methodLabel,
  nextPaymentDate,
  paymentWindowDays,
  termLabel,
  type PaymentPlan,
} from "@/lib/payments";
import type { EmployeeOption } from "@/components/employee-select";
import { PageHeader } from "@/components/page-header";
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
  const [projectsRes, peopleRes] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, client_name, website, onboarding_date, reporting_date, payment_date, payment_term, payment_method, payment_amount_usd, project_manager_id, project_assignments(employees(id, name, role))"
      )
      .eq("status", "active")
      .order("reporting_date", { ascending: true })
      .returns<Project[]>(),
    loadPeople(),
  ]);

  const error = projectsRes.error ?? peopleRes.error;
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

  const paymentsDue = projects
    .flatMap((p) => {
      const next = nextPaymentDate(p);
      if (!next) return [];
      const days = daysUntil(next);
      return days <= paymentWindowDays(p.payment_method) ? [{ p, next, days }] : [];
    })
    .sort((a, b) => a.days - b.days || a.p.name.localeCompare(b.p.name));

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
              Payments due soon
              <span className="ml-2 text-sm font-normal text-muted-foreground">{paymentsDue.length}</span>
            </CardTitle>
            <CardDescription>
              Stripe link and bank wire payments show 7 days ahead; subscriptions (auto-charged) show 3 days ahead.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {paymentsDue.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments coming up.</p>
            ) : (
              <ul className="divide-y">
                {paymentsDue.map(({ p, next, days }) => {
                  const mgr = everyoneById.get(p.project_manager_id ?? "");
                  const auto = p.payment_method === "subscription";
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                      <Badge variant={days === 0 ? "destructive" : "default"} className="w-24 justify-center">
                        {dueLabel(days)}
                      </Badge>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-sm text-muted-foreground">{p.client_name}</span>
                      <span className="text-sm text-muted-foreground">{next}</span>
                      <span className="text-sm font-medium">{formatUSD(p.payment_amount_usd)}</span>
                      <Badge variant="secondary">{termLabel(p.payment_term)}</Badge>
                      <Badge variant="outline">{auto ? "Auto-charge" : methodLabel(p.payment_method)}</Badge>
                      <span className="basis-full text-sm text-muted-foreground">
                        {mgr ? `PM: ${mgr.name}` : "No project manager"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
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
