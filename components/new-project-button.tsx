"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmployeeOption } from "@/components/employee-select";
import { NewProjectDialog } from "@/components/new-project-dialog";
import type { Service } from "@/lib/services";

export function NewProjectButton({
  employees,
  managers,
  services,
  showPayment = true,
  currencies = ["USD", "CAD"],
}: {
  employees: EmployeeOption[];
  managers: EmployeeOption[];
  services: Service[];
  showPayment?: boolean;
  currencies?: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> New project
      </Button>
      <NewProjectDialog employees={employees} managers={managers} services={services} showPayment={showPayment} currencies={currencies} open={open} onOpenChange={setOpen} />
    </>
  );
}
