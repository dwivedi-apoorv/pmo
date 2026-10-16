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
import type { EmployeeOption } from "@/components/employee-select";
import { ProjectPeopleFields } from "@/components/project-people-fields";
import { ProjectFields, type ProjectValues } from "@/components/project-fields";
import { updateProject } from "@/app/actions";

export function EditProjectDialog({
  id,
  values,
  managers,
  people,
  managerId,
  assigneeIds,
}: {
  id: string;
  values: ProjectValues;
  managers: EmployeeOption[];
  people: EmployeeOption[];
  managerId: string | null;
  assigneeIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await updateProject(formData);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${values.name}`} />}
      >
        <PencilIcon />
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            Project manager and assignees are optional.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="grid gap-4">
          <input type="hidden" name="project_id" value={id} />
          <ProjectFields values={values} />
          <ProjectPeopleFields
            managers={managers}
            people={people}
            defaultManagerId={managerId}
            defaultAssigneeIds={assigneeIds}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
