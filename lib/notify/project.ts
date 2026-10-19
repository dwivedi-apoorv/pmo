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
export function assignedNotice(p: AssignedProject, sender: string): Notice {
  const site = webLink(p.website);
  const details: Line[] = [
    { label: "Project Name", text: p.name },
    { label: "Client Name", text: p.client_name },
    ...(p.website?.trim() ? [{ label: "Website", text: p.website.trim(), href: site ?? undefined }] : []),
    { label: "Onboarded on", text: date(p.onboarding_date) },
    { label: "Offered Services", text: p.services.length ? p.services.join(", ") : "None yet" },
  ];
  return {
    title: `New project assigned: ${p.name}`,
    sections: [],
    letter: [
      [{ text: "Hello, a new project is assigned to you." }],
      details,
      [{ label: "Project Manager", text: p.manager ?? "Not assigned" }],
      [{ label: "Onboarding Notes", text: p.onboarding_notes?.trim() || "None yet" }],
      [{ text: "Regards," }, { text: sender }],
    ],
  };
}
