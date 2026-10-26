"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { runDigestNow } from "@/app/(app)/settings/actions";

export function RunDigestButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setResult(null);
              setResult(await runDigestNow());
              router.refresh();
            })
          }
        >
          {pending ? "Running…" : "Run today's summary now"}
        </Button>
      </div>
      {result && <p role="status" className={`whitespace-pre-wrap text-sm ${result.ok ? "text-muted-foreground" : "text-destructive"}`}>{result.message}</p>}
    </div>
  );
}
