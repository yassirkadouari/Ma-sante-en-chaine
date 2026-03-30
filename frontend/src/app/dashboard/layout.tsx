"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, TerminalSquare } from "lucide-react";
import { clearSession, loadSession } from "@/lib/session";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const session = loadSession();
    const roleFromPath = pathname?.split("/dashboard/")[1]?.split("/")[0]?.toUpperCase();

    if (!session?.token || !roleFromPath || session.role !== roleFromPath) {
      router.replace(`/login?role=${roleFromPath || "patient"}`);
    }
  }, [pathname, router]);

  const handleDisconnect = () => {
    clearSession();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-black flex flex-col font-sans text-neutral-300">
      <header className="bg-neutral-950/80 backdrop-blur-md px-8 py-4 flex justify-between items-center border-b border-neutral-800 sticky top-0 z-50">
        <div className="text-xl font-bold flex items-center gap-3 font-mono">
          <TerminalSquare className="text-emerald-500" size={24} />
          <span className="bg-gradient-to-r from-emerald-400 to-blue-500 bg-clip-text text-transparent">
            MA_SANTÉ_EN_CHAÎNE
          </span>
        </div>
        <button
          type="button"
          onClick={handleDisconnect}
          className="text-neutral-500 hover:text-red-500 font-mono text-sm flex items-center gap-2 transition"
        >
          [ DISCONNECT ] <LogOut size={16} />
        </button>
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
