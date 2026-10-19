import { formatUSD, methodLabel, termLabel, type PaymentPlan } from "@/lib/payments";
import type { Notice } from "@/lib/notify/notice";

export type AssignedProject = {
  name: string;
  client_name: string;
  website: string | null;
  status: "active" | "halted" | "ended";
  onboarding_date: string;
  reporting_date: string;
  manager: string | null; // name
  team: string[]; // names
  services: string[];
} & PaymentPlan;

const date = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

/** "You've been added to X" with everything about the project, so the person doesn't have to go and look. */
export function assignedNotice(p: AssignedProject, role: "Project manager" | "Team member", appUrl: string): Notice {
  const project = [
    `Your role: ${role}`,
    `Client: ${p.client_name}`,
    ...(p.website ? [`Website: ${p.website}`] : []),
    `Status: ${p.status[0].toUpperCase()}${p.status.slice(1)}`,
    `Onboarded: ${date(p.onboarding_date)}`,
    `Services: ${p.services.length ? p.services.join(", ") : "none yet"}`,
  ];
  const people = [`Project manager: ${p.manager ?? "not assigned"}`, `Team: ${p.team.length ? p.team.join(", ") : "no one else yet"}`];
  const reporting = [`Report due: monthly, on the ${ordinal(Number(p.reporting_date.slice(8, 10)))}`];
  const payment = p.payment_amount_usd !== null || p.payment_term || p.payment_method || p.payment_date
    ? [
        ...(p.payment_amount_usd !== null ? [`Amount: ${formatUSD(p.payment_amount_usd)}`] : []),
        ...(p.payment_term ? [`Term: ${termLabel(p.payment_term)}`] : []),
        ...(p.payment_method ? [`Method: ${methodLabel(p.payment_method)}`] : []),
        ...(p.payment_date ? [`First payment: ${date(p.payment_date)}`] : []),
      ]
    : ["No payment plan set"];
  return {
    title: `You've been added to ${p.name}`,
    sections: [
      { heading: "Project", lines: project },
      { heading: "People", lines: people },
      { heading: "Reporting", lines: reporting },
      { heading: "Payment", lines: payment },
    ],
    link: { label: "Open the PMO", url: `${appUrl}/projects` },
  };
}
