"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Columns3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COLUMNS, HIDDEN_COLUMNS_COOKIE, type ColumnId } from "@/lib/columns";

export function ColumnsMenu({ hidden: initial }: { hidden: ColumnId[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<ColumnId>>(new Set(initial));
  const [, startTransition] = useTransition();

  function save(next: Set<ColumnId>) {
    setHidden(next);
    const value = [...next].join(",");
    // One year, this browser only. The server reads it to leave the columns out.
    document.cookie = `${HIDDEN_COLUMNS_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  function toggle(id: ColumnId, show: boolean) {
    const next = new Set(hidden);
    if (show) next.delete(id);
    else next.add(id);
    save(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" aria-label="Choose columns" title="Columns" />}
      >
        <Columns3Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {COLUMNS.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={!hidden.has(c.id)}
            closeOnClick={false}
            onCheckedChange={(checked) => toggle(c.id, checked)}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
        {hidden.size > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem closeOnClick={false} onClick={() => save(new Set())}>
              Show all columns
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
