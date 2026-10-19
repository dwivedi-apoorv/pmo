import { createRemoteJWKSet, jwtVerify } from "jose";
import { GRAPH, TOKEN_URL, msConfig } from "@/lib/ms/config";
import { msRequest, odataString, type MsResult } from "@/lib/ms/http";

// The Teams bot. It signs in with its own app id and secret (no person signs in) and sends private chat
// messages. A person must have the app installed first; we install it for everyone through Microsoft
// Graph, then ask Graph which private chat the bot has with each person.
export const DEFAULT_SERVICE_URL = "https://smba.trafficmanager.net/teams/";

const appToken = (scope: string) =>
  msRequest<{ access_token: string }>(TOKEN_URL(msConfig.botTenantId()!), {
    form: { grant_type: "client_credentials", client_id: msConfig.botId()!, client_secret: msConfig.botSecret()!, scope },
  });

export const botFrameworkToken = () => appToken("https://api.botframework.com/.default");
export const graphAppToken = () => appToken("https://graph.microsoft.com/.default");

export const sendBotMessage = async (serviceUrl: string | null, conversationId: string, markdown: string): Promise<MsResult> => {
  const t = await botFrameworkToken();
  if (!t.ok) return { ...t, error: `Bot sign-in failed. ${t.error}` };
  const base = (serviceUrl || DEFAULT_SERVICE_URL).replace(/\/?$/, "/");
  return msRequest(`${base}v3/conversations/${encodeURIComponent(conversationId)}/activities`, {
    token: t.data!.access_token,
    json: { type: "message", text: markdown, textFormat: "markdown" },
  });
};

/** The id Microsoft gave this Teams app in your company's app list (found from the bot's own id). */
export async function catalogAppId(token: string): Promise<MsResult<string>> {
  const r = await msRequest<{ value: { id: string }[] }>(
    `${GRAPH}/appCatalogs/teamsApps?$filter=${encodeURIComponent(`externalId eq '${odataString(msConfig.botId()!)}'`)}`,
    { token }
  );
  const id = r.data?.value?.[0]?.id;
  return id
    ? { ok: true, status: 200, data: id }
    : {
        ok: false,
        status: r.status || 404,
        data: null,
        error: r.ok
          ? "The Teams app isn't in your company's app list yet. Upload the app package in the Teams admin centre first."
          : r.error,
      };
}

export const userIdByEmail = async (token: string, email: string): Promise<MsResult<string>> => {
  const r = await msRequest<{ id: string }>(`${GRAPH}/users/${encodeURIComponent(email)}?$select=id`, { token });
  return r.ok && r.data?.id ? { ok: true, status: 200, data: r.data.id } : { ok: false, status: r.status, data: null, error: r.error };
};

export const emailByUserId = async (token: string, userId: string): Promise<string | null> => {
  const r = await msRequest<{ mail?: string | null; userPrincipalName?: string }>(
    `${GRAPH}/users/${encodeURIComponent(userId)}?$select=mail,userPrincipalName`,
    { token }
  );
  return (r.data?.mail || r.data?.userPrincipalName || null)?.toLowerCase() ?? null;
};

/** Installs the Teams app for one person. "Already installed" counts as success. */
export async function installForUser(token: string, userId: string, catalogId: string): Promise<MsResult> {
  const r = await msRequest(`${GRAPH}/users/${encodeURIComponent(userId)}/teamwork/installedApps`, {
    token,
    json: { "teamsApp@odata.bind": `${GRAPH}/appCatalogs/teamsApps/${catalogId}` },
  });
  return r.ok || r.status === 409 ? { ...r, ok: true } : r;
}

/** The id of the private chat between the bot and a person (once the app is installed for them). */
export async function installedChatId(token: string, userId: string, catalogId: string): Promise<MsResult<string>> {
  const installs = await msRequest<{ value: { id: string }[] }>(
    `${GRAPH}/users/${encodeURIComponent(userId)}/teamwork/installedApps?$expand=teamsApp&$filter=${encodeURIComponent(`teamsApp/id eq '${catalogId}'`)}`,
    { token }
  );
  const installId = installs.data?.value?.[0]?.id;
  if (!installId) return { ok: false, status: installs.status || 404, data: null, error: installs.error ?? "The app isn't installed for this person yet." };
  const chat = await msRequest<{ id: string }>(
    `${GRAPH}/users/${encodeURIComponent(userId)}/teamwork/installedApps/${encodeURIComponent(installId)}/chat?$select=id`,
    { token }
  );
  return chat.ok && chat.data?.id ? { ok: true, status: 200, data: chat.data.id } : { ok: false, status: chat.status, data: null, error: chat.error };
}

// ---- messages sent TO the bot (installs, "hi"): Microsoft signs them, and we check the signature ----
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
async function keys() {
  if (jwks) return jwks;
  const meta = await (await fetch("https://login.botframework.com/v1/.well-known/openidconfiguration")).json();
  jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
  return jwks;
}

/** True only if the request really came from the Bot Framework for THIS bot. */
export async function verifyBotRequest(authorization: string | null, serviceUrl: string | undefined): Promise<boolean> {
  const botId = msConfig.botId();
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!botId || !token) return false;
  try {
    const { payload } = await jwtVerify(token, await keys(), { issuer: "https://api.botframework.com", audience: botId });
    const claim = (payload as Record<string, unknown>).serviceurl;
    return typeof claim !== "string" || !serviceUrl || claim.replace(/\/$/, "") === serviceUrl.replace(/\/$/, "");
  } catch {
    return false;
  }
}
