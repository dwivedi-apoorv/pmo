// A notification, independent of how it is delivered. Renders to the two formats Teams accepts.
export type Notice = {
  title: string;
  sections: { heading: string; lines: string[] }[];
  link?: { label: string; url: string };
  // A free-form letter instead of title + sections: paragraphs of lines. `title` is then only the short summary kept in the log.
  letter?: Line[][];
};
/** One line of a letter: an optional bold label, the text, and optionally a link on the text. */
export type Line = { label?: string; text: string; href?: string; items?: string[] }; // `items` = a bullet list under the label

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mdEsc = (s: string) => s.replace(/([\\`*_{}\[\]<>#|])/g, "\\$1");

/** HTML for a Teams chat message sent through Microsoft Graph. */
const htmlLine = (l: Line) => {
  const text = esc(l.text).replace(/\r?\n/g, "<br>");
  const head = `${l.label ? `<b>${esc(l.label)}:</b> ` : ""}${l.href ? `<a href="${esc(l.href)}">${text}</a>` : text}`;
  return l.items ? `<b>${esc(l.label ?? "")}:</b><ul>${l.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : head;
};
const mdLine = (l: Line) => {
  const text = mdEsc(l.text).replace(/\r?\n/g, "  \n");
  if (l.items) return `**${mdEsc(l.label ?? "")}:**\n\n${l.items.map((i) => `- ${mdEsc(i)}`).join("\n")}`;
  return `${l.label ? `**${mdEsc(l.label)}:** ` : ""}${l.href ? `[${text}](${l.href})` : text}`;
};
// Teams squeezes <p> spacing in chats, so paragraphs are separated with explicit blank lines.
const htmlLetter = (paras: Line[][]) => {
  const out = paras.map((para) => para.map(htmlLine).join("<br>"));
  return `<div>${out.map((p, i) => p + (i === out.length - 1 ? "" : p.endsWith("</ul>") ? "<br>" : "<br><br>")).join("")}</div>`;
};

export function toHtml(n: Notice): string {
  if (n.letter) return htmlLetter(n.letter);
  const parts = [`<p><b>${esc(n.title)}</b></p>`];
  for (const s of n.sections) parts.push(`<p><b>${esc(s.heading)}</b></p><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
  if (n.link) parts.push(`<p><a href="${esc(n.link.url)}">${esc(n.link.label)}</a></p>`);
  return parts.join("");
}

/** Markdown for a message sent by the Teams bot. */
export function toMarkdown(n: Notice): string {
  if (n.letter) return n.letter.map((para) => para.map(mdLine).join("  \n")).join("\n\n");
  const parts = [`**${mdEsc(n.title)}**`];
  for (const s of n.sections) parts.push(`**${mdEsc(s.heading)}**\n\n${s.lines.map((l) => `- ${mdEsc(l)}`).join("\n")}`);
  if (n.link) parts.push(`[${mdEsc(n.link.label)}](${n.link.url})`);
  return parts.join("\n\n");
}

export const firstLine = (n: Notice) => n.title;
