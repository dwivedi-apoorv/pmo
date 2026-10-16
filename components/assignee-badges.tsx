import Link from "next/link";
import { Badge } from "@/components/ui/badge";

// Assigned people; each name links to that person's project list.
export function AssigneeBadges({ people }: { people: { id: string; name: string; slug: string }[] }) {
  if (people.length === 0) return <span className="text-sm text-muted-foreground">Unassigned</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {people.map((e) => (
        <Link key={e.id} href={`/projects/${e.slug}`}>
          <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/70">
            {e.name}
          </Badge>
        </Link>
      ))}
    </div>
  );
}
