import { createHash, randomBytes } from "node:crypto";
import { GRAPH, TOKEN_URL, appUrl, msConfig } from "@/lib/ms/config";
import { msRequest, odataString, type MsResult } from "@/lib/ms/http";

// "Send as" a signed-in Microsoft account. A person signs in once; the app keeps a refresh token and
// uses it to send Teams chat messages that appear to come from that account (Microsoft only allows chat
// messages to be sent by a signed-in user, not by an app on its own).
export const USER_SCOPES = "offline_access User.Read User.ReadBasic.All Chat.Create ChatMessage.Send";
export const redirectUri = () => `${appUrl()}/api/ms/callback`;

const b64url = (b: Buffer) => b.toString("base64url");

/** PKCE: a random secret kept in a cookie, and its hash sent to Microsoft. */
export function newPkce() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(24)) };
}

export function authorizeUrl(state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: msConfig.clientId()!,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: USER_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${msConfig.tenantId()}/oauth2/v2.0/authorize?${q}`;
}

export type Tokens = { access_token: string; refresh_token?: string; expires_in: number };

const tokenCall = (form: Record<string, string>) =>
  msRequest<Tokens>(TOKEN_URL(msConfig.tenantId()!), {
    form: { client_id: msConfig.clientId()!, client_secret: msConfig.clientSecret()!, scope: USER_SCOPES, ...form },
  });

export const exchangeCode = (code: string, verifier: string) =>
  tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier });

export const refreshTokens = (refreshToken: string) => tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });

export type Me = { id: string; displayName?: string; mail?: string | null; userPrincipalName?: string };
export const getMe = (token: string) =>
  msRequest<Me>(`${GRAPH}/me?$select=id,displayName,mail,userPrincipalName`, { token });

/** Finds a person's Microsoft id from their work email (works for the login name or the mail address). */
export async function lookupUserId(token: string, email: string): Promise<MsResult<string>> {
  const direct = await msRequest<{ id: string }>(`${GRAPH}/users/${encodeURIComponent(email)}?$select=id`, { token });
  if (direct.ok && direct.data?.id) return { ok: true, status: 200, data: direct.data.id };
  const e = odataString(email);
  const found = await msRequest<{ value: { id: string }[] }>(
    `${GRAPH}/users?$filter=${encodeURIComponent(`mail eq '${e}' or userPrincipalName eq '${e}'`)}&$select=id`,
    { token }
  );
  const id = found.data?.value?.[0]?.id;
  return id
    ? { ok: true, status: 200, data: id }
    : { ok: false, status: found.status || 404, data: null, error: `No Microsoft account found for ${email}. ${found.error ?? direct.error ?? ""}`.trim() };
}

const member = (userId: string) => ({
  "@odata.type": "#microsoft.graph.aadUserConversationMember",
  roles: ["owner"],
  "user@odata.bind": `${GRAPH}/users('${userId}')`,
});

/** Creates the private chat between the sending account and a person (Microsoft returns the existing one if there is one). */
export const createOneOnOneChat = (token: string, senderId: string, recipientId: string) =>
  msRequest<{ id: string }>(`${GRAPH}/chats`, { token, json: { chatType: "oneOnOne", members: [member(senderId), member(recipientId)] } });

/** A group chat for several people (the sending account must be among them). Microsoft returns the chat's id and a link to open it. */
export const createGroupChat = (token: string, topic: string, memberIds: string[]) =>
  msRequest<{ id: string; webUrl?: string }>(`${GRAPH}/chats`, { token, json: { chatType: "group", topic: topic.slice(0, 250), members: memberIds.map(member) } });

export const sendChatMessage = (token: string, chatId: string, html: string) =>
  msRequest(`${GRAPH}/chats/${encodeURIComponent(chatId)}/messages`, { token, json: { body: { contentType: "html", content: html } } });
