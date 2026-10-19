import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export type CurrentEmployee = { id: string; name: string; email: string };

/**
 * The logged-in employee, or null. Checks the signed cookie AND that the person is still an active
 * employee, so deactivating someone ends their access immediately.
 */
export const getCurrentEmployee = cache(async (): Promise<CurrentEmployee | null> => {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const { data } = await supabaseAdmin
    .from("employees")
    .select("id, name, email, is_active")
    .eq("id", session.employeeId)
    .maybeSingle();
  if (!data || !data.is_active || !data.email) return null;
  return { id: data.id as string, name: data.name as string, email: data.email as string };
});

/** For pages: send anyone who isn't logged in to the login page. */
export async function requirePageUser(): Promise<CurrentEmployee> {
  const user = await getCurrentEmployee();
  if (!user) redirect("/login");
  return user;
}

/** For server actions (anything that changes data): refuse unless someone is logged in. */
export async function requireEmployee(): Promise<CurrentEmployee> {
  const user = await getCurrentEmployee();
  if (!user) throw new Error("Please sign in again.");
  return user;
}
