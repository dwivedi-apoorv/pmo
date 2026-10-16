"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SimpleSelect({
  name,
  options,
  defaultValue = null,
  placeholder,
  required = false,
}: {
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | null;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <Select name={name} items={[...options]} defaultValue={defaultValue} required={required}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
