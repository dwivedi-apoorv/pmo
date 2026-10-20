// Settings for the Microsoft connections. All of them come from environment variables (never stored in
// the database, never shown in the browser).
const env = (name: string) => process.env[name]?.trim() || undefined;

export const msConfig = {
  // The Microsoft app used to "send as" a signed-in account (Entra app registration + client secret).
  tenantId: () => env("MS_TENANT_ID"),
  clientId: () => env("MS_CLIENT_ID"),
  clientSecret: () => env("MS_CLIENT_SECRET"),
  // The Teams bot (its own Entra app + secret). Often the same tenant.
  botId: () => env("TEAMS_BOT_ID"),
  botSecret: () => env("TEAMS_BOT_SECRET"),
  botTenantId: () => env("TEAMS_BOT_TENANT_ID") ?? env("MS_TENANT_ID"),
};

export const userAppConfigured = () => !!(msConfig.tenantId() && msConfig.clientId() && msConfig.clientSecret());
export const botConfigured = () => !!(msConfig.botId() && msConfig.botSecret() && msConfig.botTenantId());

/** The public address of this app (for sign-in redirects and links in messages). */
export function appUrl(): string {
  const configured = env("APP_URL");
  if (configured) return configured.replace(/\/+$/, "");
  return process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "";
}

/**
 * Emails listed in ADMIN_EMAILS (comma separated) are always admins, whatever the database says: a safety
 * net so nobody can lock themselves out. Day-to-day, roles are set on the Access page.
 */
export function isBootstrapAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (env("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const TOKEN_URL = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
