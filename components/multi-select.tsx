"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Option = { id: string; name: string };

// A dropdown where you can tick several options. Each ticked option is submitted with the
// form as its own `name=<id>` value (read on the server with formData.getAll(name)).
export function MultiSelect({
  name,
  options,
  defaultSelected = [],
  placeholder,
}: {
  name: string;
  options: Option[];
  defaultSelected?: string[];
  placeholder: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected));

  const chosen = options.filter((o) => selected.has(o.id));
  const summary =
    chosen.length === 0
      ? null
      : chosen.length <= 2
        ? chosen.map((o) => o.name).join(", ")
        : `${chosen[0].name}, ${chosen[1].name} +${chosen.length - 2}`;

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  return (
    <>
      {[...selected].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="outline" className="w-full justify-between font-normal" />}
        >
          <span className={summary ? "truncate" : "truncate text-muted-foreground"}>{summary ?? placeholder}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 w-(--anchor-width) overflow-y-auto">
          {options.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No one to assign.</p>}
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id}
              checked={selected.has(o.id)}
              closeOnClick={false}
              onCheckedChange={(on) => toggle(o.id, on)}
            >
              {o.name}
            </DropdownMenuCheckboxItem>
          ))}
          {selected.size > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem closeOnClick={false} onClick={() => setSelected(new Set())}>
                Clear selection
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
