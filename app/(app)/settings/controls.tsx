"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectMicrosoft, installBotForEveryone, sendTestMessage } from "./actions";

export function TestMessageButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setResult(null);
              try {
                const r = await sendTestMessage();
                setResult({ ok: r.ok, text: r.ok ? `Sent via ${r.method === "bot" ? "the bot" : "the connected account"}. Check Teams.` : (r.detail ?? "Failed.") });
              } catch (e) {
                setResult({ ok: false, text: e instanceof Error ? e.message : "Failed." });
              }
            })
          }
        >
          {pending ? "Sending…" : "Send a test message to me"}
        </Button>
      </div>
      {result && (
        <p role="status" className={`text-sm ${result.ok ? "text-muted-foreground" : "text-destructive"} whitespace-pre-wrap`}>
          {result.text}
        </p>
      )}
    </div>
  );
}

export function InstallBotButton() {
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<{ name: string; ok: boolean; detail?: string }[] | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setRows(null);
              try {
                setRows(await installBotForEveryone());
              } catch (e) {
                setRows([{ name: "Error", ok: false, detail: e instanceof Error ? e.message : "Failed." }]);
              }
            })
          }
        >
          {pending ? "Installing… (this can take a minute)" : "Install the bot for everyone"}
        </Button>
      </div>
      {rows && (
        <ul className="grid gap-1 text-sm">
          {rows.map((r) => (
            <li key={r.name} className={r.ok ? "text-muted-foreground" : "text-destructive"}>
              {r.ok ? "✓" : "✗"} {r.name}
              {r.detail ? `: ${r.detail}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DisconnectButton() {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await disconnectMicrosoft(); })}>
      {pending ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}
