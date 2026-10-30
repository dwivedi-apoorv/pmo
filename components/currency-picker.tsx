"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currencyOrder, isCurrencyCode, normalizeCurrency } from "@/lib/currency";

const NEW = "__new__";

// Pick the currency a project is billed in, or add a new one by its 3-letter code (like adding a new service).
// Submits the final code as `currency`; the server adds a new code to the list when the project is saved.
export function CurrencyPicker({
  options,
  defaultValue = "USD",
  onChange,
}: {
  options: string[];
  defaultValue?: string | null;
  onChange?: (code: string) => void;
}) {
  const codes = currencyOrder([...new Set([...options, defaultValue || "USD"])]);
  const [choice, setChoice] = useState(defaultValue || "USD");
  const [typed, setTyped] = useState("");
  const code = choice === NEW ? normalizeCurrency(typed) : choice;
  const bad = choice === NEW && typed.trim() !== "" && !isCurrencyCode(typed.trim().toUpperCase());

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="currency">Currency</Label>
      <select
        id="currency"
        value={choice}
        onChange={(e) => {
          setChoice(e.target.value);
          onChange?.(e.target.value === NEW ? normalizeCurrency(typed) || "USD" : e.target.value);
        }}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value={NEW}>＋ Add a currency…</option>
      </select>
      {choice === NEW && (
        <>
          <Input
            autoFocus
            value={typed}
            maxLength={3}
            placeholder="e.g. GBP"
            aria-label="New currency code"
            aria-invalid={bad}
            className="uppercase"
            onChange={(e) => {
              setTyped(e.target.value);
              onChange?.(normalizeCurrency(e.target.value) || "USD");
            }}
          />
          {bad && <p className="text-xs text-destructive">That isn&apos;t a currency code. Use the 3-letter code, like GBP or EUR.</p>}
        </>
      )}
      <input type="hidden" name="currency" value={code} />
    </div>
  );
}
