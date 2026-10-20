import type { Line, Notice } from "@/lib/notify/notice";

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
