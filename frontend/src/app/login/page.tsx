"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { LockKeyhole, Terminal } from "lucide-react";
import { connectWallet, signMessage } from "@/lib/wallet";
import { saveSession } from "@/lib/session";
import { apiRequest } from "@/lib/api";

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const role = useMemo(() => (searchParams.get("role") || "patient").toUpperCase(), [searchParams]);
  const [walletStatus, setWalletStatus] = useState<string>("idle");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getRoleTheme = () => {
    switch (role) {
      case "ADMIN": return "red";
      case "MEDECIN": return "emerald";
      case "PHARMACIE": return "violet";
      case "HOPITAL": return "sky";
      case "ASSURANCE": return "amber";
      default: return "blue";
    }
  };

  const theme = getRoleTheme();

  const handleLogin = async () => {
    try {
      setError(null);
      setLoading(true);
      setWalletStatus("connecting");

      const { walletAddress: address } = await connectWallet();
      setWalletAddress(address);

      const noncePayload = await apiRequest<{
        message: string;
        nonce: string;
      }>({
        method: "POST",
        path: "/auth/nonce",
        auth: false,
        body: {
          walletAddress: address,
          role
        }
      });

      const signature = await signMessage(address, noncePayload.message);

      const session = await apiRequest<{
        token: string;
        walletAddress: string;
        role: string;
      }>({
        method: "POST",
        path: "/auth/verify",
        auth: false,
        body: {
          walletAddress: address,
          role,
          nonce: noncePayload.nonce,
          signature
        }
      });

      saveSession({
        token: session.token,
        walletAddress: session.walletAddress,
        role: session.role
      });

      setWalletStatus("connected");
      router.push(`/dashboard/${role.toLowerCase()}`);
    } catch (error: any) {
      setError(error?.message || "Wallet authentication failed");
      setWalletStatus("error");
    } finally {
      setLoading(false);
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
      <p className="text-center text-neutral-500 mb-6 font-mono text-sm">Wallet signature login with nonce + JWT session.</p>

      <div className="space-y-5">
        <div className="w-full bg-neutral-950 p-3 border border-neutral-700 text-neutral-300 rounded-lg font-mono text-sm">
          ROLE: {role}
        </div>

        <div className="w-full bg-neutral-950 p-3 border border-neutral-700 text-neutral-300 rounded-lg font-mono text-sm break-all">
          WALLET: {walletAddress || "Not connected"}
        </div>

        <button
          type="button"
          onClick={handleLogin}
          disabled={loading}
          className={`w-full font-mono text-white font-bold py-3 rounded-lg transition bg-${theme}-600 hover:bg-${theme}-500 shadow-[0_0_15px_rgba(0,0,0,0.5)] disabled:opacity-50`}
        >
          {loading ? "[ AUTHENTICATING... ]" : "[ SIGN_IN_WITH_WALLET ]"}
        </button>

        <div className="text-xs text-neutral-500 font-mono">
          {walletStatus === "connecting" && "Connexion en cours..."}
          {walletStatus === "error" && "Erreur de connexion au wallet ou signature invalide."}
          {walletStatus === "connected" && `Wallet connecte: ${walletAddress}`}
          {walletStatus === "idle" && ""}
        </div>

        {error ? <p className="text-red-400 text-xs font-mono">{error}</p> : null}
      </div>
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
