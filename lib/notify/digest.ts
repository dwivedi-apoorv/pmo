import { dueLabel, todayISO } from "@/lib/reporting";
import { formatUSD, type PaymentPlan } from "@/lib/payments";
import { attentionRows, type Due } from "@/lib/dues";
import { reportAttention, type ReportSend } from "@/lib/reports";
import type { Notice } from "@/lib/notify/notice";

export type DigestProject = {
  id: string;
  name: string;
  client_name: string;
  status: "active" | "halted" | "ended";
  reporting_date: string;
  created_at: string;
  project_manager_id: string | null;
  assignees: string[]; // employee ids
} & PaymentPlan;

export type DigestEmployee = { id: string; name: string; email: string | null; is_active: boolean };

const when = (days: number) => (days < 0 ? `${-days} ${-days === 1 ? "day" : "days"} overdue` : dueLabel(days).toLowerCase());
const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * One summary per person, only for people who have something to act on (nobody gets an empty message):
 *  - reports (overdue or due within 3 days) go to the project's manager AND its assigned team
 *  - payments (overdue or due soon, any project status: unpaid money stays owed) go to the project's manager
 * Inactive employees and people with no email get nothing.
 */
export function buildDigests(input: {
  projects: DigestProject[];
  ledger: Due[];
  sends: ReportSend[];
  employees: DigestEmployee[];
  appUrl: string;
  today?: string;
  include?: { reports: boolean; payments: boolean }; // default: both
}): Map<string, Notice> {
  const today = input.today ?? todayISO();
  const byId = new Map(input.projects.map((p) => [p.id, p]));
  const people = new Map(input.employees.filter((e) => e.is_active && e.email).map((e) => [e.id, e]));
  const active = input.projects.filter((p) => p.status === "active");

  type Line = { days: number; text: string };
  const reports = new Map<string, Line[]>();
  const payments = new Map<string, Line[]>();
  const add = (map: Map<string, Line[]>, who: string | null | undefined, line: Line) => {
    if (who && people.has(who)) map.set(who, [...(map.get(who) ?? []), line]);
  };

  const inc = input.include ?? { reports: true, payments: true };

  for (const r of inc.reports ? reportAttention(active, input.sends, today) : []) {
    const p = byId.get(r.project_id)!;
    const line = { days: r.days, text: `${p.name} (${p.client_name}): ${when(r.days)} · due ${r.due}` };
    const recipients = new Set([p.project_manager_id, ...p.assignees]);
    for (const who of recipients) add(reports, who, line);
  }

  for (const r of inc.payments ? attentionRows(active, input.ledger, today) : []) {
    const p = byId.get(r.project_id);
    if (!p) continue;
    const tag = p.status === "active" ? "" : ` [${p.status}]`;
    add(payments, p.project_manager_id, {
      days: r.days,
      text: `${p.name}${tag} (${p.client_name}): ${formatUSD(r.amount)} · ${when(r.days)} · due ${r.due}`,
    });
  }

  const out = new Map<string, Notice>();
  for (const [id, e] of people) {
    const sections: Notice["sections"] = [];
    const rep = (reports.get(id) ?? []).sort((a, b) => a.days - b.days);
    const pay = (payments.get(id) ?? []).sort((a, b) => a.days - b.days);
    if (rep.length) sections.push({ heading: `Reports (${rep.length})`, lines: rep.map((l) => l.text) });
    if (pay.length) sections.push({ heading: `Payments (${pay.length})`, lines: pay.map((l) => l.text) });
    if (!sections.length) continue;
    out.set(id, {
      title: `PMO summary for ${e.name.split(" ")[0]} · ${weekday(today)}`,
      sections,
      link: { label: "Open the PMO", url: input.appUrl },
    });
  }
  return out;
}
