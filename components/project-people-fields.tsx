"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayISO } from "@/lib/reporting";
import { MultiSelect } from "@/components/multi-select";
import { EmployeeSelect, type EmployeeOption } from "@/components/employee-select";

// Project manager + assignees. Shared by the create and edit dialogs.
export function ProjectPeopleFields({
  managers,
  people,
  defaultManagerId = null,
  defaultAssigneeIds = [],
  showEffective = false,
}: {
  managers: EmployeeOption[];
  people: EmployeeOption[];
  defaultManagerId?: string | null;
  defaultAssigneeIds?: string[];
  /** Edit only: lets you date a change to the manager or team (default today). */
  showEffective?: boolean;
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
      {showEffective && (
        <div className="grid gap-1.5 sm:col-span-2 sm:max-w-xs">
          <Label htmlFor="effective_date">Manager and team changes take effect on</Label>
          <Input id="effective_date" name="effective_date" type="date" defaultValue={todayISO()} max={todayISO()} />
          <p className="text-xs text-muted-foreground">
            Only used if you change the manager or team. Pick an earlier date to record a handover that already
            happened.
          </p>
        </div>
      )}
    </div>
  );
}
