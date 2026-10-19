"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RolePicker } from "@/components/role-picker";
import { createEmployee } from "@/app/actions";

export function NewEmployeeDialog({
  roles,
  open,
  onOpenChange: setOpen,
}: {
  roles: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
    }
  }

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createEmployee(formData);
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add employee</DialogTitle>
          <DialogDescription>
            Employees with the role “Project Manager” can be picked as a project manager. Everyone else can be
            assigned to projects.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="emp-name">Name</Label>
            <Input id="emp-name" name="name" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="emp-email">Email</Label>
            <Input id="emp-email" name="email" type="email" required />
          </div>
          <RolePicker roles={roles} />

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add employee"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
