import { SignJWT, jwtVerify } from "jose";

// Remembers the sign-in attempt (a random state + the PKCE secret) in a short-lived signed cookie, so
// the page Microsoft sends you back to can prove the attempt started here.
export const OAUTH_COOKIE = "pmo_ms_oauth";
const key = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "");

export const signOauthState = (state: string, verifier: string) =>
  new SignJWT({ state, verifier }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(key());

export async function readOauthState(token: string | undefined): Promise<{ state: string; verifier: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return typeof payload.state === "string" && typeof payload.verifier === "string" ? { state: payload.state, verifier: payload.verifier } : null;
  } catch {
    return null;
  }
}
