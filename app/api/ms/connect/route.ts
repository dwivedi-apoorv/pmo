import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/lib/auth";
import { appUrl, isAdmin, userAppConfigured } from "@/lib/ms/config";
import { OAUTH_COOKIE, signOauthState } from "@/lib/ms/state";
import { authorizeUrl, newPkce } from "@/lib/ms/user";

export const dynamic = "force-dynamic";

// Starts "connect a Microsoft account": an admin is sent to Microsoft to sign in and approve sending messages.
export async function GET() {
  const me = await getCurrentEmployee();
  if (!me || !isAdmin(me.email)) return new NextResponse("Only admins can connect a Microsoft account.", { status: 403 });
  if (!userAppConfigured() || !appUrl()) {
    return NextResponse.redirect(`${appUrl() || "http://localhost:3000"}/settings?error=${encodeURIComponent("Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and APP_URL first.")}`);
  }
  const { state, verifier, challenge } = newPkce();
  const res = NextResponse.redirect(authorizeUrl(state, challenge));
  res.cookies.set(OAUTH_COOKIE, await signOauthState(state, verifier), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/ms", maxAge: 600 });
  return res;
}
