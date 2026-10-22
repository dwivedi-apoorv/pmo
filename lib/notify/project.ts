import type { Line, Notice } from "@/lib/notify/notice";
import type { ProjectStatus } from "@/lib/status";

export type AssignedProject = {
  name: string;
  client_name: string;
  website: string | null;
  onboarding_date: string;
  manager: string | null; // name
  services: string[];
  onboarding_notes: string | null;
};

const date = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A usable web address (adds https:// if it was typed without), or null when it isn't one. */
export function webLink(raw: string | null): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return u.hostname.includes(".") ? u.href : null;
  } catch {
    return null;
  }
}

/** The message a person gets when a project is assigned to them. */
export function assignedNotice(p: AssignedProject): Notice {
  const site = webLink(p.website);
  const services = p.services.length > 1 ? { label: "Offered Services", text: "", items: p.services } : { label: "Offered Services", text: p.services[0] ?? "None yet" };
  const field = (label: string, text: string, href?: string): Line[] => [{ label, text, href }];
  return {
    title: `New project assigned: ${p.name}`,
    sections: [],
    letter: [
      [{ text: "Hello, a new project is assigned to you." }],
      field("Project Name", p.name),
      field("Client Name", p.client_name),
      ...(p.website?.trim() ? [field("Website", p.website.trim(), site ?? undefined)] : []),
      field("Onboarded on", date(p.onboarding_date)),
      [services],
      field("Project Manager", p.manager ?? "Not assigned"),
      field("Onboarding Notes", p.onboarding_notes?.trim() || "None yet"),
    ],
  };
}

export type TeamChange = {
  project: string;
  oldManager: string | null;
  newManager: string | null;
  added: string[]; // names
  removed: string[]; // names
  team: string[]; // names of everyone on the team now (not counting the manager)
};

/** Tells the people already on a project that its manager or team changed. */
export function teamChangedNotice(c: TeamChange): Notice {
  const lines: Line[][] = [[{ text: `Hello, the team on ${c.project} has been updated.` }]];
  if (c.oldManager !== c.newManager) {
    lines.push([{ label: "Project Manager", text: `${c.oldManager ?? "Not assigned"} → ${c.newManager ?? "Not assigned"}` }]);
  }
  if (c.added.length) lines.push([{ label: "Added to the team", text: c.added.join(", ") }]);
  if (c.removed.length) lines.push([{ label: "Removed from the team", text: c.removed.join(", ") }]);
  lines.push([{ label: "Project Manager now", text: c.newManager ?? "Not assigned" }]);
  lines.push([c.team.length > 1 ? { label: "Team now", text: "", items: c.team } : { label: "Team now", text: c.team[0] ?? "No one" }]);
  return { title: `Team updated: ${c.project}`, sections: [], letter: lines };
}

const STOPPED: Partial<Record<ProjectStatus, { verb: string; label: string }>> = {
  halted: { verb: "halted", label: "Halted" },
  completed: { verb: "marked as completed", label: "Completed" },
  ended: { verb: "marked as lost", label: "Lost" },
};

/** Tells the manager and team that a project was halted, completed or lost. */
export function statusChangedNotice(p: { name: string; client: string; manager: string | null; status: ProjectStatus; reasons: string[]; by: string }): Notice | null {
  const s = STOPPED[p.status];
  if (!s) return null;
  const lines: Line[][] = [
    [{ text: `Hello, the project ${p.name} has been ${s.verb}.` }],
    [{ label: "Project Name", text: p.name }, { label: "Client Name", text: p.client }, { label: "Status", text: s.label }],
  ];
  if (p.reasons.length > 1) lines.push([{ label: "Reasons", text: "", items: p.reasons }]);
  else if (p.reasons.length === 1) lines.push([{ label: "Reason", text: p.reasons[0] }]);
  lines.push([{ label: "Project Manager", text: p.manager ?? "Not assigned" }, { label: "Changed by", text: p.by }]);
  return { title: `${p.name} ${s.verb}`, sections: [], letter: lines };
}

/** Tells the manager a payment came in. */
export function paymentPaidNotice(p: { project: string; client: string; amount: string; due: string; by: string }): Notice {
  return {
    title: `Payment received: ${p.project} (due ${p.due})`,
    sections: [],
    letter: [
      [{ text: `Hello, a payment for ${p.project} has been marked as paid.` }],
      [{ label: "Project Name", text: p.project }, { label: "Client Name", text: p.client }, { label: "Amount", text: p.amount }, { label: "Due date", text: p.due }, { label: "Marked as paid by", text: p.by }],
    ],
  };
}

/** Reminds the manager a report is overdue. */
export function reportNudgeNotice(p: { project: string; client: string; due: string; daysLate: number }): Notice {
  return {
    title: `Report overdue: ${p.project} (due ${p.due})`,
    sections: [],
    letter: [
      [{ text: `Hello, the report for ${p.project} is ${p.daysLate} ${p.daysLate === 1 ? "day" : "days"} overdue.` }],
      [{ label: "Project Name", text: p.project }, { label: "Client Name", text: p.client }, { label: "Report was due", text: p.due }],
      [{ text: "Please send it and mark it as sent in the PMO." }],
    ],
  };
}
