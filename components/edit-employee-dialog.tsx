"use client";

import { useState, useTransition } from "react";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RolePicker } from "@/components/role-picker";
import { updateEmployee } from "@/app/actions";

export function EditEmployeeDialog({
  employee,
  roles,
}: {
  employee: { id: string; name: string; email: string | null; role: string | null };
  roles: string[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setError(null);
  }

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await updateEmployee(formData);
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${employee.name}`} title="Edit" />}>
        <PencilIcon />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {employee.name}</DialogTitle>
          <DialogDescription>
            Changing the name also changes the link to their page. Their project history keeps working and shows
            the new name.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="grid gap-4">
          <input type="hidden" name="employee_id" value={employee.id} />
          <div className="grid gap-1.5">
            <Label htmlFor={`edit-name-${employee.id}`}>Name</Label>
            <Input id={`edit-name-${employee.id}`} name="name" defaultValue={employee.name} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`edit-email-${employee.id}`}>Email</Label>
            <Input id={`edit-email-${employee.id}`} name="email" type="email" defaultValue={employee.email ?? ""} required />
          </div>
          <RolePicker roles={roles} defaultRole={employee.role} />

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
