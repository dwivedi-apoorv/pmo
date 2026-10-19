import { FolderKanbanIcon } from "lucide-react";
import { authConfigured } from "@/lib/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex items-center justify-center gap-2 text-lg font-semibold">
        <FolderKanbanIcon className="size-6" /> PMO
      </div>
      {authConfigured() ? (
        <LoginForm next={next ?? ""} />
      ) : (
        <p role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
          Login isn&apos;t set up yet. Set <code>AUTH_SECRET</code> (a random string of 32 or more characters) in
          the server settings, then reload.
        </p>
      )}
    </div>
  );
}
