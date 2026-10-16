import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type WorkloadRow = { id: string; name: string; slug: string; count: number; pct: number };

// A "who handles how much" card: one row per person with a percentage and a bar.
export function WorkloadCard({
  title,
  description,
  rows,
  total,
}: {
  title: string;
  description: React.ReactNode;
  rows: WorkloadRow[];
  total: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/projects/${r.slug}`}
                  className="truncate text-sm font-medium underline-offset-4 hover:underline"
                >
                  {r.name}
                </Link>
                <span className="shrink-0 text-sm tabular-nums">
                  {r.pct}%{" "}
                  <span className="text-muted-foreground">
                    · {r.count} of {total}
                  </span>
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={r.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${r.name}: ${r.pct}% of active projects`}
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${r.pct}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
