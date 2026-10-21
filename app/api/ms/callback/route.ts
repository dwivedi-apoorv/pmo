import { NextResponse, type NextRequest } from "next/server";
import { getAccess } from "@/lib/access";
import { firstName, logActivity } from "@/lib/activity";
import { encryptSecret } from "@/lib/crypto";
import { appUrl } from "@/lib/ms/config";
import { OAUTH_COOKIE, readOauthState } from "@/lib/ms/state";
import { exchangeCode, getMe } from "@/lib/ms/user";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Microsoft sends the admin back here with a one-time code. We trade it for the sign-in, encrypt it, and store it.
export async function GET(req: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(`${appUrl()}/settings?${q}`);
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/ms" });
    return res;
  };
  const me = await getAccess();
  if (me?.role !== "admin") return new NextResponse("Only admins can connect a Microsoft account.", { status: 403 });

  const url = req.nextUrl.searchParams;
  if (url.get("error")) return back(`error=${encodeURIComponent(url.get("error_description") ?? url.get("error")!)}`);

  const saved = await readOauthState(req.cookies.get(OAUTH_COOKIE)?.value);
  const code = url.get("code");
  if (!saved || !code || url.get("state") !== saved.state) return back("error=" + encodeURIComponent("That sign-in attempt wasn't recognised. Please try Connect again."));

  const t = await exchangeCode(code, saved.verifier);
  if (!t.ok || !t.data?.refresh_token) return back("error=" + encodeURIComponent(`Microsoft didn't accept the sign-in. ${t.error ?? "No refresh token was returned."}`));
  const who = await getMe(t.data.access_token);
  if (!who.ok || !who.data) return back("error=" + encodeURIComponent(`Signed in, but couldn't read the account. ${who.error}`));

  const { error } = await supabaseAdmin.from("ms_connection").upsert({
    id: 1,
    account_id: who.data.id,
    account_email: who.data.mail ?? who.data.userPrincipalName ?? null,
    account_name: who.data.displayName ?? null,
    refresh_token_enc: encryptSecret(t.data.refresh_token),
    status: "ok",
    last_error: null,
    last_error_at: null,
    connected_by: me.user.id,
    connected_at: new Date().toISOString(),
  });
  if (error) return back("error=" + encodeURIComponent(error.message));
  await logActivity({ actor: me.user, group: "settings", action: "microsoft_connected", summary: `${firstName(me.user.name)} connected the Microsoft account ${who.data.mail ?? who.data.userPrincipalName ?? who.data.displayName ?? ""} to send Teams messages` });
  return back("connected=1");
}
