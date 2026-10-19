"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendLoginCode } from "@/lib/email";
import { generateCode, hashCode, isCodeShape, isEmailShape } from "@/lib/otp";
import { SESSION_COOKIE, authConfigured, safeNext, sessionCookieOptions, signSession } from "@/lib/session";

export type LoginState = { ok: boolean; message?: string };

const clientIp = (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;

/**
 * Step 1: email a 6-digit code. The answer is the same whether or not the email belongs to an employee,
 * so the login page can't be used to find out who works here.
 */
export async function requestLoginCode(formData: FormData): Promise<LoginState> {
  if (!authConfigured()) return { ok: false, message: "Login isn't set up yet: AUTH_SECRET is missing on the server." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isEmailShape(email)) return { ok: false, message: "Enter a valid email address." };

  const code = generateCode();
  const { data, error } = await supabaseAdmin.rpc("login_issue_code", {
    p_email: email,
    p_code_hash: hashCode(email, code),
    p_ip: clientIp(await headers()),
  });
  if (error) {
    console.error("[login] could not issue a code:", error.message);
    return { ok: false, message: "Something went wrong. Please try again." };
  }

  if (data === "sent") {
    try {
      await sendLoginCode(email, code);
    } catch (e) {
      console.error("[login] could not send the email:", e instanceof Error ? e.message : e);
      return { ok: false, message: "We couldn't send the email. Please try again in a minute." };
    }
  }
  // 'unknown' (not an employee) and 'limited' (asked too often) look exactly like 'sent' from outside.
  return { ok: true };
}

/** Step 2: check the code. If it's right, sign in and go to the page you came from. */
export async function verifyLoginCode(formData: FormData): Promise<LoginState> {
  if (!authConfigured()) return { ok: false, message: "Login isn't set up yet: AUTH_SECRET is missing on the server." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!isEmailShape(email) || !isCodeShape(code)) return { ok: false, message: "Enter the 6-digit code from the email." };

  const { data: employeeId, error } = await supabaseAdmin.rpc("login_check_code", {
    p_email: email,
    p_code_hash: hashCode(email, code),
  });
  if (error) {
    console.error("[login] could not check the code:", error.message);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
  if (!employeeId) return { ok: false, message: "That code is wrong or has expired. Ask for a new one if needed." };

  (await cookies()).set(SESSION_COOKIE, await signSession(employeeId as string, email), sessionCookieOptions);
  redirect(safeNext(String(formData.get("next") ?? "")));
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
