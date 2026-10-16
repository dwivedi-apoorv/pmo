"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
    <>
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
      <div className="grid gap-2">
        <Label>Assigned to</Label>
        <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
          {people.map((e) => (
            <Label key={e.id} className="font-normal">
              <Checkbox
                name="assignees"
                value={e.id}
                defaultChecked={defaultAssigneeIds.includes(e.id)}
              />
              {e.name}
            </Label>
          ))}
        </div>
      </div>
    </>
  );
}
