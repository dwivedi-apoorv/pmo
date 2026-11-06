import { supabase } from "@/lib/supabase";
import { limitTo, requirePageAccess } from "@/lib/access";
import { loadPeople } from "@/lib/people";
import { todayISO } from "@/lib/reporting";
import { WEEKDAYS, byDayAndTime, formatTime, isoWeekday, type Call } from "@/lib/calls";
import { CallDialog } from "@/components/call-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

type Row = Call & { projects: { name: string; client_name: string; project_manager_id: string | null } | { name: string; client_name: string; project_manager_id: string | null }[] | null };
type Proj = { id: string; name: string; client_name: string; project_manager_id: string | null };

export default async function CallsPage() {
  const access = await requirePageAccess();
  const [callsRes, projectsRes, peopleRes] = await Promise.all([
    limitTo(
      supabase.from("client_calls").select("id, project_id, weekday, call_time, duration_min, link, notes, projects!inner(name, client_name, project_manager_id, status)").eq("projects.status", "active"),
      access.scope
    ).returns<Row[]>(),
    limitTo(supabase.from("projects").select("id, name, client_name, project_manager_id").eq("status", "active").order("name"), access.scope, "id").returns<Proj[]>(),
    loadPeople(),
  ]);
  const error = callsRes.error ?? projectsRes.error ?? peopleRes.error;
  if (error) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <PageHeader title="Calls" />
        <p className="text-destructive">Could not load data: {error.message}</p>
      </div>
    );
  }

  const people = new Map(peopleRes.people.map((e) => [e.id, e.name]));
  const canEdit = (managerId: string | null) => access.role === "admin" || managerId === access.user.id;
  const projects = projectsRes.data ?? [];
  const options = projects.filter((p) => canEdit(p.project_manager_id)).map((p) => ({ value: p.id, label: `${p.client_name} - ${p.name}` }));
  const todayDay = isoWeekday(todayISO());

  const rows = (callsRes.data ?? [])
    .map((c) => ({ ...c, project: Array.isArray(c.projects) ? c.projects[0] : c.projects }))
    .filter((c) => !!c.project)
    .sort(byDayAndTime);

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Calls"
        description="Weekly client calls. Each one repeats every week. Times are India time (IST)."
        action={options.length > 0 ? <CallDialog projects={options} /> : undefined}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No weekly calls yet.{options.length > 0 ? " Use “Add a call” to add the first one." : ""}</p>
      ) : (
        WEEKDAYS.map((d) => {
          const day = rows.filter((r) => r.weekday === Number(d.value));
          if (!day.length) return null;
          return (
            <Card key={d.value}>
              <CardContent className="space-y-3">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  {d.label}
                  {Number(d.value) === todayDay && <Badge>Today</Badge>}
                </h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Time</TableHead>
                      <TableHead>Client / project</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Link</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {day.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="tabular-nums">{formatTime(r.call_time)}</TableCell>
                        <TableCell>
                          <span className="font-medium">{r.project!.client_name}</span>
                          <span className="block text-xs text-muted-foreground">{r.project!.name}</span>
                        </TableCell>
                        <TableCell>{r.project!.project_manager_id ? people.get(r.project!.project_manager_id) ?? "—" : "—"}</TableCell>
                        <TableCell>{r.duration_min ? `${r.duration_min} min` : "—"}</TableCell>
                        <TableCell>
                          {r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="underline underline-offset-4">Join</a> : "—"}
                        </TableCell>
                        <TableCell className="max-w-64 truncate" title={r.notes ?? undefined}>{r.notes ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {canEdit(r.project!.project_manager_id) && (
                            <CallDialog projects={options.some((o) => o.value === r.project_id) ? options : [...options, { value: r.project_id, label: `${r.project!.client_name} - ${r.project!.name}` }]} call={r} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
