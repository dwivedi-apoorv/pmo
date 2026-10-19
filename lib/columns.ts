// Columns of the dashboard's projects table that can be hidden. "Project" and "Edit" always show.
export const COLUMNS = [
  { id: "client", label: "Client name" },
  { id: "services", label: "Services" },
  { id: "website", label: "Website" },
  { id: "onboarded", label: "Onboarded" },
  { id: "reporting", label: "Next report" },
  { id: "payment", label: "Next payment" },
  { id: "manager", label: "Project manager" },
  { id: "assigned", label: "Assigned to" },
  { id: "notes", label: "Onboarding notes" },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];

// Hidden columns are remembered in this browser's cookie, so the server can leave them out
// of the page (no flicker on load).
export const HIDDEN_COLUMNS_COOKIE = "pmo_hidden_cols";

export const parseHidden = (raw: string | undefined): Set<ColumnId> =>
  new Set(
    (raw ?? "")
      .split(",")
      .filter((id): id is ColumnId => COLUMNS.some((c) => c.id === id))
  );
