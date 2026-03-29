"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { LockKeyhole, Terminal } from "lucide-react";

declare global {
  interface Window {
    injectedWeb3?: Record<string, any>;
  }
}

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const role = searchParams.get("role") || "patient";
  const [walletStatus, setWalletStatus] = useState<string>("idle");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const getRoleTheme = () => {
    switch (role) {
      case "medecin": return "emerald";
      case "pharmacie": return "purple";
      case "hopital": return "sky";
      case "assurance": return "amber";
      default: return "blue";
    }
  };

  const theme = getRoleTheme();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem("msc_role", role);
    router.push(`/dashboard/${role}`);
  };

  const handleWalletConnect = async () => {
    try {
      setWalletStatus("connecting");
      const injected = window.injectedWeb3?.["polkadot-js"];

      if (!injected) {
        setWalletStatus("missing");
        return;
      }

      const extension = await injected.enable("Ma Sante en Chaine");
      const accounts = await extension.accounts.get();

      if (!accounts.length) {
        setWalletStatus("no-accounts");
        return;
      }

      const address = accounts[0]?.address;
      setWalletAddress(address || null);
      setWalletStatus("connected");
      if (address) {
        localStorage.setItem("msc_wallet", address);
      }
      localStorage.setItem("msc_role", role);
      router.push(`/dashboard/${role}`);
    } catch (error) {
      console.error(error);
      setWalletStatus("error");
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 shadow-2xl p-10 rounded-2xl w-full max-w-md relative z-10">
      <div className="flex justify-center mb-6">
        <div className={`p-4 bg-${theme}-950 rounded-2xl border border-${theme}-900`}>
          <LockKeyhole size={32} className={`text-${theme}-500`} />
        </div>
      </div>
      <h2 className="text-3xl font-bold mb-2 text-center text-white font-mono uppercase text-xl">
        &gt; AUTH_{role}
      </h2>
      <p className="text-center text-neutral-500 mb-6 font-mono text-sm">Connexion wallet-only (POC) via extension Polkadot.js.</p>

      <div className="mb-6 space-y-3">
        <button
          type="button"
          onClick={handleWalletConnect}
          className={`w-full font-mono text-white font-bold py-3 rounded-lg transition bg-${theme}-600 hover:bg-${theme}-500 shadow-[0_0_15px_rgba(0,0,0,0.5)]`}
        >
          [ CONNECT_WALLET ]
        </button>
        <div className="text-xs text-neutral-500 font-mono">
          {walletStatus === "missing" && "Extension Polkadot.js introuvable."}
          {walletStatus === "connecting" && "Connexion en cours..."}
          {walletStatus === "no-accounts" && "Aucun compte disponible."}
          {walletStatus === "error" && "Erreur de connexion au wallet."}
          {walletStatus === "connected" && `Wallet connecte: ${walletAddress}`}
          {walletStatus === "idle" && ""}
        </div>
      </div>
      
      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <label className="block text-xs font-mono text-neutral-400 mb-2">&gt; NODE_IDENTIFIER</label>
          <input type="text" placeholder="id@sys.node" className="w-full bg-neutral-950 p-3 border border-neutral-700 text-neutral-300 rounded-lg focus:outline-none focus:border-neutral-500 font-mono text-sm" required />
        </div>
        <div>
          <label className="block text-xs font-mono text-neutral-400 mb-2">&gt; PRIVATE_KEY</label>
          <input type="password" placeholder="****************" className="w-full bg-neutral-950 p-3 border border-neutral-700 text-neutral-300 rounded-lg focus:outline-none focus:border-neutral-500 font-mono" required />
        </div>
        <button type="submit" className={`w-full font-mono text-white font-bold py-3 mt-6 rounded-lg transition bg-${theme}-600 hover:bg-${theme}-500 shadow-[0_0_15px_rgba(0,0,0,0.5)]`}>
          [ EXECUTE_LOGIN ]
        </button>
      </form>
    </div>
  );
}

export default function Login() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 relative">
      <div className="absolute top-8 left-8 text-neutral-600 flex items-center gap-2 font-mono text-sm">
        <Terminal size={16} /> MA_SANTE_EN_CHAINE.exe
      </div>
      <Suspense fallback={<div className="animate-pulse font-mono text-neutral-500">&gt; DECRYPTING...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
