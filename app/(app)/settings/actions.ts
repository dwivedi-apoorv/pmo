"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { runDailyDigest } from "@/lib/notify/run";
import { firstName, list, logActivity } from "@/lib/activity";
import { NOTIFICATION_KINDS, Sender, getMethod, getDisabledKinds, setDisabledKinds, setMethod, setUpBotFor, type Delivery, type Method } from "@/lib/notify/send";
import { supabaseAdmin } from "@/lib/supabase-admin";

const METHOD_LABEL: Record<string, string> = { off: "off", user: "send as the connected account", bot: "the Teams bot", auto: "the bot first, then the account" };

export async function saveMethod(formData: FormData) {
  const me = (await requireAdmin()).user;
  const method = String(formData.get("method") ?? "");
  if (!["off", "user", "bot", "auto"].includes(method)) throw new Error("Choose how messages are sent.");
  const before = await getMethod();
  await setMethod(method as Method);
  if (before !== method) await logActivity({ actor: me, group: "settings", action: "delivery_changed", summary: `${firstName(me.name)} changed how Teams messages are sent: ${METHOD_LABEL[before]} → ${METHOD_LABEL[method]}` });
  revalidatePath("/settings");
}

export async function saveKinds(formData: FormData) {
  const me = (await requireAdmin()).user;
  const on = new Set(formData.getAll("kind").map(String));
  const before = await getDisabledKinds();
  const off = NOTIFICATION_KINDS.map((k) => k.key).filter((k) => !on.has(k));
  await setDisabledKinds(off);
  const turnedOff = NOTIFICATION_KINDS.filter((k) => off.includes(k.key) && !before.has(k.key)).map((k) => k.title);
  const turnedOn = NOTIFICATION_KINDS.filter((k) => !off.includes(k.key) && before.has(k.key)).map((k) => k.title);
  if (turnedOff.length || turnedOn.length) {
    await logActivity({ actor: me, group: "settings", action: "messages_changed", summary: `${firstName(me.name)} changed which Teams messages are sent${turnedOn.length ? `: switched on ${list(turnedOn)}` : ""}${turnedOff.length ? `${turnedOn.length ? ";" : ":"} switched off ${list(turnedOff)}` : ""}` });
  }
  revalidatePath("/notifications");
}

export async function disconnectMicrosoft() {
  const me = (await requireAdmin()).user;
  const { error } = await supabaseAdmin.from("ms_connection").delete().eq("id", 1);
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("teams_chats").delete().eq("method", "user");
  await logActivity({ actor: me, group: "settings", action: "microsoft_disconnected", summary: `${firstName(me.name)} disconnected the Microsoft account used to send Teams messages` });
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
  const me = (await requireAdmin()).user;
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

/** Runs the morning job now (the same one the scheduler runs): handy when a morning message didn't arrive. */
export async function runDigestNow(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  try {
    const r = await runDailyDigest();
    revalidatePath("/notifications");
    if (r.method === "off") return { ok: false, message: "Delivery is switched off in General settings, so nothing was sent." };
    if (r.people === 0 && r.nudged === 0) return { ok: true, message: "Nobody has a report or payment that needs attention today, so there was nothing to send." };
    const parts = [`${r.sent} ${r.sent === 1 ? "summary" : "summaries"} sent`, `${r.nudged} report ${r.nudged === 1 ? "reminder" : "reminders"}`];
    if (r.alreadySent) parts.push(`${r.alreadySent} already had theirs today`);
    if (r.failed) parts.push(`${r.failed} failed`);
    return { ok: r.failed === 0, message: `${parts.join(", ")}.${r.failures.length ? "\n" + r.failures.slice(0, 5).join("\n") : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
