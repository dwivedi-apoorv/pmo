import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requirePageAccess } from "@/lib/access";

// Everything inside the app sits behind the login: no signed-in, active employee, no page.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requirePageAccess();
  const user = access.user;
  const hidden = [...(access.can("payments") ? [] : ["/payments"]), ...(access.can("reports") ? [] : ["/reports"]), ...(access.can("view_activity") ? [] : ["/activity"])];

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar user={{ name: user.name, email: user.email }} admin={access.role === "admin"} hidden={hidden} />
        <SidebarInset className="min-w-0">
          <header className="flex h-12 items-center gap-2 border-b px-4">
            <SidebarTrigger />
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
