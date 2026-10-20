"use server";

import { revalidatePath } from "next/cache";
import { PERMISSIONS, isRole, requireAdmin, type Role } from "@/lib/access";
import { isBootstrapAdmin } from "@/lib/ms/config";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Saves everyone's role. There must always be at least one admin. */
export async function saveRoles(formData: FormData) {
  await requireAdmin();
  const { data: people, error } = await supabaseAdmin.from("employees").select("id, email, access_role").eq("is_active", true);
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
  }
  revalidatePath("/access");
}

/** Saves what the manager and member roles may do. Admins always can do everything. */
export async function savePermissions(formData: FormData) {
  await requireAdmin();
  const rows = (["manager", "member"] as const).flatMap((role) =>
    PERMISSIONS.map((p) => ({ role, permission: p.key, allowed: formData.get(`perm:${role}:${p.key}`) === "on" }))
  );
  const { error } = await supabaseAdmin.from("role_permissions").upsert(rows);
  if (error) throw new Error(error.message);
  revalidatePath("/access");
}
