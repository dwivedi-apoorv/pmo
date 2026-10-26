import { requirePageAdmin } from "@/lib/access";
import { NOTIFICATION_KINDS, getDisabledKinds, getMethod } from "@/lib/notify/send";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { noteDateTime } from "@/lib/notes";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RunDigestButton } from "@/components/run-digest-button";
import { saveKinds } from "../settings/actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { digest: "Morning summary", assigned: "Added to project", status: "Status change", payment: "Payment", nudge: "Report reminder", alert: "Error alert", test: "Test" };
const METHOD_LABEL: Record<string, string> = { off: "Off", user: "Sending as the connected account", bot: "Sending from the Teams bot", auto: "Bot first, then the account" };

export default async function NotificationsPage() {
  await requirePageAdmin();
  const [off, method, log] = await Promise.all([
    getDisabledKinds(),
    getMethod(),
    supabaseAdmin.from("notification_log").select("id, created_at, employee_name, kind, method, status, detail").order("created_at", { ascending: false }).limit(50),
  ]);

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader title="Notifications" description="What gets sent to people in Microsoft Teams" />
      <p className="text-sm text-muted-foreground">
        Delivery is currently <span className="font-medium text-foreground">{METHOD_LABEL[method]}</span>. Change it in Settings.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Morning summary</CardTitle>
          <CardDescription>
            Sent automatically around 9:00 AM India time (the scheduler can be up to an hour late). Each run adds a &quot;Morning job&quot; line to Recent messages below, even when there was nothing to send. If a morning
            went by with no line, the job didn&apos;t run. You can run it now: anyone who already got today&apos;s summary won&apos;t get it twice.
          </CardDescription>
        </CardHeader>
        <CardContent><RunDigestButton /></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What gets sent</CardTitle>
          <CardDescription>Untick anything you don&apos;t want sent. It applies to everyone.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveKinds} className="grid gap-3">
            {NOTIFICATION_KINDS.map((k) => (
              <label key={k.key} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <input type="checkbox" name="kind" value={k.key} defaultChecked={!off.has(k.key)} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">{k.title}</span>
                  <span className="block text-sm text-muted-foreground">{k.text}</span>
                </span>
              </label>
            ))}
            <div><Button type="submit">Save</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent messages</CardTitle>
          <CardDescription>The last 50, including anything that failed and why.</CardDescription>
        </CardHeader>
        <CardContent>
          {(log.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {(log.data ?? []).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <span className="w-36 shrink-0 text-muted-foreground tabular-nums">{noteDateTime(l.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{l.employee_name ?? "—"}</span>
                  <Badge variant="outline">{KIND_LABEL[l.kind] ?? l.kind}</Badge>
                  <span className="w-12 text-muted-foreground">{l.method ?? "—"}</span>
                  <Badge variant={l.status === "sent" ? "secondary" : l.status === "failed" ? "destructive" : "outline"}>{l.status}</Badge>
                  {l.detail && <span className="basis-full text-xs text-muted-foreground">{l.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
