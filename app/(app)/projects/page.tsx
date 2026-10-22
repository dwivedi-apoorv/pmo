import Link from "next/link";
import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";
import { limitTo, requirePageAccess } from "@/lib/access";
import { COLUMNS, HIDDEN_COLUMNS_COOKIE, parseHidden, type ColumnId } from "@/lib/columns";
import { loadPeople } from "@/lib/people";
import { attentionRows, overdueSince, type Due } from "@/lib/dues";
import { reportAttention, type ReportSend } from "@/lib/reports";
import { riskByProject } from "@/lib/risk";
import { todayISO } from "@/lib/reporting";
import type { TeamPeriod } from "@/lib/history";
import { nextReportDate } from "@/lib/reporting";
import {
  formatUSD,
  methodLabel,
  nextPaymentDate,
  termLabel,
  type PaymentPlan,
} from "@/lib/payments";
import { PROJECT_STATUSES, STATUS_LABEL, isProjectStatus, type ProjectStatus } from "@/lib/status";
import type { EmployeeOption } from "@/components/employee-select";
import { EditProjectDialog } from "@/components/edit-project-dialog";
import { servicesOf, type Service, type WithServices } from "@/lib/services";
import { NOTE_COLUMNS, VERSION_COLUMNS, type NoteVersion, type ProjectNote } from "@/lib/notes";
import { OnboardingNotesButton } from "@/components/onboarding-notes-button";
import { RiskNote } from "@/components/risk-note";
import { ProjectStatusMenu } from "@/components/project-status-menu";
import { PageHeader } from "@/components/page-header";
import { NewProjectButton } from "@/components/new-project-button";
import { ColumnsMenu } from "@/components/columns-menu";
import { SearchBox } from "@/components/search-box";
import { SortHead } from "@/components/sort-head";
import { Badge } from "@/components/ui/badge";
import { AssigneeBadges } from "@/components/assignee-badges";
import { WebsiteLink } from "@/components/website-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic"; // always show fresh data

type Project = {
  id: string;
  name: string;
  client_name: string;
  website: string | null;
  onboarding_date: string;
  reporting_date: string;
  created_at: string;
  status: ProjectStatus;
  project_manager_id: string | null;
  project_assignments: { employees: EmployeeOption | null }[];
} & PaymentPlan &
  WithServices;

type StatusLogRow = { project_id: string; status: ProjectStatus; reason: string | null; changed_at: string };

type Tab = ProjectStatus | "all";

type SortKey = "name" | "client" | "website" | "onboarded" | "reporting" | "payment" | "manager" | "assigned";
const SORT_KEYS: SortKey[] = ["name", "client", "website", "onboarded", "reporting", "payment", "manager", "assigned"];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; q?: string; status?: string; risk?: string; service?: string }>;
}) {
  const access = await requirePageAccess();
  const { scope } = access;
  const canPay = access.can("payments");
  const canManage = access.can("manage_projects");
  const sp = await searchParams;
  const sort: SortKey = SORT_KEYS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : "name";
  const dir: "asc" | "desc" = sp.dir === "desc" ? "desc" : "asc";
  const q = (sp.q ?? "").trim();
  const tab: Tab = sp.status === "all" ? "all" : sp.status && isProjectStatus(sp.status) ? sp.status : "active";
  const serviceFilter = (sp.service ?? "").trim(); // quick filter: only projects with this service
  const riskOnly = sp.risk === "1"; // quick filter: only active projects that are at risk
  const hidden = parseHidden((await cookies()).get(HIDDEN_COLUMNS_COOKIE)?.value);
  const show = (id: ColumnId) => !hidden.has(id);

  const [projectsRes, peopleRes, ledgerRes, reasonsRes, statusRes, historyRes, sendsRes, servicesRes, notesRes, versionsRes] = await Promise.all([
    limitTo(
      supabase
        .from("projects")
        .select(
          "id, name, client_name, website, onboarding_date, reporting_date, created_at, payment_date, payment_term, payment_method, payment_amount_usd, status, project_manager_id, project_assignments(employees(id, name, role)), project_services(services(id, name))"
        )
        .order("reporting_date", { ascending: true }),
      scope,
      "id"
    ).returns<Project[]>(),
    loadPeople(),
    canPay
      ? limitTo(supabase.from("payment_dues").select("project_id, due_date, amount_usd, term, method, status, paid_at"), scope).returns<Due[]>()
      : Promise.resolve({ data: [] as Due[], error: null }),
    supabase.from("status_reasons").select("status, name").order("name").returns<{ status: "halted" | "ended" | "completed"; name: string }[]>(),
    limitTo(supabase.from("project_status_log").select("project_id, status, reason, changed_at").order("changed_at", { ascending: false }), scope).returns<StatusLogRow[]>(),
    limitTo(supabase.from("project_team_history").select("id, project_id, employee_id, employee_name, role, started_on, ended_on"), scope).returns<TeamPeriod[]>(),
    limitTo(supabase.from("report_log").select("project_id, due_date, sent_at"), scope).returns<ReportSend[]>(),
    supabase.from("services").select("id, name").order("name").returns<Service[]>(),
    limitTo(supabase.from("project_notes").select(NOTE_COLUMNS).order("created_at", { ascending: false }), scope).returns<ProjectNote[]>(),
    supabase.from("project_note_versions").select(VERSION_COLUMNS).order("saved_at", { ascending: false }).returns<NoteVersion[]>(),
  ]);

  const error = projectsRes.error ?? peopleRes.error ?? ledgerRes.error ?? reasonsRes.error ?? statusRes.error ?? historyRes.error ?? sendsRes.error ?? servicesRes.error ?? notesRes.error ?? versionsRes.error;
  if (error) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <PageHeader title="Projects" />
        <p className="text-destructive">Could not load data: {error.message}</p>
      </div>
    );
  }

  const ledger = ledgerRes.data ?? [];
  const reasonLists: Record<"halted" | "ended" | "completed", string[]> = { halted: [], ended: [], completed: [] };
  for (const r of reasonsRes.data ?? []) reasonLists[r.status].push(r.name);
  const everyoneById = new Map(peopleRes.people.map((e) => [e.id, e]));
  const keyOf = (p: Project): string | number =>
    sort === "name" ? p.name
    : sort === "client" ? p.client_name
    : sort === "website" ? (p.website ?? "")
    : sort === "onboarded" ? p.onboarding_date
    : sort === "manager" ? (everyoneById.get(p.project_manager_id ?? "")?.name ?? "")
    : sort === "assigned" ? p.project_assignments.length
    : sort === "payment" ? (nextPaymentDate(p) ?? "9999-12-31") // no upcoming payment sorts last
    : nextReportDate(p.reporting_date);
  // People who can't see payments never get the payment details: they're blanked here, before anything is shown.
  const allProjects = (projectsRes.data ?? []).map((p) => (canPay ? p : { ...p, payment_date: null, payment_term: null, payment_method: null, payment_amount_usd: null }));
  // At risk: an ACTIVE project with an overdue report or an overdue payment.
  const activeProjects = allProjects.filter((p) => p.status === "active");
  const risk = riskByProject(
    new Set(activeProjects.map((p) => p.id)),
    attentionRows(activeProjects, ledger),
    reportAttention(activeProjects, sendsRes.data ?? [], todayISO())
  );
  const counts: Record<Tab, number> = { all: allProjects.length, active: 0, halted: 0, completed: 0, ended: 0 };
  for (const p of allProjects) counts[p.status]++;
  // The newest log entry per project says why it is in its current status.
  const lastChange = new Map<string, StatusLogRow>();
  for (const r of statusRes.data ?? []) if (!lastChange.has(r.project_id)) lastChange.set(r.project_id, r);

  const projects = allProjects.filter((p) => (tab === "all" || p.status === tab) && (!riskOnly || risk.has(p.id)) && (!serviceFilter || servicesOf(p).some((x) => x.name.toLowerCase() === serviceFilter.toLowerCase()))).sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    const cmp = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
    return (dir === "asc" ? cmp : -cmp) || a.name.localeCompare(b.name);
  });
  const extra = {
    ...(tab === "active" ? {} : { status: tab }),
    ...(riskOnly ? { risk: "1" } : {}),
    ...(serviceFilter ? { service: serviceFilter } : {}),
  };
  const showStatus = tab !== "active";
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = terms.length
    ? projects.filter((p) => {
        const hay = [
          p.name,
          p.client_name,
          p.website ?? "",
          termLabel(p.payment_term),
          methodLabel(p.payment_method),
          everyoneById.get(p.project_manager_id ?? "")?.name ?? "",
          ...p.project_assignments.map((a) => a.employees?.name ?? ""),
          STATUS_LABEL[p.status],
          lastChange.get(p.id)?.reason ?? "",
          ...servicesOf(p).map((x) => x.name),
        ]
          .join(" ")
          .toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
    : projects;
  const { slugOf } = peopleRes;
  // Each project's note history.
  const noteProject = new Map((notesRes.data ?? []).map((n) => [n.id, n.project_id]));
  const versionsFor = (projectId: string) => (versionsRes.data ?? []).filter((v) => noteProject.get(v.note_id) === projectId);
  const everyone = [...peopleRes.people].sort((a, b) => a.name.localeCompare(b.name));
  const employees = everyone.filter((e) => e.is_active); // deactivated people are hidden from dropdowns
  const isManager = (e: EmployeeOption) => e.role?.trim().toLowerCase() === "project manager";
  const managers = employees.filter(isManager);
  const assignable = employees.filter((e) => !isManager(e)); // project managers aren't assigned as team members

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Projects"
        description="Projects, their teams, reports and payments"
        action={canManage ? <NewProjectButton employees={assignable} managers={managers} services={servicesRes.data ?? []} showPayment={canPay} /> : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex w-fit rounded-lg bg-muted p-1 text-sm" role="tablist" aria-label="Project status">
        {(["active", "halted", "completed", "ended", "all"] as const).map((t) => (
          <Link
            key={t}
            href={`/projects?${new URLSearchParams({ ...(t === "active" ? {} : { status: t }), ...(serviceFilter ? { service: serviceFilter } : {}), ...(q ? { q } : {}) })}`}
            role="tab"
            aria-selected={tab === t && !riskOnly}
            className={`rounded-md px-3 py-1 transition-colors ${
              tab === t && !riskOnly ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "all" ? "All" : STATUS_LABEL[t]} <span className="text-muted-foreground tabular-nums">{counts[t]}</span>
          </Link>
        ))}
      </div>
      <Link
        href={riskOnly ? "/projects" : `/projects?${new URLSearchParams({ risk: "1", ...(serviceFilter ? { service: serviceFilter } : {}), ...(q ? { q } : {}) })}`}
        aria-pressed={riskOnly}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
          riskOnly
            ? "border-destructive bg-destructive/10 font-medium text-destructive"
            : risk.size > 0
              ? "border-destructive/40 text-destructive hover:bg-destructive/10"
              : "text-muted-foreground hover:text-foreground"
        }`}
      >
        At risk <span className="tabular-nums">{risk.size}</span>
      </Link>
      {serviceFilter && (
        <Link
          href={`/projects?${new URLSearchParams({ ...(tab === "active" ? {} : { status: tab }), ...(riskOnly ? { risk: "1" } : {}), ...(q ? { q } : {}) })}`}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/70"
          title="Clear the service filter"
        >
          Service: <span className="font-medium">{serviceFilter}</span> <span aria-hidden>×</span>
          <span className="sr-only">Clear the service filter</span>
        </Link>
      )}
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>
            {riskOnly ? "At-risk projects" : tab === "all" ? "All projects" : `${STATUS_LABEL[tab]} projects`}
            {q && <span className="ml-2 text-sm font-normal text-muted-foreground">{visible.length} of {projects.length}</span>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <SearchBox placeholder="Search project, client, manager…" />
            <ColumnsMenu hidden={[...hidden]} />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead basePath="/projects" sort={sort} dir={dir} q={q} extra={extra} k="name">Project</SortHead>
                {showStatus && <TableHead>Status</TableHead>}
                {show("client") && <SortHead basePath="/projects" sort={sort} dir={dir} q={q} extra={extra} k="client">Client name</SortHead>}
                {show("services") && <TableHead>Services</TableHead>}
                {show("website") && <SortHead basePath="/projects" sort={sort} dir={dir} q={q} extra={extra} k="website">Website</SortHead>}
                {show("onboarded") && <SortHead basePath="/projects" sort={sort} dir={dir} q={q} extra={extra} k="onboarded">Onboarded</SortHead>}
                {show("reporting") && <SortHead basePath="/projects" sort={sort} dir={dir} q={q} extra={extra} k="reporting">Next report</SortHead>}
                {show("payment") && canPay && <SortHead basePath="/projects" sort={sort} dir={dir} q={q} extra={extra} k="payment">Next payment</SortHead>}
                {show("manager") && <SortHead basePath="/projects" sort={sort} dir={dir} q={q} extra={extra} k="manager">Project manager</SortHead>}
                {show("assigned") && <SortHead basePath="/projects" sort={sort} dir={dir} q={q} extra={extra} k="assigned">Assigned to</SortHead>}
                {show("notes") && <TableHead className="sticky right-24 z-[1] border-l bg-card">Notes</TableHead>}
                <TableHead className="sticky right-0 z-[1] w-24 min-w-24 border-l bg-card text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p) => {
                const assigned = p.project_assignments.flatMap((a) =>
                  a.employees ? [{ ...a.employees, slug: slugOf(a.employees.id) }] : []
                );
                const manager = everyone.find((e) => e.id === p.project_manager_id);
                // Only project managers are offered as manager and only other staff as
                // assignees, but whoever is already on the project stays selectable.
                const managerOptions = manager && !isManager(manager) ? [...managers, manager] : managers;
                const peopleOptions = [...assignable, ...assigned.filter((e) => !assignable.some((x) => x.id === e.id))];
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {p.name}
                      <RiskNote reasons={risk.get(p.id)} />
                    </TableCell>
                    {showStatus && (
                      <TableCell className="min-w-44 max-w-64 whitespace-normal">
                        {(() => {
                          const change = lastChange.get(p.id);
                          return (
                            <>
                              <Badge variant={p.status === "active" ? "default" : "secondary"}>{STATUS_LABEL[p.status]}</Badge>
                              {change && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  since {new Date(change.changed_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}
                                  {change.reason && <> · <span className="text-foreground">{change.reason}</span></>}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </TableCell>
                    )}
                    {show("client") && (
                      <TableCell>{p.client_name}</TableCell>
                    )}
                    {show("services") && (
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {servicesOf(p).length === 0 && <span className="text-muted-foreground">—</span>}
                          {servicesOf(p).map((x) => (
                            <Link
                              key={x.id}
                              href={`/projects?${new URLSearchParams({ ...(tab === "active" ? {} : { status: tab }), service: x.name })}`}
                              title={`Show only ${x.name} projects`}
                            >
                              <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/70">{x.name}</Badge>
                            </Link>
                          ))}
                        </div>
                      </TableCell>
                    )}
                    {show("website") && (
                      <TableCell><WebsiteLink url={p.website} /></TableCell>
                    )}
                    {show("onboarded") && (
                      <TableCell>{p.onboarding_date}</TableCell>
                    )}
                    {show("reporting") && (
                      <TableCell className="whitespace-nowrap">
                        {p.status === "active" ? nextReportDate(p.reporting_date) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    {show("payment") && canPay && (
                      <TableCell className="whitespace-nowrap">
                        {(() => {
                          // Upcoming payments only matter while a project is active, but money still
                          // owed stays visible (in red) even after it is halted or ended.
                          const active = p.status === "active";
                          const next = active ? nextPaymentDate(p) : null;
                          const overdue = overdueSince({ ...p, active }, ledger);
                          if (!next && !overdue) return <span className="text-muted-foreground">—</span>;
                          return (
                            <>
                              {next ?? <span className="text-muted-foreground">—</span>}
                              <div className="max-w-40 text-xs whitespace-normal text-muted-foreground">
                                {formatUSD(p.payment_amount_usd)} · {termLabel(p.payment_term)} · {methodLabel(p.payment_method)}
                              </div>
                              {overdue && (
                                <div className="text-xs font-medium text-destructive">Overdue since {overdue}</div>
                              )}
                            </>
                          );
                        })()}
                      </TableCell>
                    )}
                    {show("manager") && (
                      <TableCell>
                        {manager ? (
                          <Link href={`/projects/${manager.slug}`} className="underline-offset-4 hover:underline">
                            {manager.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>)}
                      </TableCell>
                    )}
                    {show("assigned") && (
                      <TableCell>
                        <AssigneeBadges people={assigned} />
                      </TableCell>
                    )}
                    {show("notes") && (
                      <TableCell className="sticky right-24 z-[1] border-l bg-card">
                        <OnboardingNotesButton
                          projectId={p.id}
                          projectName={p.name}
                          notes={(notesRes.data ?? []).filter((n) => n.project_id === p.id)}
                          versions={versionsFor(p.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="sticky right-0 z-[1] w-24 min-w-24 border-l bg-card text-right">
                      <div className="flex items-center justify-end gap-1">
                      {canManage && <EditProjectDialog
                        showPayment={canPay}
                        id={p.id}
                        values={{
                          name: p.name,
                          client_name: p.client_name,
                          website: p.website,
                          onboarding_date: p.onboarding_date,
                          reporting_date: p.reporting_date,
                          payment_date: p.payment_date,
                          payment_term: p.payment_term,
                          payment_method: p.payment_method,
                          payment_amount_usd: p.payment_amount_usd,
                        }}
                        managers={managerOptions}
                        people={peopleOptions}
                        managerId={p.project_manager_id}
                        assigneeIds={assigned.map((e) => e.id)}
                        history={(historyRes.data ?? []).filter((h) => h.project_id === p.id)}
                        services={servicesRes.data ?? []}
                        serviceIds={servicesOf(p).map((x) => x.id)}
                        notes={(notesRes.data ?? []).filter((n) => n.project_id === p.id)}
                        noteVersions={versionsFor(p.id)}
                      />}
                      {canManage && <ProjectStatusMenu id={p.id} name={p.name} status={p.status} reasons={reasonLists} />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2 + COLUMNS.length - hidden.size + (showStatus ? 1 : 0)} className="text-center text-muted-foreground">
                    {q ? `No projects match “${q}”.` : riskOnly ? "No projects are at risk." : tab === "all" ? "No projects yet." : `No ${STATUS_LABEL[tab].toLowerCase()} projects.`}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
