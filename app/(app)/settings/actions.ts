"use server";

import { revalidatePath } from "next/cache";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/ms/config";
import { NOTIFICATION_KINDS, Sender, getMethod, setDisabledKinds, setMethod, setUpBotFor, type Delivery, type Method } from "@/lib/notify/send";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function requireAdmin() {
  const me = await getCurrentEmployee();
  if (!me || !isAdmin(me.email)) throw new Error("Only admins can change these settings.");
  return me;
}

export async function saveMethod(formData: FormData) {
  await requireAdmin();
  const method = String(formData.get("method") ?? "");
  if (!["off", "user", "bot", "auto"].includes(method)) throw new Error("Choose how messages are sent.");
  await setMethod(method as Method);
  revalidatePath("/settings");
}

export async function saveKinds(formData: FormData) {
  await requireAdmin();
  const on = new Set(formData.getAll("kind").map(String));
  await setDisabledKinds(NOTIFICATION_KINDS.map((k) => k.key).filter((k) => !on.has(k)));
  revalidatePath("/settings");
}

export async function disconnectMicrosoft() {
  await requireAdmin();
  const { error } = await supabaseAdmin.from("ms_connection").delete().eq("id", 1);
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("teams_chats").delete().eq("method", "user");
  revalidatePath("/settings");
}

/** Installs the Teams app for every active employee and saves each person's chat. */
export async function installBotForEveryone(): Promise<{ name: string; ok: boolean; detail?: string }[]> {
  await requireAdmin();
  const { data } = await supabaseAdmin.from("employees").select("id, name, email").eq("is_active", true).not("email", "is", null).order("name");
  const out: { name: string; ok: boolean; detail?: string }[] = [];
  for (const e of data ?? []) {
    const r = await setUpBotFor({ id: e.id, name: e.name, email: e.email! });
    out.push({ name: e.name, ok: r.ok, detail: r.detail });
  }
  revalidatePath("/settings");
  return out;
}

/** Sends a test message to the admin who clicked, using the method that is switched on. */
export async function sendTestMessage(toEmail?: string): Promise<Delivery & { method?: "user" | "bot" }> {
  const me = await requireAdmin();
  let to = { id: me.id, name: me.name, email: me.email };
  const wanted = (toEmail ?? "").trim();
  if (wanted && wanted.toLowerCase() !== me.email.toLowerCase()) {
    const { data } = await supabaseAdmin.from("employees").select("id, name, email").ilike("email", wanted).maybeSingle();
    if (!data?.email) return { ok: false, detail: `${wanted} isn't an employee in the PMO yet. Add them under People first.` };
    to = { id: data.id, name: data.name, email: data.email };
  }
  const sender = await Sender.open();
  const result = await sender.send(
    to,
    { title: "Test message from the PMO", sections: [{ heading: "It works", lines: ["If you can read this, Teams notifications are set up for you."] }] },
    "test"
  );
  revalidatePath("/settings");
  return result;
}

export async function currentMethod() {
  return getMethod();
}
