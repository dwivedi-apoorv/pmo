"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteProject, getDeleteSummary, requestDeleteCode } from "@/app/actions";

type Summary = Extract<Awaited<ReturnType<typeof getDeleteSummary>>, { ok: true }>;

// Three safeguards before a project is erased for good: a warning that lists what goes with it, the project's
// name typed back, and a one-time code emailed to the admin.
export function DeleteProjectDialog({ id, name, open, onOpenChange }: { id: string; name: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const [erase, setErase] = useState(false);
  const [codeSent, setCodeSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setSummary(null); setTyped(""); setCode(""); setErase(false); setCodeSent(null); setError(null);
    getDeleteSummary(id).then((r) => (r.ok ? setSummary(r) : setError(r.error)));
  }, [open, id]);

  const nameMatches = typed.trim() === name;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function sendCode() {
    setError(null);
    start(async () => {
      const r = await requestDeleteCode(id);
      if (r.ok) setCodeSent(r.message);
      else setError(r.message);
    });
  }

  function confirmDelete() {
    setError(null);
    start(async () => {
      const r = await deleteProject({ projectId: id, typedName: typed, code, eraseActivity: erase });
      if (r.ok) {
        onOpenChange(false);
        router.refresh();
      } else setError(r.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><AlertTriangleIcon className="size-5" /> Permanently delete “{name}”</DialogTitle>
          <DialogDescription>This cannot be undone. Nobody, including you, can get it back.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">Everything linked to this project will be erased:</p>
            {summary ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                <li>{plural(summary.payments, "payment")} in the ledger ({summary.paid} paid, {summary.paidTotal} collected). Past revenue totals will drop by that amount.</li>
                <li>{plural(summary.reports, "report record")}</li>
                <li>{plural(summary.notes, "note")}, with their edit history</li>
                <li>Its team assignments and {plural(summary.teamHistory, "team history entry").replace("entrys", "entries")}</li>
                <li>{plural(summary.statusChanges, "status change")} and its services tags</li>
              </ul>
            ) : (
              <p className="mt-2 text-muted-foreground">{error ?? "Checking what will be removed…"}</p>
            )}
          </div>

          {summary && (
            <>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} className="mt-1" />
                <span>
                  Also erase its {plural(summary.activity, "line")} in the Activity log
                  <span className="block text-xs text-muted-foreground">Leave this off to keep the history of what was done. A line recording the deletion is always added.</span>
                </span>
              </label>

              <div className="grid gap-1.5">
                <Label htmlFor={`confirm-${id}`}>Type the project name to confirm: <span className="font-semibold">{name}</span></Label>
                <Input id={`confirm-${id}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={name} />
              </div>

              {!codeSent ? (
                <Button variant="outline" onClick={sendCode} disabled={pending || !nameMatches}>{pending ? "Sending…" : "Email me a confirmation code"}</Button>
              ) : (
                <div className="grid gap-2">
                  <p className="text-sm text-muted-foreground">{codeSent}</p>
                  <Label htmlFor={`code-${id}`}>Confirmation code</Label>
                  <Input id={`code-${id}`} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" className="max-w-40 tracking-widest" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="destructive" onClick={confirmDelete} disabled={pending || !nameMatches || code.replace(/\s/g, "").length !== 6}>{pending ? "Deleting…" : "Delete permanently"}</Button>
                    <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={sendCode} disabled={pending}>Send a new code</button>
                  </div>
                </div>
              )}
            </>
          )}
          {error && summary && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
