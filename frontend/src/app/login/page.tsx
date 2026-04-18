"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LockKeyhole, Terminal } from "lucide-react";
import { connectWallet, signMessage } from "@/lib/wallet";
import { saveSession } from "@/lib/session";
import { resolveWalletIdentityOnChain, resolveWalletRoleOnChain } from "@/lib/onchainIdentity";
import {
  ensureWalletEncryptionKeyRegistered,
  isRateLimitLikeError,
  primeWalletKeyPairFromSignature,
} from "@/lib/medicalCrypto";
import { readWalletProfile, saveWalletProfile } from "@/lib/walletProfileStore";

const FORCED_ADMIN_WALLETS = String(process.env.NEXT_PUBLIC_ADMIN_WALLETS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const AUTO_KEY_REGISTER_LAST_ATTEMPT_KEY = "msc_auto_key_register_last_attempt_v1";
const AUTO_KEY_REGISTER_COOLDOWN_MS = 10 * 60 * 1000;

function normalizeRole(value: string) {
  const v = value.trim().toUpperCase();
  if (v === "DOCTOR" || v === "MEDECIN" || v === "MEDECIN_TRAITANT") return "MEDECIN";
  if (v === "PATIENT") return "PATIENT";
  if (v === "PHARMACY" || v === "PHARMACIE" || v === "PHARMACIEN") return "PHARMACIE";
  if (v === "HOSPITAL" || v === "HOPITAL" || v === "HOSPITALIER") return "HOPITAL";
  if (v === "INSURANCE" || v === "ASSURANCE" || v === "ASSUREUR") return "ASSURANCE";
  if (v === "LAB" || v === "LABO" || v === "LABORATOIRE") return "LABO";
  if (v === "ADMIN" || v === "SUPER_ADMIN" || v === "SUB_ADMIN") return "ADMIN";
  return "";
}

function splitFullName(value: string | null | undefined) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) || "",
  };
}

function birthDateFromAge(age: number) {
  const currentYear = new Date().getFullYear();
  const safeAge = Math.min(120, Math.max(1, Math.floor(age)));
  const year = Math.max(1900, currentYear - safeAge);
  return `${year}-01-01`;
}

function shouldAttemptAutoKeyRegistration() {
  if (typeof window === "undefined") return true;

  try {
    const raw = localStorage.getItem(AUTO_KEY_REGISTER_LAST_ATTEMPT_KEY);
    const lastAttempt = Number(raw || 0);
    if (!Number.isFinite(lastAttempt) || lastAttempt <= 0) {
      return true;
    }

    return Date.now() - lastAttempt >= AUTO_KEY_REGISTER_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markAutoKeyRegistrationAttempt() {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(AUTO_KEY_REGISTER_LAST_ATTEMPT_KEY, String(Date.now()));
  } catch {
    // Ignore storage failures.
  }
}

async function resolveIdentityFromAnchors(walletAddress: string): Promise<{ fullName: string | null }> {
  try {
    const payload = await resolveWalletIdentityOnChain(walletAddress);
    return { fullName: String(payload.fullName || "").trim() || null };
  } catch {
    return { fullName: null };
  }
}

async function detectRoleFromAnchors(walletAddress: string): Promise<{
  role: string;
  anchorsCount: number;
  region?: string | null;
  isGlobalAdmin?: boolean;
  source: string;
}> {
  const payload = await resolveWalletRoleOnChain(walletAddress);
  const normalized = normalizeRole(String(payload.role || ""));

  return {
    role: normalized,
    anchorsCount: Number(payload.anchorsCount || 0),
    region: payload.region ?? null,
    isGlobalAdmin: Boolean(payload.isGlobalAdmin),
    source: String(payload.source || ""),
  };
}

function LoginForm() {
  const router = useRouter();
  const [role, setRole] = useState("UNKNOWN");
  const [walletStatus, setWalletStatus] = useState<string>("idle");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<{
    walletAddress: string;
    role: string;
    region?: string | null;
    isGlobalAdmin?: boolean;
  } | null>(null);
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profileAge, setProfileAge] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
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

  const finalizeLogin = async (payload: {
    walletAddress: string;
    role: string;
    region?: string | null;
    isGlobalAdmin?: boolean;
    firstName: string;
    lastName: string;
    age: number;
  }) => {
    const fullName = [payload.firstName, payload.lastName].filter(Boolean).join(" ").trim();

    const session = {
      token: `local-${Date.now()}`,
      walletAddress: payload.walletAddress,
      role: payload.role,
      identity: {
        role: payload.role,
        fullName: fullName || "Local User",
        nickname: payload.firstName ? payload.firstName.toLowerCase() : "wallet-user",
        dateOfBirth: birthDateFromAge(payload.age),
        region: payload.region ?? null,
        isGlobalAdmin: payload.isGlobalAdmin,
      }
    };

    saveSession({
      token: session.token,
      walletAddress: session.walletAddress,
      role: session.role,
      identity: session.identity
    });

    setWalletStatus("connected");
    router.push(`/dashboard/${session.role.toLowerCase()}`);
  };

  const completeProfileAndContinue = async () => {
    try {
      if (!pendingSession) return;

      const firstName = profileFirstName.trim();
      const lastName = profileLastName.trim();
      const ageValue = Number(profileAge);

      if (!firstName || !lastName) {
        throw new Error("Nom et prénom sont obligatoires.");
      }
      if (!Number.isFinite(ageValue) || ageValue <= 0 || ageValue > 120) {
        throw new Error("Age invalide (1-120).");
      }

      setProfileError(null);
      await saveWalletProfile({
        walletAddress: pendingSession.walletAddress,
        firstName,
        lastName,
        age: Math.floor(ageValue),
      });

      await finalizeLogin({
        walletAddress: pendingSession.walletAddress,
        role: pendingSession.role,
        region: pendingSession.region ?? null,
        isGlobalAdmin: pendingSession.isGlobalAdmin,
        firstName,
        lastName,
        age: Math.floor(ageValue),
      });
    } catch (e: any) {
      setProfileError(e?.message || "Impossible de valider le profil.");
    }
  };

  const handleLogin = async () => {
    try {
      setError(null);
      setProfileError(null);
      setPendingSession(null);

      setLoading(true);
      setWalletStatus("connecting");

      const { walletAddress: address } = await connectWallet();
      setWalletAddress(address);
      let effectiveRole = "";

      setWalletStatus("detecting-role");
      const detected = await detectRoleFromAnchors(address);
      effectiveRole = detected.role;

      if (FORCED_ADMIN_WALLETS.includes(address)) {
        effectiveRole = "ADMIN";
      }

      if (!effectiveRole) {
        const reason = detected.source || "role-not-found";
        throw new Error(
          `Role wallet introuvable dans le registre gouvernance IPFS pour ${address} (source: ${reason}). ` +
          `Ajoutez cette wallet dans NEXT_PUBLIC_ADMIN_WALLETS, redemarrez npm run dev, ` +
          `connectez-vous en ADMIN puis assignez un role a cette wallet.`
        );
      }

      setRole(effectiveRole);

      const message = [
        "MaSanteEnChaine Decentralized Login",
        `wallet:${address}`,
        `timestamp:${Date.now()}`
      ].join("\n");

      const loginSignature = await signMessage(address, message);
      await primeWalletKeyPairFromSignature(address, loginSignature);

      if (shouldAttemptAutoKeyRegistration()) {
        markAutoKeyRegistrationAttempt();
        try {
          await ensureWalletEncryptionKeyRegistered();
        } catch (encryptionKeyError) {
          if (!isRateLimitLikeError(encryptionKeyError)) {
            console.warn("[MSC] Failed to auto-register wallet encryption key at login.", encryptionKeyError);
          }
        }
      }

      const resolvedIdentity = await resolveIdentityFromAnchors(address);
      const persistedProfile = readWalletProfile(address);
      const parsedName = splitFullName(resolvedIdentity.fullName);
      const firstName = String(persistedProfile?.firstName || parsedName.firstName || "").trim();
      const lastName = String(persistedProfile?.lastName || parsedName.lastName || "").trim();
      const persistedAge = Math.floor(Number(persistedProfile?.age || 0));
      const storedAge = Number.isFinite(persistedAge) && persistedAge > 0 ? persistedAge : null;

      const missingFirstName = !firstName;
      const missingLastName = !lastName;
      const missingAge = !storedAge;

      if (missingFirstName || missingLastName || missingAge) {
        setPendingSession({
          walletAddress: address,
          role: effectiveRole,
          region: detected.region ?? null,
          isGlobalAdmin: detected.isGlobalAdmin,
        });
        setProfileFirstName(firstName);
        setProfileLastName(lastName);
        setProfileAge(storedAge ? String(storedAge) : "");
        setWalletStatus("connected");
        return;
      }

      await finalizeLogin({
        walletAddress: address,
        role: effectiveRole,
        region: detected.region ?? null,
        isGlobalAdmin: detected.isGlobalAdmin,
        firstName,
        lastName,
        age: storedAge,
      });
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

      <div className="text-xs text-sky-300 font-mono bg-sky-900/20 border border-sky-700/50 rounded-lg p-3 mb-4">
        Mode sans backend actif: connexion wallet locale (pas d appel /auth/nonce).
      </div>

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
          disabled={loading || Boolean(pendingSession)}
          className={`w-full font-mono text-white font-bold py-3 rounded-lg transition bg-${theme}-600 hover:bg-${theme}-500 shadow-[0_0_15px_rgba(0,0,0,0.5)] disabled:opacity-50`}
        >
          {loading ? "[ AUTHENTICATING... ]" : "[ SIGN_IN_WITH_WALLET ]"}
        </button>

        {pendingSession ? (
          <div className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-4 space-y-3">
            <p className="text-[11px] text-amber-400 font-mono">
              Profil incomplet pour cette wallet. Renseignez nom, prénom et âge pour continuer.
            </p>
            <div className="grid grid-cols-1 gap-2">
              <input
                type="text"
                placeholder="Prénom"
                value={profileFirstName}
                onChange={(event) => setProfileFirstName(event.target.value)}
                className="w-full bg-black border border-neutral-700 text-neutral-200 rounded-lg px-3 py-2 font-mono text-sm"
              />
              <input
                type="text"
                placeholder="Nom"
                value={profileLastName}
                onChange={(event) => setProfileLastName(event.target.value)}
                className="w-full bg-black border border-neutral-700 text-neutral-200 rounded-lg px-3 py-2 font-mono text-sm"
              />
              <input
                type="number"
                min={1}
                max={120}
                placeholder="Âge"
                value={profileAge}
                onChange={(event) => setProfileAge(event.target.value)}
                className="w-full bg-black border border-neutral-700 text-neutral-200 rounded-lg px-3 py-2 font-mono text-sm"
              />
            </div>
            {profileError ? <p className="text-red-400 text-xs font-mono">{profileError}</p> : null}
            <button
              type="button"
              onClick={completeProfileAndContinue}
              className="w-full bg-amber-600 hover:bg-amber-500 text-black font-bold py-2 rounded-lg font-mono"
            >
              [ VALIDER_PROFIL_ET_CONTINUER ]
            </button>
          </div>
        ) : null}

        <div className="text-xs text-neutral-500 font-mono">
          {walletStatus === "connecting" && "Connexion en cours..."}
          {walletStatus === "detecting-role" && "Detection du role wallet via registre IPFS..."}
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
      <LoginForm />
    </div>
  );
}
