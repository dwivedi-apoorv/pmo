import { dueLabel } from "@/lib/reporting";
import type { ReportRow } from "@/lib/reports";
import { markReportSent } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ReportProjectInfo = { name: string; client: string; manager?: string; team: string[] };

// Reports that need action: overdue first, then due soon. `compact` is the short dashboard version
// (read-only); the full version on the Reports page has "Mark as sent".
export function ReportList({
  rows,
  info,
  compact = false,
}: {
  rows: ReportRow[];
  info: Map<string, ReportProjectInfo>;
  compact?: boolean;
}) {
  return (
    <ul className="divide-y">
      {rows.map((r) => {
        const pi = info.get(r.project_id);
        const overdue = r.days < 0;
        return (
          <li key={`${r.project_id}-${r.due}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <Badge variant={overdue || r.days === 0 ? "destructive" : "default"} className="w-28 justify-center">
              {overdue ? `${-r.days} ${-r.days === 1 ? "day" : "days"} overdue` : dueLabel(r.days)}
            </Badge>
            <span className="font-medium">{pi?.name ?? "Unknown project"}</span>
            {!compact && <span className="text-sm text-muted-foreground">{pi?.client}</span>}
            <span className={overdue ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>{r.due}</span>
            {!compact && (
              <form action={markReportSent} className="ml-auto">
                <input type="hidden" name="project_id" value={r.project_id} />
                <input type="hidden" name="due_date" value={r.due} />
                <Button type="submit" size="sm" variant="outline">Mark as sent</Button>
              </form>
            )}
            <span className="basis-full text-sm text-muted-foreground">
              {pi?.manager ? `PM: ${pi.manager}` : "No project manager"}
              {!compact && pi && pi.team.length > 0 && ` · ${pi.team.join(", ")}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
