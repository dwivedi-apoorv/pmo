"use client";

import { useState, useTransition } from "react";
import { CircleStopIcon, MoreHorizontalIcon, PauseIcon, PlayIcon, RotateCcwIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reasonRequired, type ProjectStatus } from "@/lib/status";
import { changeProjectStatus } from "@/app/actions";

// What each move does, in the words shown to the user.
const MOVES: Record<
  string,
  { to: ProjectStatus; menu: string; icon: LucideIcon; title: string; text: string; cta: string; destructive?: boolean }
> = {
  halt: {
    to: "halted",
    menu: "Halt Project",
    icon: PauseIcon,
    title: "Halt",
    text: "Use this when work or billing is paused or suspended. A halted project drops off the dashboard, reports, payments and this month's revenue (unless it still owes money) until you resume it. Nothing is deleted.",
    cta: "Halt Project",
  },
  end: {
    to: "ended",
    menu: "End Project",
    icon: CircleStopIcon,
    title: "End",
    text: "Use this when the engagement is over. An ended project drops off the dashboard, reports, payments and this month's revenue (unless it still owes money). Its history is kept, and you can reopen it later.",
    cta: "End Project",
    destructive: true,
  },
  resume: {
    to: "active",
    menu: "Resume Project",
    icon: PlayIcon,
    title: "Resume",
    text: "The project goes back on the dashboard, reports, payments and this month's revenue.",
    cta: "Resume Project",
  },
  reopen: {
    to: "active",
    menu: "Reopen Project",
    icon: RotateCcwIcon,
    title: "Reopen",
    text: "The project goes back to Active, on the dashboard, reports, payments and this month's revenue.",
    cta: "Reopen Project",
  },
};

const OPTIONS: Record<ProjectStatus, string[]> = {
  active: ["halt", "end"],
  halted: ["resume", "end"],
  ended: ["reopen"],
};

export function ProjectStatusMenu({
  id,
  name,
  status,
}: {
  id: string;
  name: string;
  status: ProjectStatus;
}) {
  const [move, setMove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = move ? MOVES[move] : null;
  const needsReason = current ? reasonRequired(current.to) : false;
  const options = OPTIONS[status];

  function close() {
    setMove(null);
    setError(null);
  }

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await changeProjectStatus(formData);
        close();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Status actions for ${name}`} title="Halt or end" />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {options.map((key) => (
            <DropdownMenuItem
              key={key}
              variant={MOVES[key].destructive ? "destructive" : "default"}
              onClick={() => setMove(key)}
            >
              {(() => {
                const Icon = MOVES[key].icon;
                return <Icon />;
              })()}
              {MOVES[key].menu}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={move !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {current.title} “{name}”
                </DialogTitle>
                <DialogDescription>{current.text}</DialogDescription>
              </DialogHeader>
              <form action={onSubmit} className="grid gap-4">
                <input type="hidden" name="project_id" value={id} />
                <input type="hidden" name="status" value={current.to} />
                <div className="grid gap-1.5">
                  <Label htmlFor={`reason-${id}`}>
                    Reason {needsReason ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}
                  </Label>
                  <Textarea
                    id={`reason-${id}`}
                    name="reason"
                    rows={3}
                    required={needsReason}
                    placeholder={
                      current.to === "halted"
                        ? "e.g. Client paused work until the new budget is approved"
                        : current.to === "ended"
                          ? "e.g. Contract completed / client did not renew"
                          : "e.g. Client confirmed new budget"
                    }
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" variant={current.destructive ? "destructive" : "default"} disabled={pending}>
                  {pending ? "Saving…" : current.cta}
                </Button>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
