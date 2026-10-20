import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { botConfigured, userAppConfigured } from "@/lib/ms/config";
import {
  DEFAULT_SERVICE_URL,
  catalogAppId,
  graphAppToken,
  installForUser,
  installedChatId,
  sendBotMessage,
  userIdByEmail,
} from "@/lib/ms/bot";
import { createOneOnOneChat, lookupUserId, refreshTokens, sendChatMessage } from "@/lib/ms/user";
import { toHtml, toMarkdown, type Notice } from "@/lib/notify/notice";

export type Method = "off" | "user" | "bot" | "auto";
export type Kind = "digest" | "assigned" | "test";
export type Recipient = { id: string; name: string; email: string };
export type Delivery = { ok: boolean; skipped?: boolean; method?: "user" | "bot"; detail?: string };

export async function getMethod(): Promise<Method> {
  const { data } = await supabaseAdmin.from("notification_settings").select("method").eq("id", 1).maybeSingle();
  return (data?.method as Method) ?? "off";
}

export async function setMethod(method: Method) {
  const { error } = await supabaseAdmin.from("notification_settings").upsert({ id: 1, method });
  if (error) throw new Error(error.message);
}

export const NOTIFICATION_KINDS = [
  { key: "reports", title: "Reports due", text: "In the daily summary: reports that are due soon or overdue. Goes to the project's manager and its team." },
  { key: "payments", title: "Payments due", text: "In the daily summary: payments that are due soon or overdue. Goes to the project's manager." },
  { key: "assigned", title: "Added to a project", text: "Sent straight away when someone is made manager or team member of a project." },
  { key: "team_changed", title: "Team or manager changed", text: "Sent to everyone already on a project when its manager or team changes, saying who was added or removed." },
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]["key"];

export async function getDisabledKinds(): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from("notification_settings").select("disabled_kinds").eq("id", 1).maybeSingle();
  return new Set((data?.disabled_kinds as string[] | null) ?? []);
}

export async function setDisabledKinds(kinds: string[]) {
  const { error } = await supabaseAdmin.from("notification_settings").upsert({ id: 1, disabled_kinds: kinds });
  if (error) throw new Error(error.message);
}

export type Connection = {
  account_id: string | null;
  account_email: string | null;
  account_name: string | null;
  status: "ok" | "needs_reconnect";
  last_error: string | null;
  connected_at: string;
};

export async function getConnection(): Promise<Connection | null> {
  const { data } = await supabaseAdmin
    .from("ms_connection")
    .select("account_id, account_email, account_name, status, last_error, connected_at")
    .eq("id", 1)
    .maybeSingle();
  return (data as Connection | null) ?? null;
}

async function log(r: Recipient | null, kind: Kind, delivery: Delivery, notice?: Notice) {
  await supabaseAdmin.from("notification_log").insert({
    employee_id: r?.id ?? null,
    employee_name: r?.name ?? null,
    kind,
    method: delivery.method ?? null,
    status: delivery.skipped ? "skipped" : delivery.ok ? "sent" : "failed",
    detail: delivery.detail ?? null,
    summary: notice?.title ?? null,
  });
}

/** Sends notices to people through whichever method is switched on, and records each attempt. */
export class Sender {
  private userSession: { token: string; senderId: string } | { error: string } | null = null;
  private constructor(readonly method: Method) {}

  static async open() {
    return new Sender(await getMethod());
  }

  // ---- send as the connected account ----
  private async session() {
    if (this.userSession) return this.userSession;
    const conn = await getConnection();
    if (!userAppConfigured()) return (this.userSession = { error: "The Microsoft app isn't configured (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET)." });
    if (!conn) return (this.userSession = { error: "No Microsoft account is connected yet." });
    if (conn.status !== "ok") return (this.userSession = { error: "The connected Microsoft account needs to sign in again (Settings > Reconnect)." });

    const { data: row } = await supabaseAdmin.from("ms_connection").select("refresh_token_enc").eq("id", 1).maybeSingle();
    let refresh: string;
    try {
      refresh = decryptSecret(row!.refresh_token_enc as string);
    } catch {
      return (this.userSession = { error: "The saved Microsoft sign-in can't be read (AUTH_SECRET changed?). Reconnect it in Settings." });
    }
    const t = await refreshTokens(refresh);
    if (!t.ok || !t.data) {
      // A refused sign-in (expired, password changed, access removed) needs a person to sign in again.
      const needsPerson = t.status === 400 || t.status === 401;
      await supabaseAdmin
        .from("ms_connection")
        .update({ last_error: t.error ?? "sign-in failed", last_error_at: new Date().toISOString(), ...(needsPerson ? { status: "needs_reconnect" } : {}) })
        .eq("id", 1);
      return (this.userSession = { error: `Microsoft refused the saved sign-in. ${t.error ?? ""}`.trim() });
    }
    if (t.data.refresh_token) {
      await supabaseAdmin.from("ms_connection").update({ refresh_token_enc: encryptSecret(t.data.refresh_token) }).eq("id", 1); // Microsoft rotates it
    }
    return (this.userSession = { token: t.data.access_token, senderId: conn.account_id ?? "" });
  }

  private async viaUser(r: Recipient, notice: Notice): Promise<Delivery> {
    const s = await this.session();
    if ("error" in s) return { ok: false, method: "user", detail: s.error };

    const cached = await supabaseAdmin.from("teams_chats").select("chat_id").eq("employee_id", r.id).eq("method", "user").maybeSingle();
    let chatId = cached.data?.chat_id as string | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (!chatId) {
        const uid = await lookupUserId(s.token, r.email);
        if (!uid.ok) return { ok: false, method: "user", detail: uid.error };
        // Writing to yourself: Teams keeps a private "notes to self" chat.
        if (uid.data === s.senderId) chatId = "48:notes";
        else {
          const chat = await createOneOnOneChat(s.token, s.senderId, uid.data!);
          if (!chat.ok || !chat.data?.id) return { ok: false, method: "user", detail: `Couldn't open a chat with ${r.name}. ${chat.error}` };
          chatId = chat.data.id;
          await supabaseAdmin.from("teams_chats").upsert({ employee_id: r.id, method: "user", chat_id: chatId });
        }
      }
      const sent = await sendChatMessage(s.token, chatId, toHtml(notice));
      if (sent.ok) return { ok: true, method: "user" };
      if (sent.status === 404 && attempt === 0) {
        // The saved chat was deleted: forget it and make a new one.
        await supabaseAdmin.from("teams_chats").delete().eq("employee_id", r.id).eq("method", "user");
        chatId = undefined;
        continue;
      }
      return { ok: false, method: "user", detail: `Teams refused the message. ${sent.error}` };
    }
    return { ok: false, method: "user", detail: "Could not send." };
  }

  // ---- send from the bot ----
  private async viaBot(r: Recipient, notice: Notice): Promise<Delivery> {
    if (!botConfigured()) return { ok: false, method: "bot", detail: "The bot isn't configured (TEAMS_BOT_ID, TEAMS_BOT_SECRET)." };
    let chat = (await supabaseAdmin.from("teams_chats").select("chat_id, service_url").eq("employee_id", r.id).eq("method", "bot").maybeSingle()).data;
    if (!chat) {
      const set = await setUpBotFor(r);
      if (!set.ok) return { ok: false, method: "bot", detail: set.detail };
      chat = { chat_id: set.chatId!, service_url: DEFAULT_SERVICE_URL };
    }
    const sent = await sendBotMessage(chat.service_url as string | null, chat.chat_id as string, toMarkdown(notice));
    return sent.ok ? { ok: true, method: "bot" } : { ok: false, method: "bot", detail: `Teams refused the message. ${sent.error}` };
  }

  async send(r: Recipient, notice: Notice, kind: Kind): Promise<Delivery> {
    let result: Delivery;
    if (this.method === "off") result = { ok: false, skipped: true, detail: "Notifications are switched off in Settings." };
    else if (this.method === "user") result = await this.viaUser(r, notice);
    else if (this.method === "bot") result = await this.viaBot(r, notice);
    else {
      const bot = await this.viaBot(r, notice);
      if (bot.ok) result = bot;
      else {
        const user = await this.viaUser(r, notice);
        result = user.ok ? user : { ...user, detail: `Bot: ${bot.detail} | Account: ${user.detail}` };
      }
    }
    await log(r, kind, result, notice).catch(() => {});
    return result;
  }
}

/** Installs the Teams app for one person and saves their private chat with the bot. */
export async function setUpBotFor(r: Recipient): Promise<{ ok: boolean; detail?: string; chatId?: string }> {
  const g = await graphAppToken();
  if (!g.ok) return { ok: false, detail: `Bot sign-in failed. ${g.error}` };
  const token = g.data!.access_token;
  const catalog = await catalogAppId(token);
  if (!catalog.ok) return { ok: false, detail: catalog.error };
  const uid = await userIdByEmail(token, r.email);
  if (!uid.ok) return { ok: false, detail: `No Microsoft account for ${r.email}. ${uid.error}` };
  const inst = await installForUser(token, uid.data!, catalog.data!);
  if (!inst.ok) return { ok: false, detail: `Couldn't install the app for ${r.name}. ${inst.error}` };

  let chat = await installedChatId(token, uid.data!, catalog.data!);
  if (!chat.ok) {
    await new Promise((res) => setTimeout(res, 2500)); // a fresh install can take a moment to show up
    chat = await installedChatId(token, uid.data!, catalog.data!);
  }
  if (!chat.ok) return { ok: false, detail: `Installed, but the chat isn't ready yet. ${chat.error}` };
  await supabaseAdmin.from("teams_chats").upsert({ employee_id: r.id, method: "bot", chat_id: chat.data!, service_url: DEFAULT_SERVICE_URL });
  return { ok: true, chatId: chat.data! };
}
