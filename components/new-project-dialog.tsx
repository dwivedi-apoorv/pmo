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
import { ProjectFields } from "@/components/project-fields";
import { ServicePicker } from "@/components/service-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_NOTE_LENGTH } from "@/lib/notes";
import type { Service } from "@/lib/services";
import type { EmployeeOption } from "@/components/employee-select";
import { ProjectPeopleFields } from "@/components/project-people-fields";
import { createProject } from "@/app/actions";

export function NewProjectDialog({
  employees,
  managers,
  services,
  showPayment = true,
  currencies = ["USD", "CAD"],
  open,
  onOpenChange: setOpen,
}: {
  employees: EmployeeOption[];
  managers: EmployeeOption[];
  services: Service[];
  showPayment?: boolean;
  currencies?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createProject(formData);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Project manager and assignees are optional and can be changed later.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="grid gap-4">
          <ProjectFields showPayment={showPayment} currencies={currencies} />
          <ServicePicker services={services} />
          <ProjectPeopleFields managers={managers} people={employees} />
          <div className="grid gap-1.5">
            <Label htmlFor="onboarding_notes">
              Onboarding notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="onboarding_notes"
              name="onboarding_notes"
              rows={3}
              maxLength={MAX_NOTE_LENGTH}
              placeholder="Goals, access details, key contacts, what was promised in the sales call… You can edit them later."
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
