"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/currency";
import { splitPayment } from "@/app/actions";

// Splits one unpaid payment into 2-3 installments, each with its own invoice date. The first keeps the original date.
export function SplitPaymentDialog({ projectId, dueDate, amount, currency }: { projectId: string; dueDate: string; amount: number; currency: string }) {
  const half = Math.round((amount / 2) * 100) / 100;
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<{ date: string; amount: string }[]>([
    { date: dueDate, amount: String(half) },
    { date: "", amount: String(Math.round((amount - half) * 100) / 100) },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = parts.reduce((n, p) => n + Math.round((Number(p.amount) || 0) * 100), 0) / 100;
  const matches = Math.round(total * 100) === Math.round(amount * 100);
  const set = (i: number, patch: Partial<{ date: string; amount: string }>) => setParts(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await splitPayment(projectId, dueDate, parts.map((p) => ({ date: p.date, amount: Number(p.amount) })));
      if (r.ok) setOpen(false);
      else setError(r.message);
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Split</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Split the payment due {dueDate}</DialogTitle>
            <DialogDescription>
              {formatMoney(amount, currency)} in 2 or 3 installments. Each installment has its own invoice date and is marked paid on its own. The first one keeps the original date.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {parts.map((p, i) => (
              <div key={i} className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`split-date-${i}`}>Installment {i + 1} invoice date</Label>
                  <Input id={`split-date-${i}`} type="date" value={p.date} disabled={i === 0} required onChange={(e) => set(i, { date: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`split-amount-${i}`}>Amount ({currency})</Label>
                  <Input id={`split-amount-${i}`} type="number" min="0.01" step="0.01" inputMode="decimal" value={p.amount} required onChange={(e) => set(i, { amount: e.target.value })} />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm">
              {parts.length < 3 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setParts([...parts, { date: "", amount: "0" }])}>＋ Add a third installment</Button>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setParts(parts.slice(0, 2))}>Remove third installment</Button>
              )}
              <span className={matches ? "text-muted-foreground" : "font-medium text-destructive"}>
                {formatMoney(total, currency)} of {formatMoney(amount, currency)}
              </span>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending || !matches}>{pending ? "Splitting…" : "Split payment"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
