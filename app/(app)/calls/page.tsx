import Link from "next/link";
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

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === "table" ? "table" : "week";
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
  // Monday to Friday; Saturday and Sunday only appear if a call was booked on them.
  const days = WEEKDAYS.filter((d) => Number(d.value) <= 5 || rows.some((r) => r.weekday === Number(d.value)));
  const gridCols = days.length === 5 ? "lg:grid-cols-5" : days.length === 6 ? "lg:grid-cols-6" : "lg:grid-cols-7";

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Calls"
        description="Weekly client calls. Each one repeats every week. Times are India time (IST)."
        action={options.length > 0 ? <CallDialog projects={options} /> : undefined}
      />
      <nav className="inline-flex rounded-lg border p-0.5 text-sm" aria-label="View">
        {(["week", "table"] as const).map((v) => (
          <Link key={v} href={v === "week" ? "/calls" : "/calls?view=table"} className={`rounded-md px-3 py-1 ${view === v ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}>
            {v === "week" ? "Week" : "Table"}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No weekly calls yet.{options.length > 0 ? " Use “Add a call” to add the first one." : ""}</p>
      ) : view === "week" ? (
        <div className={`grid gap-3 md:grid-cols-2 ${gridCols}`}>
          {days.map((d) => {
            const day = rows.filter((r) => r.weekday === Number(d.value));
            const isToday = Number(d.value) === todayDay;
            return (
              <div key={d.value} className={`min-w-0 rounded-xl border p-2 ${isToday ? "border-foreground/40 bg-muted/40" : ""}`}>
                <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold">
                  {d.label}
                  {isToday && <Badge>Today</Badge>}
                </h2>
                <div className="grid gap-2">
                  {day.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">No calls</p>}
                  {day.map((r) => (
                    <div key={r.id} className="rounded-lg border bg-card p-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold tabular-nums">{formatTime(r.call_time)}</span>
                        {r.duration_min ? <span className="text-xs text-muted-foreground">{r.duration_min} min</span> : null}
                      </div>
                      <p className="mt-1 truncate font-medium" title={r.project!.client_name}>{r.project!.client_name}</p>
                      <p className="truncate text-xs text-muted-foreground" title={r.project!.name}>{r.project!.name}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{r.project!.project_manager_id ? people.get(r.project!.project_manager_id) ?? "—" : "—"}</p>
                      {r.notes && <p className="mt-1 line-clamp-2 text-xs" title={r.notes}>{r.notes}</p>}
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        {r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-4">Join</a> : <span />}
                        {canEdit(r.project!.project_manager_id) && (
                          <CallDialog projects={options.some((o) => o.value === r.project_id) ? options : [...options, { value: r.project_id, label: `${r.project!.client_name} - ${r.project!.name}` }]} call={r} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
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
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Time</TableHead>
                      <TableHead className="w-[28%]">Client / project</TableHead>
                      <TableHead className="w-[18%]">Manager</TableHead>
                      <TableHead className="w-24">Duration</TableHead>
                      <TableHead className="w-20">Link</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-20" />
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
