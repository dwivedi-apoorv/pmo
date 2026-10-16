"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmployeeOption } from "@/components/employee-select";
import { NewProjectDialog } from "@/components/new-project-dialog";

export function NewProjectButton({
  employees,
  managers,
}: {
  employees: EmployeeOption[];
  managers: EmployeeOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> New project
      </Button>
      <NewProjectDialog employees={employees} managers={managers} open={open} onOpenChange={setOpen} />
    </>
  );
}
