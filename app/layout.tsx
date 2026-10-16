import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { isProjectManager, loadPeople } from "@/lib/people";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = { title: "PMO Dashboard" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // If loading fails, the sidebar still renders (dialogs just have empty lists);
  // each page shows its own error message.
  const { people } = await loadPeople();
  const active = people.filter((e) => e.is_active);
  const roles = [
    ...new Set(["Project Manager", ...people.flatMap((e) => (e.role ? [e.role.trim()] : []))]),
  ].sort();

  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar
              assignable={active.filter((e) => !isProjectManager(e))}
              managers={active.filter(isProjectManager)}
              roles={roles}
            />
            <SidebarInset className="min-w-0">
              <header className="flex h-12 items-center gap-2 border-b px-4">
                <SidebarTrigger />
              </header>
              {children}
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
