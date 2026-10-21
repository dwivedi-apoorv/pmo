import { isClosed } from "@/lib/status";
import { limitTo, requirePageAccess } from "@/lib/access";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { isProjectManager, loadPeople } from "@/lib/people";
import type { ProjectStatus } from "@/lib/status";
import { reactivateEmployee } from "@/app/actions";
import { EditEmployeeDialog } from "@/components/edit-employee-dialog";
import { DeactivateEmployeeDialog } from "@/components/deactivate-employee-dialog";
import { DeleteEmployeeDialog } from "@/components/delete-employee-dialog";
import { PageHeader } from "@/components/page-header";
import { NewEmployeeButton } from "@/components/new-employee-button";
import { SearchBox } from "@/components/search-box";
import { SortHead } from "@/components/sort-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  project_manager_id: string | null;
  project_assignments: { employee_id: string }[];
};

type SortKey = "name" | "email" | "role" | "status" | "open";
const SORT_KEYS: SortKey[] = ["name", "email", "role", "status", "open"];

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; q?: string }>;
}) {
  const access = await requirePageAccess();
  const canManage = access.can("manage_people");
  const sp = await searchParams;
  const sort: SortKey = SORT_KEYS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : "status";
  const dir: "asc" | "desc" = sp.dir === "desc" ? "desc" : "asc";
  const q = (sp.q ?? "").trim();

  const [peopleRes, projectsRes] = await Promise.all([
    loadPeople(),
    limitTo(supabase.from("projects").select("id, name, status, project_manager_id, project_assignments(employee_id)"), access.scope, "id").returns<ProjectRow[]>(),
  ]);

  const error = peopleRes.error ?? projectsRes.error;
  if (error) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <PageHeader title="Employees" />
        <p className="text-destructive">Could not load data: {error.message}</p>
      </div>
    );
  }

  const projects = projectsRes.data ?? [];
  const roster = peopleRes.people;
  const openCounts = new Map(
    roster.map((e) => {
      const open = projects.filter((p) => !isClosed(p.status));
      const managing = open.filter((p) => p.project_manager_id === e.id).length;
      const assigned = open.filter((p) => p.project_assignments.some((a) => a.employee_id === e.id)).length;
      return [e.id, managing + assigned] as const;
    })
  );
  const keyOf = (e: (typeof roster)[number]): string | number =>
    sort === "email" ? (e.email ?? "")
    : sort === "role" ? (e.role ?? "")
    : sort === "status" ? Number(!e.is_active) // active first when ascending
    : sort === "open" ? (openCounts.get(e.id) ?? 0)
    : e.name;
  const sorted = [...roster].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    const cmp =
      typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
    return (dir === "asc" ? cmp : -cmp) || a.name.localeCompare(b.name);
  });
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const people = terms.length
    ? sorted.filter((e) => {
        const hay = [e.name, e.email ?? "", e.role ?? "", e.is_active ? "active" : "deactivated"].join(" ").toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
    : sorted;

  const roles = [...new Set(["Project Manager", ...roster.flatMap((e) => (e.role ? [e.role.trim()] : []))])].sort();
  const active = roster.filter((e) => e.is_active);
  const managerCandidates = active.filter(isProjectManager);
  const assigneeCandidates = active.filter((e) => !isProjectManager(e));

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Employees"
        description="Add, deactivate or remove people"
        action={canManage ? <NewEmployeeButton roles={roles} /> : undefined}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              All employees
              {q && <span className="ml-2 text-sm font-normal text-muted-foreground">{people.length} of {roster.length}</span>}
            </CardTitle>
            <SearchBox placeholder="Search name, email, role…" />
          </div>
          <CardDescription>
            Deactivated people are hidden from dropdowns but stay on past projects. Only deactivated people can be
            deleted permanently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead basePath="/people" sort={sort} dir={dir} q={q} k="name">Name</SortHead>
                <SortHead basePath="/people" sort={sort} dir={dir} q={q} k="email">Email</SortHead>
                <SortHead basePath="/people" sort={sort} dir={dir} q={q} k="role">Role</SortHead>
                <SortHead basePath="/people" sort={sort} dir={dir} q={q} k="status">Status</SortHead>
                <SortHead basePath="/people" sort={sort} dir={dir} q={q} k="open">Open projects</SortHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((e) => {
                const managed = projects.filter((p) => p.project_manager_id === e.id);
                const assigned = projects.filter((p) => p.project_assignments.some((a) => a.employee_id === e.id));
                const open = (p: ProjectRow) => !isClosed(p.status);
                const managedOpen = managed.filter(open);
                const assignedOpen = assigned.filter(open);
                return (
                  <TableRow key={e.id} className={e.is_active ? "" : "text-muted-foreground"}>
                    <TableCell className="font-medium">
                      <Link href={`/projects/${e.slug}`} className="underline-offset-4 hover:underline">
                        {e.name}
                      </Link>
                    </TableCell>
                    <TableCell>{e.email ?? "—"}</TableCell>
                    <TableCell>{e.role ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={e.is_active ? "default" : "secondary"}>
                        {e.is_active ? "Active" : "Deactivated"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {managedOpen.length} managing · {assignedOpen.length} assigned
                    </TableCell>
                    <TableCell>
                      {canManage && <div className="flex items-center justify-end gap-2">
                        <EditEmployeeDialog employee={{ id: e.id, name: e.name, email: e.email, role: e.role }} roles={roles} />
                        {e.is_active ? (
                          <DeactivateEmployeeDialog
                            employee={{ id: e.id, name: e.name }}
                            managedProjects={managedOpen.map((p) => ({ id: p.id, name: p.name }))}
                            assignedProjects={assignedOpen.map((p) => ({ id: p.id, name: p.name }))}
                            managerCandidates={managerCandidates
                              .filter((c) => c.id !== e.id)
                              .map((c) => ({ id: c.id, name: c.name }))}
                            assigneeCandidates={assigneeCandidates
                              .filter((c) => c.id !== e.id)
                              .map((c) => ({ id: c.id, name: c.name }))}
                          />
                        ) : (
                          <>
                            <form action={reactivateEmployee}>
                              <input type="hidden" name="employee_id" value={e.id} />
                              <Button type="submit" variant="outline" size="sm">
                                Reactivate
                              </Button>
                            </form>
                            <DeleteEmployeeDialog
                              employee={{ id: e.id, name: e.name }}
                              assignedCount={assigned.length}
                              managedCount={managed.length}
                            />
                          </>
                        )}
                      </div>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {people.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {`No employees match “${q}”.`}
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
