"use client";

import { useState } from "react";
import { UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewEmployeeDialog } from "@/components/new-employee-dialog";

export function NewEmployeeButton({ roles }: { roles: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon /> Add employee
      </Button>
      <NewEmployeeDialog roles={roles} open={open} onOpenChange={setOpen} />
    </>
  );
}
