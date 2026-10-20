import { requirePageAccess } from "@/lib/access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { loadPeople } from "@/lib/people";
import { nextReportDate } from "@/lib/reporting";
import { ROLE_LABEL, periodDuration, type TeamPeriod } from "@/lib/history";
import { STATUS_LABEL, STATUS_ORDER, type ProjectStatus } from "@/lib/status";
import { AssigneeBadges } from "@/components/assignee-badges";
import { WebsiteLink } from "@/components/website-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

type Person = { id: string; name: string };
type Project = {
  id: string;
  name: string;
  client_name: string;
  website: string | null;
  onboarding_date: string;
  reporting_date: string;
  status: ProjectStatus;
  manager: Person | null;
  project_assignments: { employees: Person | null }[];
};


export default async function TeamMemberPage({ params }: { params: Promise<{ slug: string }> }) {
  const { scope } = await requirePageAccess();
  const { slug } = await params;

  const peopleRes = await loadPeople();
  const person = peopleRes.bySlug(slug);
  if (!person) notFound();
  const id = person.id;

  const linksRes = await supabase.from("project_assignments").select("project_id").eq("employee_id", id);

  const error = peopleRes.error ?? linksRes.error;
  if (error) {
    return (
      <div className="w-full p-6">
        <p className="text-destructive">Could not load data: {error.message}</p>
      </div>
    );
  }

  const assignedIds = (linksRes.data ?? []).map((r) => r.project_id as string);
  // Projects this person manages OR is assigned to
  const filter = assignedIds.length
    ? `project_manager_id.eq.${id},id.in.(${assignedIds.join(",")})`
    : `project_manager_id.eq.${id}`;
  const projectsRes = await supabase
    .from("projects")
    .select(
      "id, name, client_name, website, onboarding_date, reporting_date, status, manager:employees!project_manager_id(id, name), project_assignments(employees(id, name))"
    )
    .or(filter)
    .order("reporting_date", { ascending: true })
    .returns<Project[]>()
    .then((r) => (scope ? { ...r, data: (r.data ?? []).filter((p) => scope.includes(p.id)) } : r));

  if (projectsRes.error) {
    return (
      <div className="w-full p-6">
        <p className="text-destructive">Could not load data: {projectsRes.error.message}</p>
      </div>
    );
  }

  type Stretch = TeamPeriod & { projects: { name: string; client_name: string; status: ProjectStatus } | null };
  const historyRes = await supabase
    .from("project_team_history")
    .select("id, project_id, employee_id, employee_name, role, started_on, ended_on, projects(name, client_name, status)")
    .eq("employee_id", id)
    .order("started_on", { ascending: false })
    .returns<Stretch[]>();
  if (historyRes.error) {
    return (
      <div className="w-full p-6">
        <p className="text-destructive">Could not load data: {historyRes.error.message}</p>
      </div>
    );
  }
  const stretches = historyRes.data ?? [];

  const projects = [...(projectsRes.data ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );
  const assignedSet = new Set(assignedIds);
  const activeCount = projects.filter((p) => p.status === "active").length;

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <div>
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Dashboard
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          {person.name}
          {!person.is_active && <Badge variant="secondary">Deactivated</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">
          {projects.length} {projects.length === 1 ? "project" : "projects"} · {activeCount} active
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>Projects {person.name} manages or is assigned to, including halted and ended ones</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Client name</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Onboarded</TableHead>
                <TableHead>Next report</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Project manager</TableHead>
                <TableHead>Assigned to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.client_name}</TableCell>
                  <TableCell><WebsiteLink url={p.website} /></TableCell>
                  <TableCell>{p.onboarding_date}</TableCell>
                  <TableCell>{p.status !== "active" ? "—" : nextReportDate(p.reporting_date)}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "active" ? "default" : "secondary"}>
                      {STATUS_LABEL[p.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {p.manager?.id === id && <Badge variant="outline">Project manager</Badge>}
                      {assignedSet.has(p.id) && <Badge variant="outline">Team member</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {p.manager ? (
                      <Link href={`/projects/${peopleRes.slugOf(p.manager.id)}`} className="underline-offset-4 hover:underline">
                        {p.manager.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <AssigneeBadges
                      people={p.project_assignments.flatMap((a) =>
                        a.employees ? [{ ...a.employees, slug: peopleRes.slugOf(a.employees.id) }] : []
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No projects yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Project history
            <span className="ml-2 text-sm font-normal text-muted-foreground">{stretches.length}</span>
          </CardTitle>
          <CardDescription>
            Every project {person.name} has been on, in any role, and from when to when. Includes projects they were
            moved off.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stretches.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">
                    {h.projects?.name ?? "Unknown project"}
                    {h.projects && <span className="font-normal text-muted-foreground"> · {h.projects.client_name}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ROLE_LABEL[h.role]}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{h.started_on}</TableCell>
                  <TableCell className="tabular-nums">
                    {h.ended_on ?? <Badge variant="default">Current</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{periodDuration(h)}</TableCell>
                </TableRow>
              ))}
              {stretches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No project history yet.
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
