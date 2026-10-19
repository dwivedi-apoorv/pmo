import "server-only";

// Sends the login code with Resend (https://resend.com). Needs RESEND_API_KEY and RESEND_FROM, e.g.
// RESEND_FROM="PMO <login@yourdomain.com>" (the domain must be verified in Resend).
// While developing on your own computer with no key set, the code is printed in the terminal instead.
export async function sendLoginCode(to: string, code: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!key || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`\n[login] No email service configured (dev only). Code for ${to}: ${code}\n`);
      return;
    }
    throw new Error("RESEND_API_KEY and RESEND_FROM must be set to send login codes.");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your PMO Portal login code: ${code}`,
      text: `Your login code is ${code}\n\nIt works once and expires in 10 minutes. If you did not ask for it, you can ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111">
        <p>Your PMO login code:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
        <p style="color:#555">It works once and expires in 10 minutes. If you did not ask for it, you can ignore this email.</p>
      </div>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const problem = `Resend refused the email (${res.status}). ${detail.slice(0, 200)}`;
    // On your own computer, don't get locked out while Resend is still being set up (for example the
    // domain isn't verified yet): show the code in the terminal. This never happens in production.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`\n[login] ${problem}\n[login] Dev only: code for ${to} is ${code}\n`);
      return;
    }
    throw new Error(problem);
  }
}
