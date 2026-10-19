import { SignJWT, jwtVerify } from "jose";

// The login session: a signed token in an httpOnly cookie. Works in the edge middleware too (no Node-only
// modules here). The token only says WHO logged in; every server request still checks that person is
// an active employee (see lib/auth.ts), so deactivating someone logs them out at once.
export const SESSION_COOKIE = "pmo_session";
export const SESSION_DAYS = 7;

const secretKey = () => {
  const secret = process.env.AUTH_SECRET;
  return secret && secret.length >= 32 ? new TextEncoder().encode(secret) : null;
};

/** True when AUTH_SECRET is set (32+ characters). Without it nobody can log in. */
export const authConfigured = () => secretKey() !== null;

export type Session = { employeeId: string; email: string };

export async function signSession(employeeId: string, email: string): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error("AUTH_SECRET is not set (it must be at least 32 characters).");
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(employeeId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key);
}

/** The session inside a token, or null if the token is missing, forged, or expired. */
export async function verifySession(token: string | undefined): Promise<Session | null> {
  const key = secretKey();
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { employeeId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true, // not readable by scripts on the page
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};

/** Only allow going back to a path inside this site after login (never to another website). */
export const safeNext = (next: string | null | undefined) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !next.startsWith("/login") ? next : "/";
