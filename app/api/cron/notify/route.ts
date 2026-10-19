import { runDailyDigest } from "@/lib/notify/run";

export const dynamic = "force-dynamic";

// Called by Vercel Cron every morning (see vercel.json). Needs "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  try {
    return Response.json({ ok: true, ...(await runDailyDigest()) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
