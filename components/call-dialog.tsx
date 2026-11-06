"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/simple-select";
import { WEEKDAYS } from "@/lib/calls";
import { deleteCall, saveCall } from "@/app/actions";

export type CallValues = { id: string; project_id: string; weekday: number; call_time: string; duration_min: number | null; link: string | null; notes: string | null };

// Add a weekly client call, or edit / delete one (when `call` is given). Times are India time.
export function CallDialog({ projects, call, label }: { projects: { value: string; label: string }[]; call?: CallValues; label?: string }) {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState<string | null>(call?.project_id ?? null);
  const [weekday, setWeekday] = useState<string | null>(call ? String(call.weekday) : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    setError(null);
    startTransition(async () => {
      const r = await saveCall({
        id: call?.id,
        projectId: project ?? "",
        weekday: Number(weekday),
        time: String(f.get("time") ?? ""),
        duration: String(f.get("duration") ?? "") === "" ? null : Number(f.get("duration")),
        link: String(f.get("link") ?? ""),
        notes: String(f.get("notes") ?? ""),
      });
      if (r.ok) setOpen(false);
      else setError(r.message);
    });
  }

  function remove() {
    if (!call || !window.confirm("Delete this weekly call?")) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteCall(call.id);
      if (r.ok) setOpen(false);
      else setError(r.message);
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant={call ? "ghost" : "default"} onClick={() => setOpen(true)}>
        {label ?? (call ? "Edit" : "Add a call")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{call ? "Edit weekly call" : "Add a weekly call"}</DialogTitle>
            <DialogDescription>Repeats every week on this day and time. Time is India time (IST).</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}>
            <div className="grid gap-1.5">
              <Label>Project</Label>
              <SimpleSelect name="project" options={projects} defaultValue={call?.project_id ?? null} placeholder="Select project" required onValueChange={setProject} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Day</Label>
                <SimpleSelect name="weekday" options={WEEKDAYS} defaultValue={call ? String(call.weekday) : null} placeholder="Select day" required onValueChange={setWeekday} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="call-time">Time (IST)</Label>
                <Input id="call-time" name="time" type="time" defaultValue={call?.call_time.slice(0, 5) ?? ""} required />
              </div>
            </div>
            <div className="grid gap-1.5 sm:max-w-40">
              <Label htmlFor="call-duration">Duration (min) <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="call-duration" name="duration" type="number" min="1" max="600" inputMode="numeric" defaultValue={call?.duration_min ?? ""} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="call-link">Meeting link <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="call-link" name="link" placeholder="https://meet.google.com/…" defaultValue={call?.link ?? ""} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="call-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="call-notes" name="notes" maxLength={500} defaultValue={call?.notes ?? ""} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              {call ? <Button type="button" variant="ghost" onClick={remove} disabled={pending}>Delete</Button> : <span />}
              <Button type="submit" disabled={pending || !project || !weekday}>{pending ? "Saving…" : "Save"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
