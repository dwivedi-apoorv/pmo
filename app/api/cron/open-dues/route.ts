import { alertAdmins } from "@/lib/alerts";
import { openDuesForMonth } from "@/lib/open-dues";
import { projectionMonths } from "@/lib/payments";
import { todayISO } from "@/lib/reporting";

export const dynamic = "force-dynamic";

// Called by Vercel Cron on the 1st of every month (see vercel.json). Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; without that exact header (or if CRON_SECRET isn't set) the
// request is refused, so the public can't trigger it.
//
// Optional: ?month=2026-11 opens that month instead of the current one (handy for catching up).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const monthParam = new URL(request.url).searchParams.get("month");
  if (monthParam !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
    return Response.json({ error: "month must look like 2026-11" }, { status: 400 });
  }

  try {
    const month = projectionMonths(monthParam ? `${monthParam}-01` : todayISO(), 1)[0];
    const result = await openDuesForMonth(month);
    return Response.json({ ok: true, month: month.key, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed";
    await alertAdmins("Monthly payment dues job failed", ["The job that opens each month's payments stopped with an error:", message]);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
