import { newestFirst, periodDuration, type TeamPeriod } from "@/lib/history";
import { Badge } from "@/components/ui/badge";

function Section({ title, rows, empty }: { title: string; rows: TeamPeriod[]; empty: string }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {newestFirst(rows).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">{p.employee_name}</span>
              <span className="text-muted-foreground tabular-nums">
                {p.started_on} → {p.ended_on ?? "Present"}
              </span>
              <span className="w-20 text-right text-muted-foreground tabular-nums">{periodDuration(p)}</span>
              {p.ended_on === null && <Badge variant="default">Current</Badge>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Who handled a project, and from when to when. Managers and team members are listed separately.
export function ProjectHistory({ history }: { history: TeamPeriod[] }) {
  return (
    <div className="grid gap-5">
      <Section
        title="Project managers"
        rows={history.filter((h) => h.role === "manager")}
        empty="No project manager has been assigned yet."
      />
      <Section
        title="Team members"
        rows={history.filter((h) => h.role === "member")}
        empty="Nobody has been assigned to this project yet."
      />
      <p className="text-xs text-muted-foreground">
        Dates run from the day someone was assigned to the day they were replaced or the project ended. Halting a
        project keeps its team on it.
      </p>
    </div>
  );
}
