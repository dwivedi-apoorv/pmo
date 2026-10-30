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
import { ProjectHistory } from "@/components/project-history";
import { ProjectNotes } from "@/components/project-notes";
import type { NoteVersion, ProjectNote } from "@/lib/notes";
import { ServicePicker } from "@/components/service-picker";
import type { Service } from "@/lib/services";
import type { TeamPeriod } from "@/lib/history";
import { ProjectFields, type ProjectValues } from "@/components/project-fields";
import { updateProject } from "@/app/actions";

export function EditProjectDialog({
  id,
  values,
  managers,
  people,
  managerId,
  assigneeIds,
  history,
  services,
  serviceIds,
  notes,
  noteVersions,
  showPayment = true,
  currencies = ["USD", "CAD"],
}: {
  id: string;
  values: ProjectValues;
  managers: EmployeeOption[];
  people: EmployeeOption[];
  managerId: string | null;
  assigneeIds: string[];
  history: TeamPeriod[];
  services: Service[];
  serviceIds: string[];
  notes: ProjectNote[];
  noteVersions: NoteVersion[];
  showPayment?: boolean;
  currencies?: string[];
}) {
  const [tab, setTab] = useState<"details" | "history" | "notes">("details");
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

        <div role="tablist" aria-label="Project" className="inline-flex w-fit rounded-lg bg-muted p-1 text-sm">
          {(
            [
              ["details", "Details"],
              ["history", `History (${history.length})`],
              ["notes", `Notes (${notes.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`tab-${key}-${id}`}
              aria-selected={tab === key}
              aria-controls={`panel-${key}-${id}`}
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1 transition-colors ${
                tab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Both panels stay mounted (just hidden) so switching tabs never loses what you typed. */}
        <div role="tabpanel" id={`panel-details-${id}`} aria-labelledby={`tab-details-${id}`} hidden={tab !== "details"}>
          <form action={onSubmit} className="grid gap-4">
            <input type="hidden" name="project_id" value={id} />
            <ProjectFields values={values} showPayment={showPayment} currencies={currencies} />
            <ServicePicker services={services} defaultSelected={serviceIds} />
            <ProjectPeopleFields
              managers={managers}
              people={people}
              defaultManagerId={managerId}
              defaultAssigneeIds={assigneeIds}
              showEffective
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </div>
        <div role="tabpanel" id={`panel-notes-${id}`} aria-labelledby={`tab-notes-${id}`} hidden={tab !== "notes"}>
          <ProjectNotes projectId={id} notes={notes} versions={noteVersions} />
        </div>
        <div role="tabpanel" id={`panel-history-${id}`} aria-labelledby={`tab-history-${id}`} hidden={tab !== "history"}>
          <ProjectHistory history={history} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
