import { formatMoney } from "@/lib/currency";
import type { AttentionRow } from "@/lib/dues";
import type { ReportRow } from "@/lib/reports";

// A project is "at risk" while it is ACTIVE and has an overdue report or an overdue payment.
export type RiskReason = { kind: "report" | "payment"; due: string; days: number; amount?: number; currency?: string };

export function riskByProject(
  activeIds: Set<string>,
  payments: AttentionRow[],
  reports: ReportRow[]
): Map<string, RiskReason[]> {
  const risk = new Map<string, RiskReason[]>();
  const add = (id: string, reason: RiskReason) => risk.set(id, [...(risk.get(id) ?? []), reason]);
  for (const r of reports) if (r.days < 0 && activeIds.has(r.project_id)) add(r.project_id, { kind: "report", due: r.due, days: r.days });
  for (const r of payments) {
    if (r.days < 0 && activeIds.has(r.project_id)) add(r.project_id, { kind: "payment", due: r.due, days: r.days, amount: r.amount, currency: r.currency });
  }
  return risk;
}

export function describeRisk(r: RiskReason) {
  const days = -r.days;
  const late = `${days} ${days === 1 ? "day" : "days"} overdue`;
  return r.kind === "report" ? `Report ${late}` : `Payment of ${formatMoney(r.amount ?? 0, r.currency)} ${late}`;
}
