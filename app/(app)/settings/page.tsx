import { redirect } from "next/navigation";
import { requirePageAdmin } from "@/lib/access";
import { appUrl, botConfigured, userAppConfigured } from "@/lib/ms/config";
import { getConnection, getMethod } from "@/lib/notify/send";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { noteDateTime } from "@/lib/notes";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DisconnectButton, InstallBotButton, TestMessageButton } from "./controls";
import { saveMethod } from "./actions";

export const dynamic = "force-dynamic";

const METHODS = [
  { value: "off", title: "Off", text: "Send nothing." },
  { value: "user", title: "Send as a Microsoft account", text: "Messages come from the account you connect below, like a person writing to each employee." },
  { value: "bot", title: "Teams bot", text: "Messages come from the PMO bot. The app has to be installed for each person." },
  { value: "auto", title: "Bot first, then the account", text: "Use the bot, and fall back to the connected account for anyone the bot can't reach." },
] as const;

const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <li className={ok ? "" : "text-muted-foreground"}>
    <span className={ok ? "text-foreground" : "text-destructive"}>{ok ? "✓" : "✗"}</span> {children}
  </li>
);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await requirePageAdmin();
  const sp = await searchParams;

  const [method, connection, botChats, people] = await Promise.all([
    getMethod(),
    getConnection(),
    supabaseAdmin.from("teams_chats").select("employee_id").eq("method", "bot"),
    supabaseAdmin.from("employees").select("id, name, email").eq("is_active", true).order("name"),
  ]);
  const botReady = new Set((botChats.data ?? []).map((c) => c.employee_id as string));

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader title="General settings" description="How Microsoft Teams messages are sent" />

      {sp.connected && <p role="status" className="rounded-lg border p-3 text-sm">Microsoft account connected.</p>}
      {sp.error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{sp.error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>How messages are sent</CardTitle>
          <CardDescription>
            Each morning (about 9am India time) people get one summary of the reports and payments that need them. They
            also get a message when they&apos;re added to a project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveMethod} className="grid gap-3">
            {METHODS.map((m) => (
              <label key={m.value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-foreground">
                <input type="radio" name="method" value={m.value} defaultChecked={method === m.value} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">{m.title}</span>
                  <span className="block text-sm text-muted-foreground">{m.text}</span>
                </span>
              </label>
            ))}
            <div><Button type="submit">Save</Button></div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Send as a Microsoft account</CardTitle>
            <CardDescription>One person signs in once, and messages are sent as that account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="grid gap-1">
              <Check ok={userAppConfigured()}>MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET are set</Check>
              <Check ok={!!appUrl()}>APP_URL is set ({appUrl() || "not set"})</Check>
            </ul>
            {connection ? (
              <div className="rounded-lg border p-3">
                <p className="font-medium">{connection.account_name ?? connection.account_email}</p>
                <p className="text-muted-foreground">{connection.account_email}</p>
                <p className="mt-1">
                  {connection.status === "ok" ? <Badge variant="secondary">Connected</Badge> : <Badge variant="destructive">Needs to sign in again</Badge>}
                  <span className="ml-2 text-xs text-muted-foreground">since {noteDateTime(connection.connected_at)}</span>
                </p>
                {connection.last_error && <p className="mt-2 text-xs text-destructive">{connection.last_error}</p>}
              </div>
            ) : (
              <p className="text-muted-foreground">No account connected yet.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <a href="/api/ms/connect" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted">
                {connection ? "Reconnect" : "Connect a Microsoft account"}
              </a>
              {connection && <DisconnectButton />}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Teams bot</CardTitle>
            <CardDescription>The bot messages each person privately. It must be installed for them first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="grid gap-1">
              <Check ok={botConfigured()}>TEAMS_BOT_ID and TEAMS_BOT_SECRET are set</Check>
            </ul>
            <InstallBotButton />
            <div>
              <p className="mb-1 font-medium">Ready to receive ({(people.data ?? []).filter((p) => botReady.has(p.id)).length} of {(people.data ?? []).length})</p>
              <ul className="grid max-h-40 gap-0.5 overflow-y-auto text-muted-foreground sm:grid-cols-2">
                {(people.data ?? []).map((p) => (
                  <li key={p.id}><span className={botReady.has(p.id) ? "text-foreground" : ""}>{botReady.has(p.id) ? "✓" : "–"}</span> {p.name}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Try it</CardTitle>
          <CardDescription>Sends a short message to you, using the method selected above. If it fails, the reason from Microsoft is shown.</CardDescription>
        </CardHeader>
        <CardContent><TestMessageButton /></CardContent>
      </Card>
    </div>
  );
}
