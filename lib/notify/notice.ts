// A notification, independent of how it is delivered. Renders to the two formats Teams accepts.
export type Notice = {
  title: string;
  sections: { heading: string; lines: string[] }[];
  link?: { label: string; url: string };
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mdEsc = (s: string) => s.replace(/([\\`*_{}\[\]<>#|])/g, "\\$1");

/** HTML for a Teams chat message sent through Microsoft Graph. */
export function toHtml(n: Notice): string {
  const parts = [`<p><b>${esc(n.title)}</b></p>`];
  for (const s of n.sections) parts.push(`<p><b>${esc(s.heading)}</b></p><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
  if (n.link) parts.push(`<p><a href="${esc(n.link.url)}">${esc(n.link.label)}</a></p>`);
  return parts.join("");
}

/** Markdown for a message sent by the Teams bot. */
export function toMarkdown(n: Notice): string {
  const parts = [`**${mdEsc(n.title)}**`];
  for (const s of n.sections) parts.push(`**${mdEsc(s.heading)}**\n\n${s.lines.map((l) => `- ${mdEsc(l)}`).join("\n")}`);
  if (n.link) parts.push(`[${mdEsc(n.link.label)}](${n.link.url})`);
  return parts.join("\n\n");
}

export const firstLine = (n: Notice) => n.title;
