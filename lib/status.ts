// Project lifecycle. Projects are never deleted: they are Halted (suspended), Completed (finished well) or
// Lost ("ended" in the database: the client left), with a reason for halted and lost.
export const PROJECT_STATUSES = ["active", "halted", "completed", "ended"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  halted: "Halted",
  completed: "Completed",
  ended: "Lost",
};

export const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, halted: 1, completed: 2, ended: 3 };

export const isProjectStatus = (v: string): v is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(v);

/** A reason is mandatory when a project is halted or lost; optional when it is completed or starts again. */
export const reasonRequired = (to: ProjectStatus) => to === "halted" || to === "ended";

/** Finished for good: completed or lost. Neither shows up in reports or payments, and nobody needs handing over. */
export const isClosed = (s: ProjectStatus | string) => s === "completed" || s === "ended";
