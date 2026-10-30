import { currencyOrder, formatMoney, formatTotals, minusTotals, type Totals } from "@/lib/currency";

const hasAny = (t: Totals) => Object.values(t).some((v) => Math.abs(v) > 0.004);

// The month's headline numbers and a collected-so-far bar. Used on the dashboard and the Payments page.
// Money in different currencies is never added together: with more than one currency each number shows
// per currency ("$4,200.00 USD + CA$1,800.00 CAD") and there is a bar for each.
export function RevenueSummary({
  monthLabel,
  expected,
  received,
  overdue,
  compact = false,
}: {
  monthLabel: string;
  expected: Totals;
  received: Totals;
  overdue: Totals;
  /** Two columns instead of four, for half-width cards. */
  compact?: boolean;
}) {
  const codes = currencyOrder(Object.keys(expected).filter((c) => expected[c] > 0));
  const overdueAny = hasAny(overdue);
  const num = "text-2xl font-semibold tabular-nums";
  return (
    <div className="space-y-4">
      <dl className={`grid grid-cols-2 gap-4 ${compact ? "" : "lg:grid-cols-4"}`}>
        <div>
          <dt className="text-sm text-muted-foreground">Expected this month</dt>
          <dd className={`${num} ${codes.length > 1 ? "!text-lg" : ""}`}>{formatTotals(expected)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Received so far</dt>
          <dd className={`${num} ${codes.length > 1 ? "!text-lg" : ""}`}>{formatTotals(received)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Still to collect</dt>
          <dd className={`${num} ${codes.length > 1 ? "!text-lg" : ""}`}>{formatTotals(minusTotals(expected, received))}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Overdue (any month)</dt>
          <dd className={`${num} ${Object.keys(overdue).filter((c) => overdue[c] > 0.004).length > 1 ? "!text-lg" : ""} ${overdueAny ? "text-destructive" : ""}`}>{formatTotals(overdue)}</dd>
        </div>
      </dl>

      {codes.map((code) => {
        const pct = expected[code] > 0 ? Math.round(((received[code] ?? 0) / expected[code]) * 100) : 0;
        return (
          <div key={code} className="grid gap-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{codes.length > 1 ? `${code}: ` : ""}{pct}% collected</span>
              <span className="text-muted-foreground tabular-nums">
                {formatMoney(received[code] ?? 0, code)} of {formatMoney(expected[code], code)}
              </span>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-[#cde2fb] dark:bg-[#0d366b]"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${pct}% of ${monthLabel} ${code} revenue collected`}
            >
              <div className="h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
