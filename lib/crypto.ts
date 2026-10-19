import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Encrypts secrets (the Microsoft sign-in) before they go in the database, with AES-256-GCM. The key is
// derived from AUTH_SECRET, so a leaked database alone can't be used to send messages as the account.
// Changing AUTH_SECRET makes stored secrets unreadable: the account just has to be reconnected.
const key = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is not set (32+ characters).");
  return Buffer.from(hkdfSync("sha256", secret, "pmo-salt", "pmo-ms-token", 32));
};

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(token: string): string {
  const [iv, tag, data] = token.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !data) throw new Error("Stored secret is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
