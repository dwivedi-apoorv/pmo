"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/simple-select";
import {
  MAX_NOTE_LENGTH,
  addableKinds,
  authorBy,
  kindLabel,
  noteDate,
  noteDateTime,
  orderNotes,
  type NoteKind,
  type NoteVersion,
  type ProjectNote,
} from "@/lib/notes";
import { addNote, deleteNote, updateNote } from "@/app/actions";

// A project's notes. Rules: a project has ONE onboarding note (edit it, don't add another, can't delete
// it); other types can be added freely. Every note shows who added it and who edited it last, and
// every edit keeps the earlier version. With `kind` set (the Onboarding notes popup) it shows only that type.
export function ProjectNotes({
  projectId,
  notes: allNotes,
  versions,
  kind,
}: {
  projectId: string;
  notes: ProjectNote[];
  versions: NoteVersion[];
  kind?: NoteKind;
}) {
  const notes = kind ? allNotes.filter((n) => n.kind === kind) : allNotes;
  const noun = kind === "onboarding" ? "onboarding note" : "note";
  const hasOnboarding = allNotes.some((n) => n.kind === "onboarding");
  const kinds = addableKinds(allNotes);
  // The onboarding popup only ever adds the (single) onboarding note.
  const canAdd = kind === "onboarding" ? !hasOnboarding : kinds.length > 0;

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [formKey, setFormKey] = useState(0); // bumping it clears the "add a note" form
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<Set<string>>(new Set());

  function run(action: (fd: FormData) => Promise<void>, formData: FormData, done: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await action(formData);
        done();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  const toggleHistory = (id: string) =>
    setShowHistory((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid gap-4">
      {canAdd && (
        <form
          key={formKey}
          className="grid gap-2 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(addNote, new FormData(e.currentTarget), () => setFormKey((k) => k + 1));
          }}
        >
          <input type="hidden" name="project_id" value={projectId} />
          <p className="text-sm font-medium">Add {kind ? "the" : "a"} {noun}</p>
          {kind && <input type="hidden" name="kind" value={kind} />}
          <div className={kind ? "grid gap-3" : "grid gap-3 sm:grid-cols-[12rem_1fr]"}>
            {!kind && (
              <div className="grid gap-1.5">
                <Label>Type</Label>
                <SimpleSelect name="kind" options={kinds} defaultValue={kinds[0].value} placeholder="Type" />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor={`note-${projectId}-${kind ?? "any"}`}>Note</Label>
              <Textarea
                id={`note-${projectId}-${kind ?? "any"}`}
                name="body"
                rows={3}
                maxLength={MAX_NOTE_LENGTH}
                required
                placeholder="e.g. Goals for the first 90 days, access details, key contacts, what was promised in the sales call…"
              />
            </div>
          </div>
          {error && editing === null && <p className="text-sm text-destructive">{error}</p>}
          <div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && editing === null ? "Saving…" : `Add ${noun}`}
            </Button>
          </div>
          {!kind && !hasOnboarding && (
            <p className="text-xs text-muted-foreground">
              A project has one onboarding note. Once it is written you can edit it, but not add another.
            </p>
          )}
        </form>
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {kind === "onboarding"
            ? "No onboarding notes yet. Write what the client wants, who the contacts are, and how they were brought on."
            : "No notes yet. Start with the onboarding notes: what the client wants and how they were brought on."}
        </p>
      ) : (
        <ul className="grid gap-3">
          {orderNotes(notes).map((n) => {
            const history = versions.filter((v) => v.note_id === n.id).sort((a, b) => b.saved_at.localeCompare(a.saved_at));
            const edited = history.length > 0 || new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 1000;
            const isOnboarding = n.kind === "onboarding";
            return (
              <li key={n.id} className="rounded-lg border p-3 text-sm">
                {editing === n.id ? (
                  <form
                    className="grid gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(updateNote, new FormData(e.currentTarget), () => setEditing(null));
                    }}
                  >
                    <input type="hidden" name="id" value={n.id} />
                    <Textarea name="body" rows={5} maxLength={MAX_NOTE_LENGTH} required defaultValue={n.body} aria-label="Edit note" />
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <p className="text-xs text-muted-foreground">The current text is kept in this note&apos;s history.</p>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(null); setError(null); }}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {!kind && <Badge variant={isOnboarding ? "default" : "secondary"}>{kindLabel(n.kind)}</Badge>}
                      <span className="text-xs text-muted-foreground">
                        Added <span className="tabular-nums">{noteDate(n.created_at)}</span>
                        {authorBy(n.created_by_name)}
                        {edited && (
                          <>
                            {" · "}Edited <span className="tabular-nums">{noteDate(n.updated_at)}</span>
                            {authorBy(n.updated_by_name)}
                          </>
                        )}
                      </span>
                      <span className="ml-auto flex items-center gap-1">
                        {confirmDelete === n.id ? (
                          <>
                            <span className="text-xs text-muted-foreground">Delete this note?</span>
                            <Button
                              type="button"
                              size="xs"
                              variant="destructive"
                              disabled={pending}
                              onClick={() => {
                                const fd = new FormData();
                                fd.set("id", n.id);
                                run(deleteNote, fd, () => setConfirmDelete(null));
                              }}
                            >
                              Yes, delete
                            </Button>
                            <Button type="button" size="xs" variant="ghost" onClick={() => setConfirmDelete(null)}>
                              Keep
                            </Button>
                          </>
                        ) : (
                          <>
                            {history.length > 0 && (
                              <Button type="button" size="xs" variant="ghost" aria-expanded={showHistory.has(n.id)} onClick={() => toggleHistory(n.id)}>
                                History ({history.length})
                              </Button>
                            )}
                            <Button type="button" size="xs" variant="ghost" onClick={() => { setEditing(n.id); setError(null); }}>
                              Edit
                            </Button>
                            {!isOnboarding && (
                              <Button type="button" size="xs" variant="ghost" onClick={() => setConfirmDelete(n.id)}>
                                Delete
                              </Button>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    {isOnboarding && (
                      <p className="mt-2 text-xs text-muted-foreground">Onboarding notes can be edited, but not added to or deleted.</p>
                    )}
                    {showHistory.has(n.id) && history.length > 0 && (
                      <div className="mt-3 grid gap-2 border-t pt-3">
                        <p className="text-xs font-medium">Earlier versions, newest first</p>
                        {history.map((v) => (
                          <div key={v.id} className="rounded-md bg-muted/40 p-2.5">
                            <p className="mb-1 text-xs text-muted-foreground">
                              <span className="tabular-nums">{noteDateTime(v.saved_at)}</span>
                              {authorBy(v.saved_by_name, "written by")}
                            </p>
                            <p className="whitespace-pre-wrap text-sm">{v.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
