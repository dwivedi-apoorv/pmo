"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/multi-select";

// Pick every reason that applies, or type a new one. Ticked ones are submitted as `reasons` and new ones as
// `new_reasons`; the server adds new ones to the list for next time.
export function ReasonPicker({ id, options, required }: { id: string; options: string[]; required: boolean }) {
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  function add() {
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (!added.some((a) => a.toLowerCase() === name.toLowerCase())) setAdded([...added, name]);
    setDraft("");
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        Reasons {required ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}
      </Label>
      <MultiSelect name="reasons" options={options.map((o) => ({ id: o, name: o }))} placeholder="Select reasons" />
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Not in the list? Type a new reason"
          aria-label="New reason"
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
              <button type="button" aria-label={`Remove ${name}`} className="opacity-60 hover:opacity-100" onClick={() => setAdded(added.filter((a) => a !== name))}>
                <XIcon className="size-3" />
              </button>
              <input type="hidden" name="new_reasons" value={name} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
