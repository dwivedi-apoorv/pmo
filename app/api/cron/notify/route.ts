import { alertAdmins } from "@/lib/alerts";
import { runDailyDigest } from "@/lib/notify/run";

export const dynamic = "force-dynamic";

// Called by Vercel Cron every morning (see vercel.json). Needs "Authorization: Bearer <CRON_SECRET>".
// If the job crashes, or some messages couldn't be delivered, the admins are emailed (see lib/alerts.ts).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  try {
    const run = await runDailyDigest();
    if (run.failed > 0) {
      await alertAdmins("Some daily summaries could not be delivered", [`${run.failed} of ${run.people} people did not get their summary.`, ...run.failures.slice(0, 10)]);
    }
    return Response.json({ ok: true, ...run });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed";
    await alertAdmins("Daily summary job failed", [`The morning job stopped with an error:`, message]);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
