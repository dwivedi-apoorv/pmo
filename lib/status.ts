// Project lifecycle. Projects are never deleted: they are Halted (suspended) or Ended, with a reason.
export const PROJECT_STATUSES = ["active", "halted", "ended"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  halted: "Halted",
  ended: "Ended",
};

export const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, halted: 1, ended: 2 };

export const isProjectStatus = (v: string): v is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(v);

/** A reason is mandatory when a project stops (halted or ended), optional when it starts again. */
export const reasonRequired = (to: ProjectStatus) => to !== "active";
