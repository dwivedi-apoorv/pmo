"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NEW_ROLE = "__new__";

// Role dropdown with a "+ New role…" option that reveals a text box. Submits the chosen role as `role`.
// Shared by the Add and Edit employee dialogs so both pick roles the same way.
export function RolePicker({ roles, defaultRole = null }: { roles: string[]; defaultRole?: string | null }) {
  // Make sure the person's current role is selectable even if nobody else has it.
  const options = defaultRole && !roles.includes(defaultRole) ? [...roles, defaultRole].sort() : roles;
  const [choice, setChoice] = useState<string | null>(defaultRole); // an existing role, or NEW_ROLE
  const [newRole, setNewRole] = useState("");

  const items = [...options.map((r) => ({ value: r, label: r })), { value: NEW_ROLE, label: "+ New role…" }];
  const role = choice === NEW_ROLE ? newRole : (choice ?? "");

  return (
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
        <Input placeholder="e.g. Content Writer" value={newRole} onChange={(e) => setNewRole(e.target.value)} autoFocus />
      )}
      <input type="hidden" name="role" value={role} />
    </div>
  );
}
