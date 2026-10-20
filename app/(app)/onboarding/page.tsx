import { supabase } from "@/lib/supabase";
import { limitTo, requirePageAccess } from "@/lib/access";
import { loadPeople } from "@/lib/people";
import { todayISO } from "@/lib/reporting";
import { STATUS_LABEL, type ProjectStatus } from "@/lib/status";
import { servicesOf, type WithServices } from "@/lib/services";
import { NOTE_COLUMNS, authorBy, noteDate, type ProjectNote } from "@/lib/notes";
import { PageHeader } from "@/components/page-header";
import { SearchBox } from "@/components/search-box";
import { WebsiteLink } from "@/components/website-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  client_name: string;
  website: string | null;
  onboarding_date: string;
  status: ProjectStatus;
  project_manager_id: string | null;
} & WithServices;

const monthName = (key: string) =>
  new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { scope } = await requirePageAccess();
  const q = ((await searchParams).q ?? "").trim();

  const [projectsRes, peopleRes, notesRes] = await Promise.all([
    // Every project, whatever its status: onboarding history never shrinks when a project stops.
    limitTo(
      supabase
        .from("projects")
        .select("id, name, client_name, website, onboarding_date, status, project_manager_id, project_services(services(id, name))")
        .order("onboarding_date", { ascending: false }),
      scope,
      "id"
    ).returns<Row[]>(),
    loadPeople(),
    limitTo(supabase.from("project_notes").select(NOTE_COLUMNS).eq("kind", "onboarding").order("created_at", { ascending: true }), scope).returns<ProjectNote[]>(),
  ]);

  const error = projectsRes.error ?? peopleRes.error ?? notesRes.error;
  if (error) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <PageHeader title="Onboarding history" />
        <p className="text-destructive">Could not load data: {error.message}</p>
      </div>
    );
  }

  const all = projectsRes.data ?? [];
  const people = new Map(peopleRes.people.map((e) => [e.id, e]));
  const managerOf = (r: Row) => (r.project_manager_id ? people.get(r.project_manager_id)?.name : undefined);

  const notesByProject = new Map<string, ProjectNote[]>();
  for (const n of notesRes.data ?? []) notesByProject.set(n.project_id, [...(notesByProject.get(n.project_id) ?? []), n]);

  const today = todayISO();
  const thisKey = today.slice(0, 7);
  const lastKey = new Date(Date.UTC(Number(thisKey.slice(0, 4)), Number(thisKey.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const countIn = (key: string) => all.filter((r) => r.onboarding_date.startsWith(key)).length;

  // The search only filters the list below; the numbers above always describe everything.
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = terms.length
    ? all.filter((r) => {
        const hay = [r.name, r.client_name, r.website ?? "", managerOf(r) ?? "", STATUS_LABEL[r.status], ...servicesOf(r).map((x) => x.name), ...(notesByProject.get(r.id) ?? []).map((n) => n.body)].join(" ").toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
    : all;

  // Group by month, newest first (the query is already ordered by date).
  const groups = new Map<string, Row[]>();
  for (const r of shown) {
    const key = r.onboarding_date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader title="Onboarding history" description="Every project, by the month it was onboarded" />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Onboarded this month</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{countIn(thisKey)}</CardTitle>
            <p className="text-xs text-muted-foreground">{monthName(thisKey)}</p>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Onboarded last month</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{countIn(lastKey)}</CardTitle>
            <p className="text-xs text-muted-foreground">{monthName(lastKey)}</p>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>All time</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{all.length}</CardTitle>
            <p className="text-xs text-muted-foreground">projects onboarded, including halted and ended</p>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>
            History
            {q && <span className="ml-2 text-sm font-normal text-muted-foreground">{shown.length} of {all.length}</span>}
          </CardTitle>
          <SearchBox placeholder="Search project, client, manager…" />
        </CardHeader>
        <CardContent className="space-y-6">
          {groups.size === 0 && (
            <p className="text-sm text-muted-foreground">{q ? `No projects match “${q}”.` : "No projects have been onboarded yet."}</p>
          )}
          {[...groups.entries()].map(([key, rows]) => (
            <section key={key} aria-labelledby={`m-${key}`}>
              <h2 id={`m-${key}`} className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                {monthName(key)}
                <span className="font-normal text-muted-foreground">
                  {rows.length} {rows.length === 1 ? "project" : "projects"}
                </span>
                {key === thisKey && <Badge variant="outline">This month</Badge>}
              </h2>
              <ul className="divide-y rounded-lg border text-sm">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                    <span className="w-24 shrink-0 text-muted-foreground tabular-nums">{r.onboarding_date}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{r.name}</span>
                      <span className="text-muted-foreground"> · {r.client_name}</span>
                      {servicesOf(r).length > 0 && (
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {servicesOf(r).map((x) => (
                            <Badge key={x.id} variant="secondary">{x.name}</Badge>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="hidden w-40 truncate sm:block"><WebsiteLink url={r.website} /></span>
                    <span className="w-28 truncate text-muted-foreground">{managerOf(r) ?? "No manager"}</span>
                    <Badge variant={r.status === "active" ? "default" : "secondary"} className="w-16 justify-center">
                      {STATUS_LABEL[r.status]}
                    </Badge>
                    {(notesByProject.get(r.id) ?? []).length > 0 && (
                      <details className="basis-full text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          Onboarding notes
                          {(notesByProject.get(r.id) ?? []).length > 1 && ` (${(notesByProject.get(r.id) ?? []).length})`}
                        </summary>
                        <div className="mt-1.5 grid gap-2 rounded-md bg-muted/40 p-3">
                          {(notesByProject.get(r.id) ?? []).map((n) => (
                            <div key={n.id}>
                              <p className="whitespace-pre-wrap">{n.body}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Added <span className="tabular-nums">{noteDate(n.created_at)}</span>
                                {authorBy(n.created_by_name)}
                                {new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 1000 && (
                                  <>
                                    {" · "}Edited <span className="tabular-nums">{noteDate(n.updated_at)}</span>
                                    {authorBy(n.updated_by_name)}
                                  </>
                                )}
                              </p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
