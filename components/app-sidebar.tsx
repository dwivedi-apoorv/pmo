"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseIcon, FolderKanbanIcon, LayoutDashboardIcon, UserRoundPlusIcon, UsersIcon, WalletIcon } from "lucide-react";
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

// To add a menu item, add a line here.
const PAGES = [
  { title: "Dashboard", href: "/", icon: LayoutDashboardIcon },
  { title: "Projects", href: "/projects", icon: BriefcaseIcon },
  { title: "Payments", href: "/payments", icon: WalletIcon },
  { title: "Onboarding", href: "/onboarding", icon: UserRoundPlusIcon },
  { title: "Employees", href: "/people", icon: UsersIcon },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
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
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
