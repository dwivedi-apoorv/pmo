"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SimpleSelect({
  name,
  options,
  defaultValue = null,
  placeholder,
  required = false,
  onValueChange,
}: {
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | null;
  placeholder: string;
  required?: boolean;
  onValueChange?: (value: string | null) => void;
}) {
  return (
    <Select
      name={name}
      items={[...options]}
      defaultValue={defaultValue}
      required={required}
      onValueChange={(v) => onValueChange?.(v as string | null)}
    >
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
