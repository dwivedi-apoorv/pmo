"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createChatsForExistingProjects } from "@/app/(app)/settings/actions";

export function CreateChatsButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button variant="outline" disabled={pending} onClick={() => start(async () => { setResult(null); setResult(await createChatsForExistingProjects()); })}>
          {pending ? "Creating chats…" : "Create chats for active projects that don't have one"}
        </Button>
      </div>
      {result && <p role="status" className={`whitespace-pre-wrap text-sm ${result.ok ? "text-muted-foreground" : "text-destructive"}`}>{result.message}</p>}
    </div>
  );
}
