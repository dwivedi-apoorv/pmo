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
import { deleteEmployee } from "@/app/actions";

export function DeleteEmployeeDialog({
  employee,
  assignedCount,
  managedCount,
}: {
  employee: { id: string; name: string };
  assignedCount: number;
  managedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteEmployee(formData);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>Delete</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {employee.name} permanently?</DialogTitle>
          <DialogDescription>
            This can&apos;t be undone. {employee.name} will be removed from {assignedCount}{" "}
            {assignedCount === 1 ? "project" : "projects"} (including ended ones) and left blank as project manager on{" "}
            {managedCount} {managedCount === 1 ? "project" : "projects"}. Their page will stop working.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="grid gap-3">
          <input type="hidden" name="employee_id" value={employee.id} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? "Deleting…" : "Yes, delete permanently"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
