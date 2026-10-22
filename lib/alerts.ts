import "server-only";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/ms/config";
import { supabaseAdmin } from "@/lib/supabase-admin";

const QUIET_HOURS = 6; // the same problem is reported at most once in this long, so a broken day isn't a flood

/** Everyone who should hear about a failure: active admins, plus any emails in ADMIN_EMAILS. */
async function adminEmails(): Promise<string[]> {
  const { data } = await supabaseAdmin.from("employees").select("email").eq("is_active", true).eq("access_role", "admin").not("email", "is", null);
  const fromEnv = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim());
  return [...new Set([...(data ?? []).map((e) => e.email as string), ...fromEnv].map((e) => e.toLowerCase()).filter(Boolean))];
}

/**
 * Emails the admins that something failed ("Daily summary job failed", "Teams messages are failing"), with what
 * went wrong. Email is used because it still works when Teams is what broke. Sent at most once per
 * QUIET_HOURS for the same title, can be switched off in Notifications, and never throws.
 */
export async function alertAdmins(title: string, lines: string[]) {
  try {
    const { data: settings } = await supabaseAdmin.from("notification_settings").select("disabled_kinds").eq("id", 1).maybeSingle();
    if (((settings?.disabled_kinds as string[] | null) ?? []).includes("error_alerts")) return;

    const since = new Date(Date.now() - QUIET_HOURS * 3_600_000).toISOString();
    const { data: recent } = await supabaseAdmin.from("notification_log").select("id").eq("kind", "alert").eq("summary", title).eq("status", "sent").gte("created_at", since).limit(1);
    if (recent?.length) return;

    const to = await adminEmails();
    if (!to.length) return console.error("[alert] nobody to tell:", title);
    const body = `${title}\n\n${lines.join("\n")}\n\nSee what was sent and what failed: ${appUrl() || ""}/notifications\n`;
    const r = await sendEmail(to, `[PMO] ${title}`, body);
    await supabaseAdmin.from("notification_log").insert({ kind: "alert", method: "email", status: r.ok ? "sent" : "failed", detail: r.ok ? `Emailed ${to.join(", ")}` : r.detail, summary: title });
    if (!r.ok) console.error("[alert] couldn't email the admins:", r.detail);
  } catch (e) {
    console.error("[alert] failed:", e instanceof Error ? e.message : e);
  }
}
