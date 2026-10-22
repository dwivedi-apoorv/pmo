import Link from "next/link";
import { limitTo, requirePagePermission } from "@/lib/access";
import { GROUP_LABEL, type ActivityGroup } from "@/lib/activity";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

type Row = { id: string; created_at: string; actor_id: string | null; actor_name: string; grp: ActivityGroup; summary: string; project_name: string | null };

const PAGE = 100;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ q?: string; who?: string; type?: string; limit?: string }> }) {
  const access = await requirePagePermission("view_activity");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const limit = Math.min(Math.max(Number(sp.limit) || PAGE, PAGE), 1000);

  // What this person may see: payments only with payment access, people with employee access, and access/settings for admins.
  const groups = (["project", "report", "note", "payment", "people", "access", "settings"] as const).filter(
    (g) => g === "project" || g === "report" || g === "note" || (g === "payment" && access.can("payments")) || (g === "people" && access.can("manage_people")) || access.role === "admin"
  );
  const type = groups.find((g) => g === sp.type);

  let query = supabaseAdmin
    .from("activity_log")
    .select("id, created_at, actor_id, actor_name, grp, summary, project_name")
    .in("grp", type ? [type] : groups)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  query = limitTo(query, access.scope, "project_id");
  if (sp.who) query = query.eq("actor_id", sp.who);
  if (q) query = query.ilike("summary", `%${q.replace(/[%_,()]/g, " ")}%`);
  const [{ data, error }, { data: actors }] = await Promise.all([
    query.returns<Row[]>(),
    supabaseAdmin.from("activity_log").select("actor_id, actor_name").not("actor_id", "is", null).order("created_at", { ascending: false }).limit(1000),
  ]);

  const rows = (data ?? []).slice(0, limit);
  const more = (data ?? []).length > limit;
  const people = [...new Map((actors ?? []).map((a) => [a.actor_id as string, a.actor_name as string])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const byDay = new Map<string, Row[]>();
  for (const r of rows) byDay.set(day(r.created_at), [...(byDay.get(day(r.created_at)) ?? []), r]);
  const keep = { ...(q ? { q } : {}), ...(sp.who ? { who: sp.who } : {}), ...(type ? { type } : {}) };

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader title="Activity" description="Who changed what, and when (India time)" />

      <form className="flex flex-wrap items-center gap-3" action="/activity">
        <input name="q" defaultValue={q} placeholder="Search what happened…" className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 w-full sm:w-72" aria-label="Search" />
        <select name="who" defaultValue={sp.who ?? ""} className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 w-full sm:w-44" aria-label="Person">
          <option value="">Everyone</option>
          {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select name="type" defaultValue={type ?? ""} className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 w-full sm:w-44" aria-label="Kind of change">
          <option value="">All kinds</option>
          {groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
        </select>
        <Button type="submit" variant="outline" className="h-9 px-4">Filter</Button>
        {(q || sp.who || type) && <Link href="/activity" className="text-sm text-muted-foreground underline-offset-4 hover:underline">Clear</Link>}
      </form>

      {error && <p className="text-destructive">Could not load data: {error.message}</p>}

      {rows.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">{q || sp.who || type ? "Nothing matches those filters." : "Nothing has been recorded yet. Changes made from now on will show here."}</p>
      ) : (
        [...byDay].map(([label, items]) => (
          <section key={label} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {items.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-sm">
                      <span className="w-12 shrink-0 text-muted-foreground tabular-nums">{time(r.created_at)}</span>
                      <Badge variant="outline" className="shrink-0">{GROUP_LABEL[r.grp]}</Badge>
                      <span className="min-w-0 flex-1">{r.summary}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ))
      )}

      {more && (
        <Link href={`/activity?${new URLSearchParams({ ...keep, limit: String(limit + PAGE) })}`} className="inline-block text-sm font-medium underline-offset-4 hover:underline">
          Show older activity →
        </Link>
      )}
    </div>
  );
}
