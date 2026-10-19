// Notes on a project: how the client was onboarded, calls, decisions, client requests, anything else.
export const NOTE_KINDS = [
  { value: "onboarding", label: "Onboarding" },
  { value: "call", label: "Call" },
  { value: "decision", label: "Decision" },
  { value: "request", label: "Client request" },
  { value: "general", label: "General" },
] as const;

export type NoteKind = (typeof NOTE_KINDS)[number]["value"];

export type ProjectNote = {
  id: string;
  project_id: string;
  kind: NoteKind;
  body: string;
  created_at: string;
  updated_at: string;
  created_by_name: string | null; // null for notes written before authors were recorded
  updated_by_name: string | null;
};

/** An earlier version of a note: the text as it stood before an edit replaced it. */
export type NoteVersion = {
  id: string;
  note_id: string;
  body: string;
  saved_at: string; // when this version was written
  saved_by_name: string | null; // who wrote it
};

export const MAX_NOTE_LENGTH = 5000;

export const isNoteKind = (v: string): v is NoteKind => NOTE_KINDS.some((k) => k.value === v);
export const kindLabel = (k: NoteKind) => NOTE_KINDS.find((x) => x.value === k)?.label ?? k;

/** Onboarding notes first (they describe the client's start), then everything else, newest first. */
export const orderNotes = (notes: ProjectNote[]) =>
  [...notes].sort(
    (a, b) =>
      Number(b.kind === "onboarding") - Number(a.kind === "onboarding") ||
      b.created_at.localeCompare(a.created_at)
  );

/** The day a note was written, in India time. */
export const noteDate = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** The columns to fetch for notes (kept in one place so every page reads the same fields). */
export const NOTE_COLUMNS = "id, project_id, kind, body, created_at, updated_at, created_by_name, updated_by_name";
export const VERSION_COLUMNS = "id, note_id, body, saved_at, saved_by_name";

/** Types that can still be added: a project may have only ONE onboarding note, so it drops out once written. */
export const addableKinds = (notes: ProjectNote[]) =>
  notes.some((n) => n.kind === "onboarding") ? NOTE_KINDS.filter((k) => k.value !== "onboarding") : NOTE_KINDS;

/** "2026-10-19 10:30" in India time, for edit history. */
export const noteDateTime = (timestamp: string) =>
  new Date(timestamp).toLocaleString("en-CA", { timeZone: "Asia/Kolkata", hour12: false, dateStyle: "short", timeStyle: "short" }).replace(",", "");

/** " by Ankit" (or " · written by Ankit"). Empty for notes saved before anyone was logged in. */
export const authorBy = (name: string | null, word = "by") => (name ? ` ${word === "by" ? "" : "· "}${word} ${name}` : "");
