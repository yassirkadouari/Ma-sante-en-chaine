"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { LockKeyhole, Terminal } from "lucide-react";
import { connectWallet, signMessage } from "@/lib/wallet";
import { saveSession } from "@/lib/session";
import { apiRequest } from "@/lib/api";

function isDoctorRole(role: string) {
  return role === "MEDECIN";
}

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const role = useMemo(() => (searchParams.get("role") || "patient").toUpperCase(), [searchParams]);
  const [walletStatus, setWalletStatus] = useState<string>("idle");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [requiresProfile, setRequiresProfile] = useState(false);
  const [existingIdentity, setExistingIdentity] = useState<{
    fullName: string;
    nickname: string;
    dateOfBirth: string;
  } | null>(null);
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [cabinetName, setCabinetName] = useState("");
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
        requiresProfile: boolean;
        identity: {
          fullName: string;
          nickname: string;
          dateOfBirth: string;
        } | null;
      }>({
        method: "POST",
        path: "/auth/nonce",
        auth: false,
        body: {
          walletAddress: address,
          role
        }
      });

      setRequiresProfile(Boolean(noncePayload.requiresProfile));
      setExistingIdentity(noncePayload.identity || null);

      if (noncePayload.requiresProfile) {
        if (!fullName.trim() || !nickname.trim() || !dateOfBirth) {
          throw new Error("Ce wallet n'a pas encore d'identite. Renseignez nom, surnom et date de naissance.");
        }

        if (isDoctorRole(role) && !cabinetName.trim()) {
          throw new Error("Pour le medecin, le nom du cabinet est obligatoire.");
        }
      }

      const signature = await signMessage(address, noncePayload.message);

      const session = await apiRequest<{
        token: string;
        walletAddress: string;
        role: string;
        identity: {
          role: string;
          fullName: string;
          nickname: string;
          dateOfBirth: string;
          cabinetName?: string | null;
          institutionName?: string | null;
          doctorApprovalStatus?: "PENDING" | "APPROVED" | "REJECTED";
        } | null;
      }>({
        method: "POST",
        path: "/auth/verify",
        auth: false,
        body: {
          walletAddress: address,
          role,
          nonce: noncePayload.nonce,
          signature,
          profile: noncePayload.requiresProfile
            ? {
                fullName,
                nickname,
                dateOfBirth,
                cabinetName: cabinetName || undefined
              }
            : undefined
        }
      });

      saveSession({
        token: session.token,
        walletAddress: session.walletAddress,
        role: session.role,
        identity: session.identity
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

        {requiresProfile ? (
          <>
            <div className="text-xs text-amber-300 font-mono bg-amber-900/20 border border-amber-700/50 rounded-lg p-3">
              Profil identite introuvable pour ce wallet. Merci de renseigner les informations ci-dessous.
            </div>

            <input
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Nom et prenom"
              className="w-full p-3 bg-neutral-950 border border-neutral-700 text-neutral-300 rounded-lg font-mono text-sm"
            />

            <input
              type="text"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="Surnom"
              className="w-full p-3 bg-neutral-950 border border-neutral-700 text-neutral-300 rounded-lg font-mono text-sm"
            />

            <input
              type="date"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
              className="w-full p-3 bg-neutral-950 border border-neutral-700 text-neutral-300 rounded-lg font-mono text-sm"
            />

            {isDoctorRole(role) ? (
              <input
                type="text"
                value={cabinetName}
                onChange={(event) => setCabinetName(event.target.value)}
                placeholder="Nom du cabinet medical"
                className="w-full p-3 bg-neutral-950 border border-neutral-700 text-neutral-300 rounded-lg font-mono text-sm"
              />
            ) : null}
          </>
        ) : existingIdentity ? (
          <div className="text-xs text-emerald-300 font-mono bg-emerald-900/20 border border-emerald-700/50 rounded-lg p-3">
            Wallet identifie: {existingIdentity.fullName} ({existingIdentity.nickname})
          </div>
        ) : null}

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
