import { PERMISSIONS, ROLES, loadMatrix, requirePageAdmin } from "@/lib/access";
import { isBootstrapAdmin } from "@/lib/ms/config";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { savePermissions, saveRoles } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  await requirePageAdmin();
  const [{ data: people }, matrix] = await Promise.all([
    supabaseAdmin.from("employees").select("id, name, email, role, access_role").eq("is_active", true).order("name"),
    loadMatrix(),
  ]);

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader title="Access" description="Who can do what" />

      <Card>
        <CardHeader>
          <CardTitle>What each role can do</CardTitle>
          <CardDescription>Admins can always do everything. Tick what managers and members may do.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={savePermissions} className="grid gap-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Permission</th>
                    <th className="w-24 px-2 py-2 text-center font-medium">Admin</th>
                    <th className="w-24 px-2 py-2 text-center font-medium">Manager</th>
                    <th className="w-24 px-2 py-2 text-center font-medium">Member</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {PERMISSIONS.map((p) => (
                    <tr key={p.key}>
                      <td className="py-3 pr-4">
                        <span className="block font-medium">{p.title}</span>
                        <span className="block text-muted-foreground">{p.text}</span>
                      </td>
                      <td className="px-2 text-center"><input type="checkbox" checked disabled aria-label={`Admin: ${p.title}`} /></td>
                      {(["manager", "member"] as const).map((role) => (
                        <td key={role} className="px-2 text-center">
                          <input type="checkbox" name={`perm:${role}:${p.key}`} defaultChecked={matrix[role][p.key]} aria-label={`${role}: ${p.title}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div><Button type="submit">Save</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>People and roles</CardTitle>
          <CardDescription>
            Everyone starts as a member. Settings and this page are for admins only. A person&apos;s job title (such as SEO
            specialist) is separate from their role here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveRoles} className="grid gap-4">
            <ul className="divide-y text-sm">
              {(people ?? []).map((e) => {
                const locked = isBootstrapAdmin(e.email as string | null);
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{e.name}</span>
                      <span className="block truncate text-muted-foreground">{e.email} {e.role ? `· ${e.role}` : ""}</span>
                    </span>
                    {locked && <span className="text-xs text-muted-foreground">admin (ADMIN_EMAILS)</span>}
                    <select
                      name={`role:${e.id}`}
                      defaultValue={locked ? "admin" : (e.access_role as string)}
                      disabled={locked}
                      aria-label={`Role for ${e.name}`}
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.title}</option>)}
                    </select>
                  </li>
                );
              })}
            </ul>
            <div><Button type="submit">Save</Button></div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
