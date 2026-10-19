"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/multi-select";
import type { Service } from "@/lib/services";

// Pick every service a project includes, or type a new one. Submits the ticked ones as `services` (ids)
// and any new names as `new_services`; the server creates the new ones when you save.
export function ServicePicker({ services, defaultSelected = [] }: { services: Service[]; defaultSelected?: string[] }) {
  const [added, setAdded] = useState<string[]>([]); // new names, created on save
  const [draft, setDraft] = useState("");

  function add() {
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (!added.some((a) => a.toLowerCase() === name.toLowerCase())) setAdded([...added, name]);
    setDraft("");
  }

  return (
    <div className="grid gap-1.5">
      <Label>Services</Label>
      <MultiSelect name="services" options={services} defaultSelected={defaultSelected} placeholder="Select services" />
      <div className="flex gap-2">
        <Input
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // don't submit the whole form
              add();
            }
          }}
          placeholder="Not in the list? Type a new service"
          aria-label="New service name"
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          <PlusIcon /> Add
        </Button>
      </div>
      {added.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {added.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs">
              {name} <span className="text-muted-foreground">(new)</span>
              <button
                type="button"
                aria-label={`Remove ${name}`}
                className="opacity-60 hover:opacity-100"
                onClick={() => setAdded(added.filter((a) => a !== name))}
              >
                <XIcon className="size-3" />
              </button>
              <input type="hidden" name="new_services" value={name} />
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Pick every service this project includes. A project can have several.</p>
    </div>
  );
}
