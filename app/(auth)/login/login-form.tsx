"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestLoginCode, verifyLoginCode } from "./actions";

// Two steps: type your work email, then type the 6-digit code that was emailed to you.
export function LoginForm({ next }: { next: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [wait, setWait] = useState(0); // seconds until another code can be requested

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function sendCode(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await requestLoginCode(formData);
      if (!result.ok) return setError(result.message ?? "Something went wrong.");
      setEmail(String(formData.get("email")).trim().toLowerCase());
      setStep("code");
      setWait(30);
    });
  }

  function verify(formData: FormData) {
    setError(null);
    startTransition(async () => {
      // On success the server redirects, so we only get here when the code was wrong.
      const result = await verifyLoginCode(formData);
      if (result && !result.ok) setError(result.message ?? "Something went wrong.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {step === "email"
            ? "Enter your work email and we'll send you a 6-digit code."
            : `We sent a code to ${email}. It works once and expires in 10 minutes.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === "email" ? (
          <form action={sendCode} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" autoFocus required defaultValue={email} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send code"}</Button>
          </form>
        ) : (
          <form action={verify} className="grid gap-4">
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="next" value={next} />
            <div className="grid gap-1.5">
              <Label htmlFor="code">6-digit code</Label>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                autoFocus
                required
                className="text-center text-lg tracking-[0.4em]"
              />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Sign in"}</Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => { setStep("email"); setError(null); }}>
                Use a different email
              </button>
              <button
                type="button"
                disabled={wait > 0 || pending}
                className="text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50 disabled:no-underline"
                onClick={() => {
                  const fd = new FormData();
                  fd.set("email", email);
                  sendCode(fd);
                }}
              >
                {wait > 0 ? `Send a new code (${wait}s)` : "Send a new code"}
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
