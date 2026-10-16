import { supabase } from "@/lib/supabase";

export type Person = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  is_active: boolean;
  slug: string;
};

const slugify = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "person";

// Loads every employee and gives each a URL slug made from their name
// ("Kajal Singh" -> "kajal-singh"). If two people share a name, the one added
// later gets "-2", "-3"... so slugs are always unique and stable.
export async function loadPeople() {
  const { data, error } = await supabase
    .from("employees")
    .select("id, name, email, role, is_active, created_at")
    .order("created_at")
    .order("id")
    .returns<Omit<Person, "slug">[]>();

  const used = new Map<string, number>();
  const people: Person[] = (data ?? []).map((e) => {
    const base = slugify(e.name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { ...e, slug: n === 1 ? base : `${base}-${n}` };
  });

  const slugById = new Map(people.map((p) => [p.id, p.slug]));
  return {
    error,
    people,
    slugOf: (id: string) => slugById.get(id) ?? id,
    bySlug: (slug: string) => people.find((p) => p.slug === slug),
  };
}

export const isProjectManager = (e: { role: string | null }) => e.role?.trim().toLowerCase() === "project manager";
