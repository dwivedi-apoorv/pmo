"use client";

import { useState, useTransition } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openDuesNow } from "@/app/actions";

// Runs the same job the monthly schedule runs, for the current month, on demand.
export function OpenDuesButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            setResult(await openDuesNow());
          })
        }
      >
        <RefreshCwIcon className={pending ? "animate-spin" : ""} />
        Generate this month&apos;s dues
      </Button>
      {result && (
        <span className={`text-xs ${result.ok ? "text-muted-foreground" : "text-destructive"}`} role="status">
          {result.message}
        </span>
      )}
    </div>
  );
}
