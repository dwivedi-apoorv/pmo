import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { loadPeople } from "@/lib/people";
import { loadPaymentsData } from "@/lib/payments-data";
import { requirePagePermission } from "@/lib/access";
import { attentionRows, monthItems } from "@/lib/dues";
import { formatUSD, projectionMonths } from "@/lib/payments";
import { todayISO } from "@/lib/reporting";
import { markPaid, undoPaid } from "@/app/actions";
import { AttentionList } from "@/components/attention-list";
import { OpenDuesButton } from "@/components/open-dues-button";
import { PageHeader } from "@/components/page-header";
import { RevenueSummary } from "@/components/revenue-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const shiftMonth = (key: string, delta: number) => {
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { scope } = await requirePagePermission("payments");
  const sp = await searchParams;
  const today = todayISO();
  const currentKey = today.slice(0, 7);
  // Only the current month and earlier: this page shows what is real, not forecasts.
  const requested = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) && sp.month <= currentKey ? sp.month : currentKey;
  const month = projectionMonths(`${requested}-01`, 1)[0];
  const isCurrent = month.key === currentKey;

  const [data, peopleRes] = await Promise.all([loadPaymentsData({ scope }), loadPeople()]);
  const error = data.error ?? peopleRes.error;
  if (error) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <PageHeader title="Payments" />
        <p className="text-destructive">Could not load data: {error.message}</p>
      </div>
    );
  }

  const { active, ledger, info, labelOf } = data;
  const peopleById = new Map(peopleRes.people.map((e) => [e.id, e]));
  const managerName = (id: string | null | undefined) => (id ? peopleById.get(id)?.name : undefined);

  const attention = attentionRows(active, ledger, today);
  const overdueRows = attention.filter((r) => r.days < 0);
  const overdueTotal = overdueRows.reduce((sum, r) => sum + r.amount, 0);

  const rows = monthItems(month, active, ledger, labelOf, isCurrent);
  const expected = rows.reduce((sum, it) => sum + it.amount, 0);
  const received = rows.filter((it) => it.paid).reduce((sum, it) => sum + it.amount, 0);

  // Month by month: every month the ledger has rows for (up to now), newest first.
  const monthKeys = [...new Set([currentKey, ...ledger.map((d) => d.due_date.slice(0, 7))])]
    .filter((k) => k <= currentKey)
    .sort()
    .reverse();
  const history = monthKeys.map((key) => {
    const m = projectionMonths(`${key}-01`, 1)[0];
    const items = monthItems(m, active, ledger, labelOf, key === currentKey);
    const billed = items.reduce((sum, it) => sum + it.amount, 0);
    const collected = items.filter((it) => it.paid).reduce((sum, it) => sum + it.amount, 0);
    return { key, label: m.label, count: items.length, billed, collected, outstanding: billed - collected };
  });

  const prevKey = shiftMonth(month.key, -1);
  const nextKey = shiftMonth(month.key, 1);
  const monthHref = (k: string) => (k === currentKey ? "/payments" : `/payments?month=${k}`);

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Payments"
        description="What is owed and collected, and revenue by month. Dues open automatically on the 1st of each month."
        action={<OpenDuesButton />}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            Needs attention
            <span className="ml-2 text-sm font-normal text-muted-foreground">{attention.length}</span>
            {overdueRows.length > 0 && (
              <Badge variant="destructive" className="ml-2 align-middle">
                {overdueRows.length} overdue · {formatUSD(overdueTotal)}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Overdue payments, then ones coming up. Anything unpaid stays here until it is marked paid, even if the
            project is later halted or ended. Stripe link and bank wire show 7 days ahead; subscriptions
            (auto-charged) show 3 days ahead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is overdue or coming up.</p>
          ) : (
            <AttentionList rows={attention} info={info} managerName={managerName} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{isCurrent ? "Revenue this month" : "Revenue"}</CardTitle>
            <CardDescription>
              {isCurrent
                ? "Every payment due this month, from the payment ledger (USD)."
                : `Payments that were due in ${month.label}, from the payment ledger (USD).`}
            </CardDescription>
          </div>
          <nav className="flex items-center gap-1" aria-label="Month">
            <Link
              href={monthHref(prevKey)}
              className="inline-flex size-8 items-center justify-center rounded-lg border hover:bg-muted"
              aria-label="Previous month"
            >
              <ChevronLeftIcon className="size-4" />
            </Link>
            <span className="min-w-24 text-center text-sm font-medium">{month.label}</span>
            {isCurrent ? (
              <span className="inline-flex size-8 items-center justify-center rounded-lg border opacity-40" aria-hidden>
                <ChevronRightIcon className="size-4" />
              </span>
            ) : (
              <Link
                href={monthHref(nextKey)}
                className="inline-flex size-8 items-center justify-center rounded-lg border hover:bg-muted"
                aria-label="Next month"
              >
                <ChevronRightIcon className="size-4" />
              </Link>
            )}
          </nav>
        </CardHeader>
        <CardContent className="space-y-5">
          <RevenueSummary monthLabel={month.label} expected={expected} received={received} overdue={overdueTotal} />

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments were due in {month.label}.</p>
          ) : (
            <ul className="divide-y text-sm">
              {rows.map((it) => {
                const overdue = !it.paid && it.date < today;
                return (
                  <li key={`${it.project_id}-${it.date}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
                    <span className="w-24 shrink-0 text-muted-foreground tabular-nums">{it.date}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{it.project}</span>
                    <span className="tabular-nums">{formatUSD(it.amount)}</span>
                    <Badge variant={it.paid ? "secondary" : overdue ? "destructive" : "outline"} className="w-16 justify-center">
                      {it.paid ? "Paid" : overdue ? "Overdue" : "Due"}
                    </Badge>
                    <form action={it.paid ? undoPaid : markPaid} className="w-28 text-right">
                      <input type="hidden" name="project_id" value={it.project_id} />
                      <input type="hidden" name="due_date" value={it.date} />
                      <Button type="submit" size="sm" variant={it.paid ? "ghost" : "outline"}>
                        {it.paid ? "Undo" : "Mark as paid"}
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Month by month</CardTitle>
          <CardDescription>Real revenue from the ledger. Click a month to see its payments.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.key} className={h.key === month.key ? "bg-muted/50" : ""}>
                  <TableCell className="font-medium">
                    <Link href={monthHref(h.key)} className="underline-offset-4 hover:underline">
                      {h.label}
                    </Link>
                    {h.key === currentKey && <span className="ml-2 text-xs text-muted-foreground">this month</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{h.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUSD(h.billed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUSD(h.collected)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${h.outstanding > 0 ? "font-medium text-destructive" : ""}`}>
                    {formatUSD(h.outstanding)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
