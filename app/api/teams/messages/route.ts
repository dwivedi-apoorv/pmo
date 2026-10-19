import { emailByUserId, graphAppToken, sendBotMessage, DEFAULT_SERVICE_URL, verifyBotRequest } from "@/lib/ms/bot";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Teams calls this when someone installs the bot or writes to it. We check the request really came from
// Microsoft for THIS bot, work out which employee it is, and remember their private chat so we can message them.
export async function POST(req: Request) {
  let activity: any;
  try {
    activity = JSON.parse(await req.text());
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!(await verifyBotRequest(req.headers.get("authorization"), activity?.serviceUrl))) return new Response("Unauthorized", { status: 401 });

  const aad: string | undefined = activity?.from?.aadObjectId;
  const conversationId: string | undefined = activity?.conversation?.id;
  const serviceUrl: string = activity?.serviceUrl || DEFAULT_SERVICE_URL;

  try {
    if (aad && conversationId && activity?.conversation?.conversationType === "personal") {
      const g = await graphAppToken();
      const email = g.ok ? await emailByUserId(g.data!.access_token, aad) : null;
      const { data: emp } = email
        ? await supabaseAdmin.from("employees").select("id, name").ilike("email", email).eq("is_active", true).maybeSingle()
        : { data: null };

      if (emp) {
        await supabaseAdmin.from("teams_chats").upsert({ employee_id: emp.id, method: "bot", chat_id: conversationId, service_url: serviceUrl });
      }
      if (activity.type === "message") {
        await sendBotMessage(
          serviceUrl,
          conversationId,
          emp
            ? `Hi ${String(emp.name).split(" ")[0]}! You're set up. I'll message you here when a report or payment needs attention, and when you're added to a project.`
            : "Hi! I couldn't match your Microsoft account to an employee in the PMO. Please ask an admin to check your email in Employees."
        );
      }
    }
  } catch (e) {
    console.error("[teams] could not handle an activity:", e instanceof Error ? e.message : e);
  }
  return new Response(null, { status: 200 });
}
