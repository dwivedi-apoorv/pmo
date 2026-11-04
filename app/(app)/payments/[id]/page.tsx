import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { limitTo, requirePagePermission } from "@/lib/access";
import type { Due } from "@/lib/dues";
import { formatMoney, formatTotals, minusTotals, sumByCurrency } from "@/lib/currency";
import { methodLabel, nextPaymentDate, termLabel, type PaymentPlan } from "@/lib/payments";
import { daysUntil, todayISO } from "@/lib/reporting";
import { STATUS_LABEL, type ProjectStatus } from "@/lib/status";
import { undoPaid } from "@/app/actions";
import { EditPaidDate, MarkPaidForm } from "@/components/mark-paid-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

type Project = { id: string; name: string; client_name: string; status: ProjectStatus } & PaymentPlan;

// One client's payment history: the plan, the totals, and every payment in the ledger, newest first.
export default async function PaymentHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { scope } = await requirePagePermission("payments");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || (scope && !scope.includes(id))) notFound();

  const [projectRes, ledgerRes] = await Promise.all([
    limitTo(
      supabase.from("projects").select("id, name, client_name, status, payment_date, payment_term, payment_method, payment_amount_usd, currency").eq("id", id),
      scope,
      "id"
    ).maybeSingle<Project>(),
    supabase.from("payment_dues").select("project_id, due_date, amount_usd, currency, term, method, status, paid_at").eq("project_id", id).order("due_date", { ascending: false }).returns<Due[]>(),
  ]);
  const error = projectRes.error ?? ledgerRes.error;
  if (error) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <PageHeader title="Payment history" />
        <p className="text-destructive">Could not load data: {error.message}</p>
      </div>
    );
  }
  const p = projectRes.data;
  if (!p) notFound();

  const today = todayISO();
  const ledger = ledgerRes.data ?? [];
  const billed = sumByCurrency(ledger, (d) => ({ amount: d.amount_usd, currency: d.currency }));
  const paid = sumByCurrency(ledger.filter((d) => d.status === "paid"), (d) => ({ amount: d.amount_usd, currency: d.currency }));
  const outstanding = minusTotals(billed, paid);
  const owing = Object.values(outstanding).some((v) => v > 0.004);
  const next = p.status === "active" ? nextPaymentDate(p, today) : null;
  const upcoming = next && !ledger.some((d) => d.due_date === next) ? next : null;
  const paidDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "—");

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Back to projects
      </Link>
      <PageHeader title={`${p.client_name}: payment history`} description={`${p.name} · ${STATUS_LABEL[p.status]}`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Billed so far", value: formatTotals(billed) },
          { label: "Collected", value: formatTotals(paid) },
          { label: "Outstanding", value: formatTotals(outstanding), bad: owing },
          {
            label: "Payment plan",
            value: p.payment_term ? `${formatMoney(p.payment_amount_usd ?? 0, p.currency)} · ${termLabel(p.payment_term)}` : "Not set",
            sub: [methodLabel(p.payment_method), p.payment_date ? `first payment ${p.payment_date}` : ""].filter(Boolean).join(" · "),
          },
        ].map((c) => (
          <Card size="sm" key={c.label}>
            <CardHeader>
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className={`text-xl ${c.bad ? "text-destructive" : ""}`}>{c.value}</CardTitle>
              {c.sub && <p className="text-xs text-muted-foreground">{c.sub}</p>}
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Payments
            <span className="ml-2 text-sm font-normal text-muted-foreground">{ledger.length}</span>
          </CardTitle>
          <CardDescription>
            Every payment in the ledger, newest first.
            {upcoming && ` The next one, due ${upcoming}, opens automatically.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Due date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid on</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((d) => {
                  const overdue = d.status === "due" && d.due_date < today;
                  return (
                    <TableRow key={d.due_date}>
                      <TableCell className="tabular-nums">{d.due_date}</TableCell>
                      <TableCell className="tabular-nums">{formatMoney(d.amount_usd, d.currency)}</TableCell>
                      <TableCell>{termLabel(d.term) || "—"}</TableCell>
                      <TableCell>{methodLabel(d.method) || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={d.status === "paid" ? "secondary" : overdue ? "destructive" : "outline"}>
                          {d.status === "paid" ? "Paid" : overdue ? "Overdue" : "Due"}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {d.status === "paid" ? (
                          <>
                            {paidDate(d.paid_at)}
                            {(() => {
                              const late = -daysUntil(d.due_date, paidDate(d.paid_at));
                              return late > 0 ? <span className="ml-2 text-xs text-destructive">{late} {late === 1 ? "day" : "days"} late</span> : null;
                            })()}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {d.status === "paid" ? (
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            <EditPaidDate projectId={p.id} dueDate={d.due_date} current={paidDate(d.paid_at)} />
                            <form action={undoPaid}>
                              <input type="hidden" name="project_id" value={p.id} />
                              <input type="hidden" name="due_date" value={d.due_date} />
                              <Button type="submit" size="sm" variant="ghost">Undo</Button>
                            </form>
                          </div>
                        ) : (
                          <MarkPaidForm projectId={p.id} dueDate={d.due_date} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
