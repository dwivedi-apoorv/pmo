"use client";

import { useState } from "react";
import { FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProjectNotes } from "@/components/project-notes";
import type { NoteVersion, ProjectNote } from "@/lib/notes";

// "Onboarding notes" button for a project row. Opens a popup with the project's onboarding notes,
// where you can read, add, edit and delete them.
export function OnboardingNotesButton({
  projectId,
  projectName,
  notes,
  versions,
}: {
  projectId: string;
  projectName: string;
  notes: ProjectNote[];
  versions: NoteVersion[];
}) {
  const [open, setOpen] = useState(false);
  const count = notes.filter((n) => n.kind === "onboarding").length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="xs" className="whitespace-nowrap" />}>
        <FileTextIcon />
        Onboarding notes
        {count > 0 && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{count}</span>}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Onboarding notes</DialogTitle>
          <DialogDescription>{projectName}</DialogDescription>
        </DialogHeader>
        <ProjectNotes projectId={projectId} notes={notes} versions={versions} kind="onboarding" />
      </DialogContent>
    </Dialog>
  );
}
