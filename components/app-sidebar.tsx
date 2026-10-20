"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseIcon, FileTextIcon, FolderKanbanIcon, LayoutDashboardIcon, LogOutIcon, SettingsIcon, ShieldCheckIcon, UserRoundPlusIcon, UsersIcon, WalletIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { signOut } from "@/app/(auth)/login/actions";

// To add a menu item, add a line here.
const PAGES = [
  { title: "Dashboard", href: "/", icon: LayoutDashboardIcon },
  { title: "Projects", href: "/projects", icon: BriefcaseIcon },
  { title: "Payments", href: "/payments", icon: WalletIcon },
  { title: "Reports", href: "/reports", icon: FileTextIcon },
  { title: "Onboarding", href: "/onboarding", icon: UserRoundPlusIcon },
  { title: "Employees", href: "/people", icon: UsersIcon },
];

export function AppSidebar({ user, admin = false, hidden = [] }: { user: { name: string; email: string }; admin?: boolean; hidden?: string[] }) {
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
              {[...PAGES.filter((p) => !hidden.includes(p.href)), ...(admin ? [{ title: "Access", href: "/access", icon: ShieldCheckIcon }, { title: "Settings", href: "/settings", icon: SettingsIcon }] : [])].map((item) => {
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
      <SidebarFooter>
        <div className="grid gap-1.5 px-2 py-1.5 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium" title={user.name}>{user.name}</p>
            <p className="truncate text-xs text-muted-foreground" title={user.email}>{user.email}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOutIcon className="size-3.5" /> Sign out
            </button>
          </form>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
