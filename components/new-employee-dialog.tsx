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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createEmployee } from "@/app/actions";

const NEW_ROLE = "__new__";

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
  const [choice, setChoice] = useState<string | null>(null); // an existing role, or NEW_ROLE
  const [newRole, setNewRole] = useState("");

  const items = [...roles.map((r) => ({ value: r, label: r })), { value: NEW_ROLE, label: "+ New role…" }];
  const role = choice === NEW_ROLE ? newRole : (choice ?? "");

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
      setChoice(null);
      setNewRole("");
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
          <div className="grid gap-1.5">
            <Label>Role</Label>
            <Select items={items} value={choice} onValueChange={(v) => setChoice(v as string | null)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {choice === NEW_ROLE && (
              <Input
                placeholder="e.g. Content Writer"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                autoFocus
              />
            )}
            <input type="hidden" name="role" value={role} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add employee"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
