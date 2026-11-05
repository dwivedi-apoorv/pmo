import Link from "next/link";
import { loadPaymentsData } from "@/lib/payments-data";
import { requirePagePermission } from "@/lib/access";
import { monthItems } from "@/lib/dues";
import { formatTotals, minusTotals, sumByCurrency } from "@/lib/currency";
import { projectionMonths } from "@/lib/payments";
import { todayISO } from "@/lib/reporting";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

// Revenue month by month, from the payment ledger. Each month links to its payments on the Payments page.
export default async function MonthlyPaymentsPage() {
  const { scope } = await requirePagePermission("payments");
  const currentKey = todayISO().slice(0, 7);
  const data = await loadPaymentsData({ scope });
  if (data.error) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <PageHeader title="Month by month" />
        <p className="text-destructive">Could not load data: {data.error.message}</p>
      </div>
    );
  }
  const { active, ledger, labelOf } = data;
  const monthHref = (k: string) => (k === currentKey ? "/payments" : `/payments?month=${k}`);

  // Every month the ledger has rows for (up to now), newest first.
  const monthKeys = [...new Set([currentKey, ...ledger.filter((d) => d.status !== "void").map((d) => d.due_date.slice(0, 7))])]
    .filter((k) => k <= currentKey)
    .sort()
    .reverse();
  const history = monthKeys.map((key) => {
    const m = projectionMonths(`${key}-01`, 1)[0];
    const items = monthItems(m, active, ledger, labelOf, key === currentKey);
    const billed = sumByCurrency(items, (it) => it);
    const collected = sumByCurrency(items.filter((it) => it.paid), (it) => it);
    const outstanding = minusTotals(billed, collected);
    return { key, label: m.label, count: items.length, billed, collected, outstanding, owing: Object.values(outstanding).some((v) => v > 0.004) };
  });


  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader title="Month by month" description="Billed, collected and outstanding for every month, in each currency." />
      <Card>
        <CardHeader>
          <CardTitle>Month by month</CardTitle>
          <CardDescription>Real revenue from the ledger (removed payments aren't counted). Click a month to see its payments.</CardDescription>
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
                <TableRow key={h.key}>
                  <TableCell className="font-medium">
                    <Link href={monthHref(h.key)} className="underline-offset-4 hover:underline">
                      {h.label}
                    </Link>
                    {h.key === currentKey && <span className="ml-2 text-xs text-muted-foreground">this month</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{h.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTotals(h.billed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTotals(h.collected)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${h.owing ? "font-medium text-destructive" : ""}`}>
                    {formatTotals(h.outstanding)}
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
