"use client";

import { useState, useTransition } from "react";
import { CheckCircle2Icon, CircleStopIcon, LinkIcon, MessagesSquareIcon, MoreHorizontalIcon, UnlinkIcon, Trash2Icon, PauseIcon, PlayIcon, RotateCcwIcon, type LucideIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReasonPicker } from "@/components/reason-picker";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { reasonRequired, type ProjectStatus } from "@/lib/status";
import { changeProjectStatus, createProjectChatNow, linkProjectChatNow, unlinkProjectChatNow } from "@/app/actions";

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
  complete: {
    to: "completed",
    menu: "Mark as Completed",
    icon: CheckCircle2Icon,
    title: "Complete",
    text: "Use this when the work was finished. A completed project drops off the dashboard, reports, payments and this month's revenue (unless it still owes money). Its history is kept, and you can reopen it later.",
    cta: "Mark as Completed",
  },
  end: {
    to: "ended",
    menu: "Mark as Lost",
    icon: CircleStopIcon,
    title: "Mark as lost",
    text: "Use this when the client left or the project was lost. A lost project drops off the dashboard, reports, payments and this month's revenue (unless it still owes money). Its history is kept, and you can reopen it later.",
    cta: "Mark as Lost",
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
  active: ["halt", "complete", "end"],
  halted: ["resume", "complete", "end"],
  completed: ["reopen"],
  ended: ["reopen", "complete"],
};

export function ProjectStatusMenu({
  id,
  name,
  status,
  reasons,
  canDelete = false,
  chatUrl = null,
  hasChat = false,
}: {
  id: string;
  name: string;
  status: ProjectStatus;
  reasons: Record<"halted" | "ended" | "completed", string[]>;
  canDelete?: boolean; // admins only
  chatUrl?: string | null; // the project's Teams chat, if it has one
  hasChat?: boolean;
}) {
  const [move, setMove] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [chatMessage, setChatMessage] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [chatLink, setChatLink] = useState("");
  const [postDetails, setPostDetails] = useState(false);
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
          render={<Button variant="ghost" size="icon-sm" aria-label={`Status actions for ${name}`} title="Halt, complete or mark as lost" />}
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
          <DropdownMenuSeparator />
          {hasChat ? (
            <>
              {chatUrl && (
                <DropdownMenuItem render={<a href={chatUrl} target="_blank" rel="noreferrer" />}>
                  <MessagesSquareIcon />
                  Open Teams chat
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() =>
                  startTransition(async () => {
                    const r = await unlinkProjectChatNow(id);
                    setChatMessage(r.message);
                  })
                }
              >
                <UnlinkIcon />
                Unlink Teams chat
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem
                onClick={() =>
                  startTransition(async () => {
                    const r = await createProjectChatNow(id);
                    setChatMessage(r.message);
                  })
                }
              >
                <MessagesSquareIcon />
                Create Teams chat
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLinking(true)}>
                <LinkIcon />
                Link existing chat…
              </DropdownMenuItem>
            </>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2Icon />
                Delete Project…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={chatMessage !== null} onOpenChange={(o) => !o && setChatMessage(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Teams chat for “{name}”</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap">{chatMessage}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <Dialog open={linking} onOpenChange={(o) => { if (!o) { setLinking(false); setChatLink(""); setPostDetails(false); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link an existing Teams chat to “{name}”</DialogTitle>
            <DialogDescription>
              In Teams, open the group, choose ⋯ then “Get link to chat”, and paste the link. Nothing is created or changed in Teams.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const r = await linkProjectChatNow(id, chatLink, postDetails);
                setChatMessage(r.message);
                if (r.ok) { setLinking(false); setChatLink(""); setPostDetails(false); }
              });
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`chat-link-${id}`}>Chat link</Label>
              <Input id={`chat-link-${id}`} value={chatLink} onChange={(e) => setChatLink(e.target.value)} placeholder="https://teams.microsoft.com/l/chat/19:…@thread.v2/…" required />
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input type="checkbox" checked={postDetails} onChange={(e) => setPostDetails(e.target.checked)} className="mt-1" />
              <span>
                Post the project details in the chat
                <span className="block text-xs text-muted-foreground">Also checks that the connected Microsoft account can post there. It has to be a member of the group.</span>
              </span>
            </label>
            <Button type="submit" disabled={pending || !chatLink.trim()}>{pending ? "Linking…" : "Link chat"}</Button>
          </form>
        </DialogContent>
      </Dialog>
      {canDelete && <DeleteProjectDialog id={id} name={name} open={deleting} onOpenChange={setDeleting} />}

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
                {current.to === "active" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`reason-${id}`}>
                      Note <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Textarea id={`reason-${id}`} name="reason" rows={3} placeholder="e.g. Client confirmed new budget" />
                  </div>
                ) : (
                  <ReasonPicker
                    key={current.to}
                    id={`reason-${id}`}
                    options={reasons[current.to as "halted" | "ended" | "completed"]}
                    required={needsReason}
                  />
                )}
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
