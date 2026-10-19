import { createHmac, randomInt } from "node:crypto";

// One-time login codes. The code is 6 random digits; only a keyed hash of it is ever stored, so a
// leaked database can't be used to log in. Server-only (uses Node crypto and the secret).
export const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export function hashCode(email: string, code: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return createHmac("sha256", secret).update(`${email.trim().toLowerCase()}:${code}`).digest("hex");
}

export const isCodeShape = (code: string) => /^\d{6}$/.test(code);
export const isEmailShape = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
