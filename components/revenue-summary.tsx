import { formatUSD } from "@/lib/payments";

// The month's headline numbers and a collected-so-far bar. Used on the dashboard and the Payments page.
export function RevenueSummary({
  monthLabel,
  expected,
  received,
  overdue,
  compact = false,
}: {
  monthLabel: string;
  expected: number;
  received: number;
  overdue: number;
  /** Two columns instead of four, for half-width cards. */
  compact?: boolean;
}) {
  const pct = expected > 0 ? Math.round((received / expected) * 100) : 0;
  return (
    <div className="space-y-4">
      <dl className={`grid grid-cols-2 gap-4 ${compact ? "" : "lg:grid-cols-4"}`}>
        <div>
          <dt className="text-sm text-muted-foreground">Expected this month</dt>
          <dd className="text-2xl font-semibold tabular-nums">{formatUSD(expected)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Received so far</dt>
          <dd className="text-2xl font-semibold tabular-nums">{formatUSD(received)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Still to collect</dt>
          <dd className="text-2xl font-semibold tabular-nums">{formatUSD(expected - received)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Overdue (any month)</dt>
          <dd className={`text-2xl font-semibold tabular-nums ${overdue > 0 ? "text-destructive" : ""}`}>
            {formatUSD(overdue)}
          </dd>
        </div>
      </dl>

      {expected > 0 && (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{pct}% collected</span>
            <span className="text-muted-foreground tabular-nums">
              {formatUSD(received)} of {formatUSD(expected)}
            </span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-[#cde2fb] dark:bg-[#0d366b]"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct}% of ${monthLabel} revenue collected`}
          >
            <div className="h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
