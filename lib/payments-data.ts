import { supabase } from "@/lib/supabase";
import type { PaymentPlan } from "@/lib/payments";
import type { Due } from "@/lib/dues";
import type { ProjectStatus } from "@/lib/status";

export type ProjectInfo = { name: string; client: string; status: ProjectStatus; managerId: string | null };
export type PlanRow = { id: string; name: string; client_name: string; status: ProjectStatus; project_manager_id: string | null } & PaymentPlan;

// Everything the payment views need, in two queries: every project (any status) and the ledger.
export async function loadPaymentsData() {
  const [projectsRes, ledgerRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, client_name, status, project_manager_id, payment_date, payment_term, payment_method, payment_amount_usd")
      .returns<PlanRow[]>(),
    supabase
      .from("payment_dues")
      .select("project_id, due_date, amount_usd, term, method, status, paid_at")
      .returns<Due[]>(),
  ]);

  const all = projectsRes.data ?? [];
  const info = new Map<string, ProjectInfo>(
    all.map((p) => [p.id, { name: p.name, client: p.client_name, status: p.status, managerId: p.project_manager_id }])
  );
  return {
    error: projectsRes.error ?? ledgerRes.error,
    /** Active projects (the ones whose upcoming payments are still expected). */
    active: all.filter((p) => p.status === "active"),
    ledger: ledgerRes.data ?? [],
    info,
    /** Name for display; halted and ended projects carry their status, e.g. "Acme (halted)". */
    labelOf: (id: string) => {
      const i = info.get(id);
      return !i ? "Unknown project" : i.status === "active" ? i.name : `${i.name} (${i.status})`;
    },
  };
}
