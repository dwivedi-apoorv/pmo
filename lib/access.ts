import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentEmployee, type CurrentEmployee } from "@/lib/auth";
import { isBootstrapAdmin } from "@/lib/ms/config";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type Role = "admin" | "manager" | "member";
export const ROLES: { value: Role; title: string }[] = [
  { value: "admin", title: "Admin" },
  { value: "manager", title: "Manager" },
  { value: "member", title: "Member" },
];
export const isRole = (v: string): v is Role => ROLES.some((r) => r.value === v);

/** What can be switched on or off per role. Admins always have all of them. */
export const PERMISSIONS = [
  { key: "view_all_projects", title: "See every project", text: "Off: only the projects they manage or are assigned to." },
  { key: "payments", title: "Payments and revenue", text: "See and manage payments, revenue and payment details." },
  { key: "manage_projects", title: "Create and edit projects", text: "New projects, editing, team and services, and halting or ending a project." },
  { key: "manage_people", title: "Manage employees", text: "Add, edit, deactivate and delete employees." },
  { key: "edit_notes", title: "Write project notes", text: "Add and edit notes on the projects they can see." },
  { key: "reports", title: "Reports", text: "Open the Reports page and mark reports as sent." },
  { key: "view_activity", title: "See the activity log", text: "Who changed what and when. Without 'see every project' they only see activity on their own projects." },
] as const;
export type Permission = (typeof PERMISSIONS)[number]["key"];

export const DEFAULTS: Record<"manager" | "member", Record<Permission, boolean>> = {
  manager: { view_all_projects: true, payments: true, manage_projects: true, manage_people: false, edit_notes: true, reports: true, view_activity: false },
  member: { view_all_projects: false, payments: false, manage_projects: false, manage_people: false, edit_notes: true, reports: true, view_activity: false },
};

type Matrix = Record<"manager" | "member", Record<Permission, boolean>>;
let cached: { at: number; matrix: Matrix } | null = null;
const MATRIX_TTL_MS = 15_000; // the table changes rarely; this saves a database round trip on most page loads

/** The manager and member columns of the permission table (saved choices over the defaults). */
export async function loadMatrix(): Promise<Matrix> {
  if (cached && Date.now() - cached.at < MATRIX_TTL_MS) return cached.matrix;
  const { data } = await supabaseAdmin.from("role_permissions").select("role, permission, allowed");
  const matrix: Matrix = { manager: { ...DEFAULTS.manager }, member: { ...DEFAULTS.member } };
  for (const r of data ?? []) {
    if ((r.role === "manager" || r.role === "member") && r.permission in DEFAULTS.manager) matrix[r.role as "manager" | "member"][r.permission as Permission] = !!r.allowed;
  }
  cached = { at: Date.now(), matrix };
  return matrix;
}

/** Called after the Access page saves, so this server sees the change straight away. */
export function forgetMatrix() {
  cached = null;
}

export type Access = {
  user: CurrentEmployee;
  role: Role;
  can: (p: Permission) => boolean;
  /** Ids of the projects this person may see, or null for all of them. */
  scope: string[] | null;
  /** Is this project one they may see? */
  sees: (projectId: string) => boolean;
};

/** Who is signed in, their role and what that role allows. null when nobody is signed in. */
export const getAccess = cache(async (): Promise<Access | null> => {
  const user = await getCurrentEmployee(); // already includes the role: one lookup, not two
  if (!user) return null;
  const role: Role = isBootstrapAdmin(user.email) ? "admin" : isRole(user.accessRole) ? user.accessRole : "member";

  // Admins need nothing else. Others: the permission table and their projects, fetched together.
  const [matrix, managed, assigned] = await Promise.all([
    role === "admin" ? Promise.resolve(null) : loadMatrix(),
    role === "admin" ? null : supabaseAdmin.from("projects").select("id").eq("project_manager_id", user.id),
    role === "admin" ? null : supabaseAdmin.from("project_assignments").select("project_id").eq("employee_id", user.id),
  ]);
  const can = (p: Permission) => role === "admin" || matrix![role as "manager" | "member"][p];

  const scope = can("view_all_projects")
    ? null
    : [...new Set([...(managed?.data ?? []).map((r) => r.id as string), ...(assigned?.data ?? []).map((r) => r.project_id as string)])];
  const set = scope && new Set(scope);
  return { user, role, can, scope, sees: (id) => !set || set.has(id) };
});

/** For pages: signed in, or sent to login. */
export async function requirePageAccess(): Promise<Access> {
  const a = await getAccess();
  if (!a) redirect("/login");
  return a;
}

/** For pages: signed in AND allowed, otherwise sent to the dashboard. */
export async function requirePagePermission(p: Permission): Promise<Access> {
  const a = await requirePageAccess();
  if (!a.can(p)) redirect("/");
  return a;
}

export async function requirePageAdmin(): Promise<Access> {
  const a = await requirePageAccess();
  if (a.role !== "admin") redirect("/");
  return a;
}

/** For server actions: refuse unless signed in and allowed. */
export async function requirePermission(p: Permission): Promise<Access> {
  const a = await getAccess();
  if (!a) throw new Error("Please sign in again.");
  if (!a.can(p)) throw new Error("You don't have permission to do that.");
  return a;
}

export async function requireAdmin(): Promise<Access> {
  const a = await getAccess();
  if (!a) throw new Error("Please sign in again.");
  if (a.role !== "admin") throw new Error("Only admins can do that.");
  return a;
}

/** For server actions on one project: also refuse if the project is outside what this person can see. */
export function requireProject(a: Access, projectId: string) {
  if (!a.sees(projectId)) throw new Error("You don't have access to that project.");
}

/** Narrows a query to the projects a person may see (no-op when they can see all). `col` is the project id column. */
export function limitTo<Q>(query: Q, scope: string[] | null, col = "project_id"): Q {
  return scope ? (query as unknown as { in: (c: string, v: string[]) => Q }).in(col, scope) : query;
}
