import { dueLabel } from "@/lib/reporting";
import { formatUSD, methodLabel, termLabel } from "@/lib/payments";
import type { AttentionRow } from "@/lib/dues";
import type { ProjectInfo } from "@/lib/payments-data";
import { STATUS_LABEL } from "@/lib/status";
import { markPaid } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Payments that need action: overdue first, then coming up. `compact` is the short dashboard version
// (no term/method and no buttons); the full version on the Payments page has "Mark as paid".
export function AttentionList({
  rows,
  info,
  managerName,
  compact = false,
}: {
  rows: AttentionRow[];
  info: Map<string, ProjectInfo>;
  managerName: (id: string | null | undefined) => string | undefined;
  compact?: boolean;
}) {
  return (
    <ul className="divide-y">
      {rows.map((r) => {
        const pi = info.get(r.project_id);
        const overdue = r.days < 0;
        const mgr = managerName(pi?.managerId);
        return (
          <li key={`${r.project_id}-${r.due}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <Badge variant={overdue || r.days === 0 ? "destructive" : "default"} className="w-28 justify-center">
              {overdue ? `${-r.days} ${-r.days === 1 ? "day" : "days"} overdue` : dueLabel(r.days)}
            </Badge>
            <span className="font-medium">{pi?.name ?? "Unknown project"}</span>
            {pi && pi.status !== "active" && <Badge variant="secondary">{STATUS_LABEL[pi.status]}</Badge>}
            {!compact && <span className="text-sm text-muted-foreground">{pi?.client}</span>}
            <span className={overdue ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>{r.due}</span>
            <span className="text-sm font-medium">{formatUSD(r.amount)}</span>
            {!compact && r.term && <Badge variant="secondary">{termLabel(r.term)}</Badge>}
            {!compact && r.method && (
              <Badge variant="outline">{r.method === "subscription" ? "Auto-charge" : methodLabel(r.method)}</Badge>
            )}
            {!compact && (
              <form action={markPaid} className="ml-auto">
                <input type="hidden" name="project_id" value={r.project_id} />
                <input type="hidden" name="due_date" value={r.due} />
                <Button type="submit" size="sm" variant="outline">Mark as paid</Button>
              </form>
            )}
            {!compact && (
              <span className="basis-full text-sm text-muted-foreground">{mgr ? `PM: ${mgr}` : "No project manager"}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
