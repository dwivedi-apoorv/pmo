import { supabase } from "@/lib/supabase";
import { loadPeople } from "@/lib/people";
import { nextReportDate, todayISO, daysUntil } from "@/lib/reporting";
import { overdueReportDate, reportAttention, sentKeys, type ReportProject, type ReportSend } from "@/lib/reports";
import { undoReportSent } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ReportList, type ReportProjectInfo } from "@/components/report-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

type Row = ReportProject & {
  name: string;
  client_name: string;
  project_manager_id: string | null;
  project_assignments: { employees: { id: string; name: string } | null }[];
};

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]}`;

export default async function ReportsPage() {
  const [projectsRes, sendsRes, peopleRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, client_name, reporting_date, created_at, project_manager_id, project_assignments(employees(id, name))")
      .eq("status", "active")
      .order("name")
      .returns<Row[]>(),
    supabase.from("report_log").select("project_id, due_date, sent_at").order("sent_at", { ascending: false }).returns<ReportSend[]>(),
    loadPeople(),
  ]);

  const error = projectsRes.error ?? sendsRes.error ?? peopleRes.error;
  if (error) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <PageHeader title="Reports" />
        <p className="text-destructive">Could not load data: {error.message}</p>
      </div>
    );
  }

  const today = todayISO();
  const projects = projectsRes.data ?? [];
  const sends = sendsRes.data ?? [];
  const people = new Map(peopleRes.people.map((e) => [e.id, e.name]));
  const byId = new Map(projects.map((p) => [p.id, p]));

  const info = new Map<string, ReportProjectInfo>(
    projects.map((p) => [
      p.id,
      {
        name: p.name,
        client: p.client_name,
        manager: p.project_manager_id ? people.get(p.project_manager_id) : undefined,
        team: p.project_assignments.flatMap((a) => (a.employees ? [a.employees.name] : [])),
      },
    ])
  );

  const attention = reportAttention(projects, sends, today);
  const overdueCount = attention.filter((r) => r.days < 0).length;
  const sent = sentKeys(sends);

  // Last report sent for each project (newest send first, so the first one we meet wins).
  const lastSent = new Map<string, ReportSend>();
  for (const s of sends) if (!lastSent.has(s.project_id)) lastSent.set(s.project_id, s);

  const cutoff = Date.now() - 30 * 86_400_000;
  const recentlySent = sends.filter((s) => byId.has(s.project_id) && new Date(s.sent_at).getTime() >= cutoff).slice(0, 12);

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader title="Reports" description="Monthly client reports: what is overdue, what is coming up, and what has been sent" />

      <Card>
        <CardHeader>
          <CardTitle>
            Needs attention
            <span className="ml-2 text-sm font-normal text-muted-foreground">{attention.length}</span>
            {overdueCount > 0 && <Badge variant="destructive" className="ml-2 align-middle">{overdueCount} overdue</Badge>}
          </CardTitle>
          <CardDescription>
            Overdue reports first, then reports due in the next 3 days. A report that isn&apos;t marked sent by its day
            marks the project <span className="font-medium text-foreground">At risk</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every report is sent or not due yet.</p>
          ) : (
            <ReportList rows={attention} info={info} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All active projects</CardTitle>
          <CardDescription>When each report is due and when the last one was sent.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Project manager</TableHead>
                <TableHead>Reports on the</TableHead>
                <TableHead>Last sent</TableHead>
                <TableHead>Next due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => {
                const next = nextReportDate(p.reporting_date, today);
                const days = daysUntil(next, today);
                const overdue = overdueReportDate(p, sent, today);
                const last = lastSent.get(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.project_manager_id ? (people.get(p.project_manager_id) ?? "—") : "—"}</TableCell>
                    <TableCell>{ordinal(Number(p.reporting_date.slice(8, 10)))} of each month</TableCell>
                    <TableCell className="tabular-nums">
                      {last ? (
                        <>
                          {last.due_date}
                          <span className="text-muted-foreground"> · sent {new Date(last.sent_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{next}</TableCell>
                    <TableCell>
                      {overdue ? (
                        <Badge variant="destructive">Overdue since {overdue}</Badge>
                      ) : days <= 3 && !sent.has(`${p.id}|${next}`) ? (
                        <Badge variant="default">Due soon</Badge>
                      ) : (
                        <Badge variant="secondary">On track</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No active projects yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {recentlySent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recently sent</CardTitle>
            <CardDescription>The last 30 days. Undo a click that was a mistake.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {recentlySent.map((s) => (
                <li key={`${s.project_id}-${s.due_date}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 truncate font-medium">{byId.get(s.project_id)?.name}</span>
                  <span className="text-muted-foreground tabular-nums">due {s.due_date}</span>
                  <span className="text-muted-foreground tabular-nums">
                    sent {new Date(s.sent_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}
                  </span>
                  <form action={undoReportSent}>
                    <input type="hidden" name="project_id" value={s.project_id} />
                    <input type="hidden" name="due_date" value={s.due_date} />
                    <Button type="submit" size="sm" variant="ghost">Undo</Button>
                  </form>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
