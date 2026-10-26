import "server-only";
import { firstName, logActivity } from "@/lib/activity";
import { alertAdmins } from "@/lib/alerts";
import { createGroupChat, lookupUserId, sendChatMessage } from "@/lib/ms/user";
import { toHtml } from "@/lib/notify/notice";
import { assignedNotice } from "@/lib/notify/project";
import { loadAssignedDetails } from "@/lib/notify/run";
import { Sender } from "@/lib/notify/send";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function getAutoProjectChat(): Promise<boolean> {
  const { data } = await supabaseAdmin.from("notification_settings").select("project_chat_auto").eq("id", 1).maybeSingle();
  return !!data?.project_chat_auto;
}

export async function setAutoProjectChat(on: boolean) {
  const { error } = await supabaseAdmin.from("notification_settings").upsert({ id: 1, project_chat_auto: on });
  if (error) throw new Error(error.message);
}

/** The chat's name, in capitals: the project's website without "https://" (and any trailing slash), or "Project (Client)" if it has none. */
export function chatName(p: { name: string; client_name: string; website: string | null }): string {
  const site = (p.website ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return (site || `${p.name} (${p.client_name})`).toUpperCase();
}

export type ChatResult = { ok: boolean; message: string; webUrl?: string | null; created?: boolean };

/**
 * Makes a Teams group chat for a project (and says so in the Activity log, or says why it couldn't, so a chat that
 * was meant to be created automatically but wasn't can be found out and fixed). Never throws.
 */
export async function createProjectChat(projectId: string, by: { id: string; name: string } | null): Promise<ChatResult> {
  const r = await createProjectChatInner(projectId, by);
  if (!r.ok && by) {
    const name = (await supabaseAdmin.from("projects").select("name").eq("id", projectId).maybeSingle()).data?.name as string | undefined;
    await logActivity({ actor: by, group: "project", action: "chat_failed", projectId, projectName: name, summary: `The Teams group chat for ${name ?? "a project"} could not be created: ${r.message}` });
    await alertAdmins("Teams group chats are failing", [`The group chat for ${name ?? "a project"} could not be created.`, r.message]);
  } else if (r.ok && r.created && /couldn't be posted/.test(r.message) && by) {
    await logActivity({ actor: by, group: "project", action: "chat_welcome_failed", projectId, summary: `The group chat was created but its first message was not posted. ${r.message}` });
  }
  return r;
}

/**
 * The work of making the chat: the project manager and team, plus the connected Microsoft account,
 * named "Project (Client)", with the project details posted as the first message. A project only ever gets one;
 * asking again returns the existing chat. Never throws.
 */
async function createProjectChatInner(projectId: string, by: { id: string; name: string } | null): Promise<ChatResult> {
  try {
    const { data: existing } = await supabaseAdmin.from("project_chats").select("web_url").eq("project_id", projectId).maybeSingle();
    if (existing) return { ok: true, created: false, webUrl: existing.web_url as string | null, message: "This project already has a Teams chat." };

    const [details, { data: project }, { data: team }] = await Promise.all([
      loadAssignedDetails(projectId),
      supabaseAdmin.from("projects").select("name, client_name, website, project_manager_id").eq("id", projectId).maybeSingle(),
      supabaseAdmin.from("project_assignments").select("employee_id").eq("project_id", projectId),
    ]);
    if (!details || !project) return { ok: false, message: "Project not found." };

    const ids = [...new Set([project.project_manager_id as string | null, ...(team ?? []).map((t) => t.employee_id as string)].filter((x): x is string => !!x))];
    const { data: people } = await supabaseAdmin.from("employees").select("id, name, email, is_active").in("id", ids);
    const reachable = (people ?? []).filter((p) => p.is_active && p.email);

    const sender = await Sender.open();
    const account = await sender.account();
    if ("error" in account) return { ok: false, message: account.error };

    const memberIds = new Set<string>([account.senderId]);
    const missing: string[] = [];
    for (const p of reachable) {
      const uid = await lookupUserId(account.token, p.email as string);
      if (uid.ok && uid.data) memberIds.add(uid.data);
      else missing.push(p.name as string);
    }
    const note = missing.length ? ` Not added (no Microsoft account found): ${missing.join(", ")}.` : "";
    if (memberIds.size < 3) {
      return { ok: false, message: `A group chat needs at least 3 people including the connected account, and only ${memberIds.size} could be found.${note}` };
    }

    const title = chatName(project as { name: string; client_name: string; website: string | null });
    const chat = await createGroupChat(account.token, title, [...memberIds]);
    if (!chat.ok || !chat.data?.id) return { ok: false, message: `Teams wouldn't create the chat. ${chat.error ?? ""}`.trim() };

    await supabaseAdmin.from("project_chats").upsert({ project_id: projectId, chat_id: chat.data.id, web_url: chat.data.webUrl ?? null });
    const welcome = await sendChatMessage(account.token, chat.data.id, toHtml(assignedNotice(details)));
    if (by) {
      await logActivity({ actor: by, group: "project", action: "chat_created", projectId, projectName: project.name as string, summary: `${firstName(by.name)} created a Teams group chat for ${project.name} with ${memberIds.size} people` });
    }
    return {
      ok: true,
      created: true,
      webUrl: chat.data.webUrl ?? null,
      message: `Created the Teams chat “${title}” with ${memberIds.size} people.${welcome.ok ? "" : ` The first message couldn't be posted: ${welcome.error}`}${note}`,
    };
  } catch (e) {
    console.error("[chat] could not create the project chat:", e instanceof Error ? e.message : e);
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
