"use client";

import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/multi-select";
import { EmployeeSelect, type EmployeeOption } from "@/components/employee-select";

// Project manager + assignees. Shared by the create and edit dialogs.
export function ProjectPeopleFields({
  managers,
  people,
  defaultManagerId = null,
  defaultAssigneeIds = [],
}: {
  managers: EmployeeOption[];
  people: EmployeeOption[];
  defaultManagerId?: string | null;
  defaultAssigneeIds?: string[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label>Project manager</Label>
        <EmployeeSelect
          name="project_manager_id"
          employees={managers}
          defaultValue={defaultManagerId ?? "none"}
          placeholder="— None —"
          allowNone
          className="w-full"
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Assigned to</Label>
        <MultiSelect
          name="assignees"
          options={people}
          defaultSelected={defaultAssigneeIds}
          placeholder="Select people"
        />
      </div>
    </div>
  );
}
