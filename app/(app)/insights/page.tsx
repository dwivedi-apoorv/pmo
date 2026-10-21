import { limitTo, requirePageAccess } from "@/lib/access";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

type Row = { status: string; reason: string | null; reasons: string[] | null; projects: { name: string } | { name: string }[] | null };

/** How often each reason was given, most common first, with the projects it applied to. */
function tally(rows: Row[], status: string) {
  const byReason = new Map<string, { count: number; projects: Set<string> }>();
  for (const r of rows) {
    if (r.status !== status) continue;
    // Each reason given counts once (a project can have several); older entries have only the text.
    const given = r.reasons?.length ? r.reasons : [r.reason?.trim() || "No reason recorded"];
    const project = (Array.isArray(r.projects) ? r.projects[0] : r.projects)?.name;
    for (const key of given) {
      const e = byReason.get(key) ?? { count: 0, projects: new Set<string>() };
      e.count++;
      if (project) e.projects.add(project);
      byReason.set(key, e);
    }
  }
  return [...byReason]
    .map(([reason, e]) => ({ reason, count: e.count, projects: [...e.projects].sort() }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export default async function InsightsPage() {
  const { scope } = await requirePageAccess();
  const { data, error } = await limitTo(
    supabase.from("project_status_log").select("status, reason, reasons, project_id, projects(name)").in("status", ["halted", "ended"]),
    scope
  ).returns<Row[]>();

  const cards = [
    { title: "Why projects are lost", text: "How often each reason was given when a project was marked lost. A project can have several reasons.", rows: tally(data ?? [], "ended") },
    { title: "Why projects are halted", text: "How often each reason was given when a project was halted. A project can have several reasons.", rows: tally(data ?? [], "halted") },
  ];

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader title="Insights" description="What the history of your projects says" />
      {error && <p className="text-destructive">Could not load data: {error.message}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <CardTitle>{card.title}</CardTitle>
              <CardDescription>{card.text}</CardDescription>
            </CardHeader>
            <CardContent>
              {card.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ul className="grid gap-4">
                  {card.rows.map((r) => (
                    <li key={r.reason} className="grid gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">{r.reason}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{r.count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(r.count / card.rows[0].count) * 100}%` }} />
                      </div>
                      {r.projects.length > 0 && <p className="text-xs text-muted-foreground">{r.projects.join(", ")}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
