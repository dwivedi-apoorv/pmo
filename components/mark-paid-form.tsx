"use client";

import { useState, useTransition } from "react";
import { markPaid, removePayment, sendInvoice, updatePaidDate } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// "Mark as paid" that asks which day the money actually arrived (today by default), so a payment
// received on 7 April and recorded on the 10th still gets 7 April.
export function MarkPaidForm({ projectId, dueDate, size = "sm" }: { projectId: string; dueDate: string; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" size={size} variant="outline" onClick={() => setOpen(true)}>
        Mark as paid
      </Button>
    );
  }
  return (
    <form action={markPaid} className="flex flex-wrap items-center justify-end gap-2" onSubmit={() => setOpen(false)}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="due_date" value={dueDate} />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Paid on
        <Input type="date" name="paid_on" defaultValue={todayIST()} max={todayIST()} required className="h-8 w-36" />
      </label>
      <Button type="submit" size={size}>Confirm</Button>
      <Button type="button" size={size} variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

// Corrects the paid date of a payment that is already marked paid.
export function EditPaidDate({ projectId, dueDate, current }: { projectId: string; dueDate: string; current: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Edit date
      </Button>
    );
  }
  return (
    <form action={updatePaidDate} className="flex flex-wrap items-center justify-end gap-2" onSubmit={() => setOpen(false)}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="due_date" value={dueDate} />
      <Input type="date" name="paid_on" defaultValue={current} max={todayIST()} required className="h-8 w-36" aria-label="Paid on" />
      <Button type="submit" size="sm">Save</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

// Admin-only: removes an unpaid payment after a confirmation (it's kept as "removed" and can be restored).
export function RemovePaymentButton({ projectId, dueDate, label }: { projectId: string; dueDate: string; label: string }) {
  return (
    <form
      action={removePayment}
      onSubmit={(e) => {
        if (!window.confirm(`Remove the payment due ${dueDate} (${label})?\n\nIt won't count as owed or overdue any more. You can restore it later.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="due_date" value={dueDate} />
      <Button type="submit" size="sm" variant="ghost" className="text-destructive hover:text-destructive">Remove</Button>
    </form>
  );
}

// "Send invoice": creates the Stripe invoice and emails it to the client, after a confirmation.
export function SendInvoiceButton({ projectId, dueDate, label, email }: { projectId: string; dueDate: string; label: string; email: string | null }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Create and email a ${label} Stripe invoice (invoice date ${dueDate}) to ${email ?? "the client"}?\n\nThis sends a real email to the client unless Stripe is in test mode.`)) return;
          startTransition(async () => setResult(await sendInvoice(projectId, dueDate)));
        }}
      >
        {pending ? "Sending…" : "Send invoice"}
      </Button>
      {result && <span role="status" className={`max-w-56 text-right text-xs ${result.ok ? "text-muted-foreground" : "text-destructive"}`}>{result.message}</span>}
    </span>
  );
}
