"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const NEW = "__new__";

// Pick a reason from the list, or choose "Add a new reason" and type one. Submits the final text as `reason`;
// the server adds a new one to the list for next time.
export function ReasonPicker({
  id,
  options,
  required,
  onChange,
}: {
  id: string;
  options: string[];
  required: boolean;
  onChange: (value: string) => void;
}) {
  const [choice, setChoice] = useState("");
  const [typed, setTyped] = useState("");
  const value = choice === NEW ? typed.trim().replace(/\s+/g, " ") : choice;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        Reason {required ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}
      </Label>
      <select
        id={id}
        value={choice}
        onChange={(e) => {
          setChoice(e.target.value);
          onChange(e.target.value === NEW ? typed.trim() : e.target.value);
        }}
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
      >
        <option value="">{required ? "Select a reason…" : "No reason"}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value={NEW}>＋ Add a new reason…</option>
      </select>
      {choice === NEW && (
        <Input
          autoFocus
          value={typed}
          maxLength={80}
          onChange={(e) => {
            setTyped(e.target.value);
            onChange(e.target.value.trim().replace(/\s+/g, " "));
          }}
          placeholder="Type the new reason"
          aria-label="New reason"
        />
      )}
      <input type="hidden" name="reason" value={value} />
    </div>
  );
}
