"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseIcon, FolderKanbanIcon, LayoutDashboardIcon, PlusIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { EmployeeOption } from "@/components/employee-select";
import { NewEmployeeDialog } from "@/components/new-employee-dialog";
import { NewProjectDialog } from "@/components/new-project-dialog";

// To add a menu item, add a line to one of these two lists.
const PAGES = [
  { title: "Dashboard", href: "/", icon: LayoutDashboardIcon },
  { title: "Projects", href: "/projects", icon: BriefcaseIcon },
  { title: "Employees", href: "/people", icon: UsersIcon },
];

const ACTIONS = [
  { key: "project", title: "New project", icon: PlusIcon },
  { key: "employee", title: "Add employee", icon: UserPlusIcon },
] as const;

export function AppSidebar({
  assignable,
  managers,
  roles,
}: {
  assignable: EmployeeOption[];
  managers: EmployeeOption[];
  roles: string[];
}) {
  const pathname = usePathname();
  const [dialog, setDialog] = useState<(typeof ACTIONS)[number]["key"] | null>(null);

  return (
    <>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5 font-semibold">
            <FolderKanbanIcon className="size-5" /> PMO
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Menu</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {PAGES.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton isActive={active} render={<Link href={item.href} />}>
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Create</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ACTIONS.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton onClick={() => setDialog(item.key)}>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <NewProjectDialog
        employees={assignable}
        managers={managers}
        open={dialog === "project"}
        onOpenChange={(o) => setDialog(o ? "project" : null)}
      />
      <NewEmployeeDialog
        roles={roles}
        open={dialog === "employee"}
        onOpenChange={(o) => setDialog(o ? "employee" : null)}
      />
    </>
  );
}
