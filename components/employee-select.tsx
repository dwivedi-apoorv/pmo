"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type EmployeeOption = { id: string; name: string; role: string | null };


export function EmployeeSelect({
  name,
  employees,
  defaultValue = null,
  placeholder,
  allowNone = false,
  size = "default",
  className,
}: {
  name: string;
  employees: EmployeeOption[];
  defaultValue?: string | null;
  placeholder: string;
  allowNone?: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  const label = (e: EmployeeOption) => e.name;
  const items = [
    ...(allowNone ? [{ value: "none", label: "— None —" }] : []),
    ...employees.map((e) => ({ value: e.id, label: label(e) })),
  ];

  return (
    <Select name={name} items={items} defaultValue={defaultValue}>
      <SelectTrigger size={size} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
