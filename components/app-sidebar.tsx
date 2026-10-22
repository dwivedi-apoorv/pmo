"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ActivityIcon, BellIcon, BriefcaseIcon, ChevronDownIcon,  FileTextIcon, FolderKanbanIcon, LayoutDashboardIcon, LogOutIcon, SettingsIcon, ShieldCheckIcon, TrendingUpIcon, UserRoundPlusIcon, UsersIcon, WalletIcon } from "lucide-react";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
  { title: "Insights", href: "/insights", icon: TrendingUpIcon },
  { title: "Activity", href: "/activity", icon: ActivityIcon },
];

// Everything under the "Settings" dropdown (admins only). To add a settings page, add a line here.
const SETTINGS_PAGES = [
  { title: "General settings", href: "/settings", icon: SettingsIcon },
  { title: "Access", href: "/access", icon: ShieldCheckIcon },
  { title: "Notifications", href: "/notifications", icon: BellIcon },
];

export function AppSidebar({ user, admin = false, hidden = [] }: { user: { name: string; email: string }; admin?: boolean; hidden?: string[] }) {
  const pathname = usePathname();
  const inSettings = SETTINGS_PAGES.some((p) => pathname.startsWith(p.href));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const showSettings = settingsOpen || inSettings; // always open while you're on one of its pages

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
              {PAGES.filter((p) => !hidden.includes(p.href)).map((item) => {
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
              {admin && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={inSettings}
                    aria-expanded={showSettings}
                    onClick={() => setSettingsOpen(!showSettings)}
                  >
                    <SettingsIcon />
                    <span>Settings</span>
                    <ChevronDownIcon className={`ml-auto transition-transform ${showSettings ? "rotate-180" : ""}`} />
                  </SidebarMenuButton>
                  {showSettings && (
                    <SidebarMenuSub>
                      {SETTINGS_PAGES.map((item) => (
                        <SidebarMenuSubItem key={item.href}>
                          <SidebarMenuSubButton isActive={pathname.startsWith(item.href)} render={<Link href={item.href} />}>
                            <span>{item.title}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              )}
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
