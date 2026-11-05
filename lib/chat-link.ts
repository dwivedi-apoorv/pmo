// Finds a Teams group chat's id in a pasted chat link (or the id itself).
// A group chat id looks like 19:abc123...@thread.v2 and sits in the link, usually url-encoded:
//   https://teams.microsoft.com/l/chat/19%3Aabc123%40thread.v2/conversations?context=...
const GROUP_ID = /19:[A-Za-z0-9_\-.=]+@thread\.v2/i;

export function parseChatLink(input: string): { id: string; url: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  let text = raw;
  for (let i = 0; i < 2; i++) {
    try {
      text = decodeURIComponent(text);
    } catch {
      break;
    }
  }
  const id = GROUP_ID.exec(text)?.[0];
  if (!id) return null;
  const isUrl = /^https:\/\/[^\s]+$/i.test(raw);
  return { id, url: isUrl ? raw : `https://teams.microsoft.com/l/chat/${encodeURIComponent(id)}/conversations` };
}
