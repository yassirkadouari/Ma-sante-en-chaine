"use client";

import { useEffect } from "react";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, TerminalSquare } from "lucide-react";
import { clearSession, loadSession } from "@/lib/session";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [identityLabel, setIdentityLabel] = useState<string>("");

  useEffect(() => {
    const session = loadSession();
    const roleFromPath = pathname?.split("/dashboard/")[1]?.split("/")[0]?.toUpperCase();

    const isAuthorized = session?.role === roleFromPath || (session?.role === "SUB_ADMIN" && roleFromPath === "ADMIN");

    if (!session?.token || !roleFromPath || !isAuthorized) {
      router.replace("/login");
      return;
    }

    const profile = session.identity;
    const name = profile?.fullName || session.walletAddress;
    const nickname = profile?.nickname ? ` (${profile.nickname})` : "";
    setIdentityLabel(`${name}${nickname} - ${session.role}`);
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
        <div className="flex items-center gap-4">
          {identityLabel ? <span className="text-xs text-neutral-400 font-mono">{identityLabel}</span> : null}
          <button
            type="button"
            onClick={handleDisconnect}
            className="text-neutral-500 hover:text-red-500 font-mono text-sm flex items-center gap-2 transition"
          >
            [ DISCONNECT ] <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
