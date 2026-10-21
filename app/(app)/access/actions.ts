"use server";

import { revalidatePath } from "next/cache";
import { PERMISSIONS, ROLES, forgetMatrix, isRole, loadMatrix, requireAdmin, type Role } from "@/lib/access";
import { firstName, list, logActivity } from "@/lib/activity";
import { isBootstrapAdmin } from "@/lib/ms/config";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Saves everyone's role. There must always be at least one admin. */
export async function saveRoles(formData: FormData) {
  const me = (await requireAdmin()).user;
  const { data: people, error } = await supabaseAdmin.from("employees").select("id, name, email, access_role").eq("is_active", true);
  if (error) throw new Error(error.message);

  const wanted = new Map<string, Role>();
  for (const e of people ?? []) {
    const v = String(formData.get(`role:${e.id}`) ?? "");
    wanted.set(e.id as string, isRole(v) ? v : ((e.access_role as Role) ?? "member"));
  }
  const admins = (people ?? []).filter((e) => wanted.get(e.id as string) === "admin" || isBootstrapAdmin(e.email as string | null));
  if (admins.length === 0) throw new Error("There must be at least one admin.");

  for (const e of people ?? []) {
    const role = wanted.get(e.id as string)!;
    if (role === e.access_role) continue;
    const { error: uErr } = await supabaseAdmin.from("employees").update({ access_role: role }).eq("id", e.id);
    if (uErr) throw new Error(uErr.message);
    const title = (r: string) => ROLES.find((x) => x.value === r)?.title ?? r;
    await logActivity({ actor: me, group: "access", action: "role_changed", summary: `${firstName(me.name)} changed the access role of ${e.name}: ${title(e.access_role as string)} → ${title(role)}` });
  }
  revalidatePath("/access");
}

/** Saves what the manager and member roles may do. Admins always can do everything. */
export async function savePermissions(formData: FormData) {
  const me = (await requireAdmin()).user;
  forgetMatrix();
  const before = await loadMatrix();
  const rows = (["manager", "member"] as const).flatMap((role) =>
    PERMISSIONS.map((p) => ({ role, permission: p.key, allowed: formData.get(`perm:${role}:${p.key}`) === "on" }))
  );
  const { error } = await supabaseAdmin.from("role_permissions").upsert(rows);
  if (error) throw new Error(error.message);
  forgetMatrix();
  const changes: string[] = [];
  for (const r of rows) {
    if (before[r.role][r.permission] !== r.allowed) {
      const title = PERMISSIONS.find((p) => p.key === r.permission)!.title;
      changes.push(`${r.role}s ${r.allowed ? "can now" : "can no longer"}: ${title.toLowerCase()}`);
    }
  }
  if (changes.length) await logActivity({ actor: me, group: "access", action: "permissions_changed", summary: `${firstName(me.name)} changed what roles can do: ${list(changes)}` });
  revalidatePath("/access");
}
