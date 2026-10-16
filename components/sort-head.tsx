import Link from "next/link";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { TableHead } from "@/components/ui/table";

export type SortDir = "asc" | "desc";

// A table header that sorts by clicking. The sort lives in the URL (?sort=…&dir=…),
// so it survives refreshes and can be shared.
export function SortHead({
  basePath,
  k,
  sort,
  dir,
  q,
  children,
}: {
  basePath: string;
  k: string;
  sort: string;
  dir: SortDir;
  q?: string;
  children: React.ReactNode;
}) {
  const current = sort === k;
  const nextDir: SortDir = current && dir === "asc" ? "desc" : "asc";
  const Icon = !current ? ArrowUpDownIcon : dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead aria-sort={current ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={`${basePath}?${new URLSearchParams({ ...(q ? { q } : {}), sort: k, dir: nextDir })}`} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
        <Icon className={current ? "size-3.5" : "size-3.5 opacity-40"} />
      </Link>
    </TableHead>
  );
}
