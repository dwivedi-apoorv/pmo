"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deactivateEmployee } from "@/app/actions";

type Option = { id: string; name: string };

function Handover({
  title,
  projects,
  candidates,
  value,
  onChange,
  emptyHint,
}: {
  title: string;
  projects: Option[];
  candidates: Option[];
  value: string | null;
  onChange: (v: string | null) => void;
  emptyHint: string;
}) {
  if (projects.length === 0) return null;
  const items = candidates.map((c) => ({ value: c.id, label: c.name }));
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <p className="text-sm font-medium">
        {title} ({projects.length})
      </p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        {projects.map((p) => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ul>
      {candidates.length === 0 ? (
        <p className="text-sm text-destructive">{emptyHint}</p>
      ) : (
        <div className="grid gap-1.5">
          <Label>Hand over to</Label>
          <Select items={items} value={value} onValueChange={(v) => onChange(v as string | null)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a person" />
            </SelectTrigger>
            <SelectContent>
              {items.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function DeactivateEmployeeDialog({
  employee,
  managedProjects,
  assignedProjects,
  managerCandidates,
  assigneeCandidates,
}: {
  employee: Option;
  managedProjects: Option[];
  assignedProjects: Option[];
  managerCandidates: Option[];
  assigneeCandidates: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [managerTo, setManagerTo] = useState<string | null>(null);
  const [assigneeTo, setAssigneeTo] = useState<string | null>(null);

  const ready =
    (managedProjects.length === 0 || managerTo !== null) &&
    (assignedProjects.length === 0 || assigneeTo !== null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
      setManagerTo(null);
      setAssigneeTo(null);
    }
  }

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await deactivateEmployee(formData);
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  const hasOpen = managedProjects.length + assignedProjects.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Deactivate</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate {employee.name}</DialogTitle>
          <DialogDescription>
            {hasOpen
              ? "They still have open projects. Hand them over before deactivating."
              : "They have no open projects. They'll be hidden from dropdowns but kept on past projects."}
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="grid gap-4">
          <input type="hidden" name="employee_id" value={employee.id} />
          <input type="hidden" name="manager_to" value={managerTo ?? ""} />
          <input type="hidden" name="assignee_to" value={assigneeTo ?? ""} />

          <Handover
            title="Projects they manage"
            projects={managedProjects}
            candidates={managerCandidates}
            value={managerTo}
            onChange={setManagerTo}
            emptyHint="No other active project manager to hand over to. Add or reactivate one first."
          />
          <Handover
            title="Projects they're assigned to"
            projects={assignedProjects}
            candidates={assigneeCandidates}
            value={assigneeTo}
            onChange={setAssigneeTo}
            emptyHint="No other active team member to hand over to. Add or reactivate one first."
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending || !ready}>
            {pending ? "Deactivating…" : "Deactivate"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
