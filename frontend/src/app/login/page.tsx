"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { LockKeyhole, Terminal, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import { connectWallet, signMessage } from "@/lib/wallet";
import { saveSession } from "@/lib/session";
import { apiRequest } from "@/lib/api";

const REGIONS = [
  "TANGER-TETOUAN-AL HOCEIMA", "L'ORIENTAL", "FES-MEKNES", "RABAT-SALE-KENITRA",
  "BENI MELLAL-KHENIFRA", "CASABLANCA-SETTAT", "MARRAKECH-SAFI", "DRAA-TAFILALET",
  "SOUSS-MASSA", "GUELMIM-OUED NOUN", "LAAYOUNE-SAKIA EL HAMRA", "EDDAKHLA-OUED EDDAHAB"
];

const ROLES = [
  { id: "PATIENT", label: "Patient" },
  { id: "MEDECIN", label: "Médecin" },
  { id: "PHARMACIE", label: "Pharmacie" },
  { id: "ASSURANCE", label: "Assurance" },
  { id: "HOPITAL", label: "Hôpital" }
];

function LoginForm() {
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [view, setView] = useState<"CONNECT" | "REGISTER" | "STATUS" | "LOGIN" | "COMPLETE_PROFILE">("CONNECT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Registration state
  const [selectedRole, setSelectedRole] = useState("PATIENT");
  const [selectedRegion, setSelectedRegion] = useState(REGIONS[0]);
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [cabinetName, setCabinetName] = useState("");

  // Identity state
  const [identity, setIdentity] = useState<any>(null);
  const [nonceData, setNonceData] = useState<any>(null);

  const handleConnect = async () => {
    try {
      setLoading(true);
      setError(null);
      const { walletAddress: address } = await connectWallet();
      setWalletAddress(address);

      // Check current status
      const res = await apiRequest<any>({
        method: "GET",
        path: `/auth/roles/${address}`,
        auth: false
      });

      const idRes = await apiRequest<any>({
        method: "POST",
        path: "/auth/nonce",
        auth: false,
        body: { walletAddress: address }
      }).catch(() => null);

      if (!idRes || !idRes.identity) {
        // No identity record yet, but maybe they have a role pre-assigned?
        if (idRes && idRes.roles && idRes.roles.length > 0) {
          setSelectedRole(idRes.roles[0]);
          setView("COMPLETE_PROFILE");
        } else {
          setView("REGISTER");
        }
      } else {
        setIdentity(idRes.identity);
        setNonceData(idRes);

        // Even if identity exists, some profiles created by admins might be "skeletal"
        // (PENDING_PROFILE_MARKER)
        const isComplete = idRes.identity.fullName !== "PENDING_PROFILE" && !!idRes.identity.dateOfBirth;

        if (!isComplete) {
          setSelectedRole(idRes.identity.role);
          if (idRes.identity.region) setSelectedRegion(idRes.identity.region);
          setView("COMPLETE_PROFILE");
        } else if (idRes.identity.approvalStatus !== "APPROVED") {
          setView("STATUS");
        } else {
          setView("LOGIN");
        }
      }
    } catch (err: any) {
      setError(err.message || "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    try {
      setLoading(true);
      setError(null);
      if (!fullName || !nickname || !dateOfBirth) {
        throw new Error("Veuillez remplir tous les champs obligatoires.");
      }

      await apiRequest({
        method: "POST",
        path: "/auth/register",
        auth: false,
        body: {
          walletAddress,
          role: selectedRole,
          region: selectedRegion,
          profile: {
            fullName,
            nickname,
            dateOfBirth,
            cabinetName: selectedRole === "MEDECIN" ? cabinetName : undefined
          }
        }
      });

      handleConnect(); // Refresh status
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleFinalSignIn = async () => {
    try {
      setLoading(true);
      if (!nonceData || !walletAddress) return;

      const signature = await signMessage(walletAddress, nonceData.message);
      const session = await apiRequest<any>({
        method: "POST",
        path: "/auth/verify",
        auth: false,
        body: {
          walletAddress,
          nonce: nonceData.nonce,
          signature,
          role: identity.role
        }
      });

      saveSession({
        token: session.token,
        walletAddress: session.walletAddress,
        role: session.role,
        identity: session.identity
      });

      const targetRole = (session.role === "SUB_ADMIN" || session.role === "ADMIN") ? "admin" : session.role.toLowerCase();
      router.push(`/dashboard/${targetRole}`);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 shadow-2xl p-8 rounded-2xl w-full max-w-lg relative z-10 transition-all">
      {/* Header */}
      <div className="flex justify-center mb-6">
        <div className={`p-4 bg-emerald-950/30 rounded-2xl border border-emerald-900/50`}>
          <LockKeyhole size={32} className={`text-emerald-500`} />
        </div>
      </div>
      <h2 className="text-2xl font-bold mb-2 text-center text-white font-mono uppercase">
        {view === "CONNECT" && "> INITIATE_SESSION"}
        {view === "REGISTER" && "> REGISTER_IDENTITY"}
        {view === "COMPLETE_PROFILE" && "> COMPLETE_YOUR_PROFILE"}
        {view === "STATUS" && "> ACCOUNT_STATUS"}
        {view === "LOGIN" && "> ACCESS_TERMINAL"}
      </h2>
      <p className="text-center text-neutral-500 mb-8 font-mono text-xs">
        {walletAddress ? `ADDR: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "En attente de connexion wallet..."}
      </p>

      {error && (
        <div className="mb-6 p-4 bg-red-950/20 border border-red-900/50 rounded-lg flex items-center gap-3 text-red-400 text-xs font-mono">
          <ShieldAlert size={16} /> {error}
        </div>
      )}

      {/* Views */}
      <div className="space-y-4">
        {view === "CONNECT" && (
          <button
            onClick={handleConnect}
            disabled={loading}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:opacity-50"
          >
            {loading ? "[ ...CONNECTING... ]" : "[ CONNECT_WALLET ]"}
          </button>
        )}

        {view === "REGISTER" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
               <div>
                 <label className="text-[10px] text-neutral-500 font-mono mb-1 block uppercase">Role</label>
                 <select 
                   value={selectedRole}
                   onChange={(e) => setSelectedRole(e.target.value)}
                   className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
                 >
                   {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                 </select>
               </div>
               <div>
                 <label className="text-[10px] text-neutral-500 font-mono mb-1 block uppercase">Région</label>
                 <select 
                   value={selectedRegion}
                   onChange={(e) => setSelectedRegion(e.target.value)}
                   className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
                 >
                   {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                 </select>
               </div>
            </div>
            
            <input
              type="text"
              placeholder="Nom Complet"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
            />
            <input
              type="text"
              placeholder="Pseudo"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
            />
            <input
              type="date"
              value={dateOfBirth}
              onChange={e => setDateOfBirth(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
            />
            
            {selectedRole === "MEDECIN" && (
              <input
                type="text"
                placeholder="Nom du Cabinet"
                value={cabinetName}
                onChange={e => setCabinetName(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
              />
            )}

            <button
              onClick={handleRegister}
              disabled={loading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-mono font-bold rounded-xl transition-all disabled:opacity-50 mt-4"
            >
              {loading ? "[ ENREGISTREMENT... ]" : "[ ENVOYER_DEMANDE ]"}
            </button>
            <button onClick={() => setView("CONNECT")} className="w-full text-neutral-500 text-[10px] font-mono hover:text-white transition">RETOUR</button>
          </div>
        )}

        {view === "COMPLETE_PROFILE" && (
          <div className="space-y-4">
            <div className="p-4 bg-blue-950/20 border border-blue-900/50 rounded-xl mb-4">
              <p className="text-blue-400 text-[10px] font-mono uppercase font-bold mb-1">Réseau Détecté</p>
              <p className="text-white text-xs font-mono">Un rôle de <span className="text-blue-400 font-bold">{selectedRole}</span> a été pré-assigné à votre wallet.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
               <div>
                 <label className="text-[10px] text-neutral-500 font-mono mb-1 block uppercase">Role (Verrouillé)</label>
                 <div className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-2.5 text-sm font-mono text-neutral-400">
                    {selectedRole}
                 </div>
               </div>
               <div>
                  <label className="text-[10px] text-neutral-500 font-mono mb-1 block uppercase">Région</label>
                  <select 
                    value={selectedRegion}
                    onChange={(e) => setSelectedRegion(e.target.value)}
                    disabled={!!identity?.region}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm font-mono text-white focus:border-emerald-500/50 outline-none disabled:opacity-50"
                  >
                    {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
               </div>
            </div>
            
            <input
              type="text"
              placeholder="Nom Complet"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
            />
            <input
              type="text"
              placeholder="Pseudo"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
            />
            <input
              type="date"
              value={dateOfBirth}
              onChange={e => setDateOfBirth(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
            />
            
            {selectedRole === "MEDECIN" && (
              <input
                type="text"
                placeholder="Nom du Cabinet"
                value={cabinetName}
                onChange={e => setCabinetName(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm font-mono text-white focus:border-emerald-500/50 outline-none"
              />
            )}

            <button
              onClick={handleRegister}
              disabled={loading}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold rounded-xl transition-all disabled:opacity-50 mt-4"
            >
              {loading ? "[ FINALISATION... ]" : "[ FINALISER_MON_COMPTE ]"}
            </button>
            <button onClick={() => setView("CONNECT")} className="w-full text-neutral-500 text-[10px] font-mono hover:text-white transition">ANNULER</button>
          </div>
        )}

        {view === "STATUS" && (
          <div className="text-center space-y-6 py-4">
             <div className="flex flex-col items-center gap-4">
                {identity?.approvalStatus === "REJECTED" ? (
                  <>
                    <ShieldAlert size={48} className="text-red-500" />
                    <p className="text-red-400 font-mono text-sm leading-relaxed">
                      Votre demande d'accès a été <span className="font-bold underline">refusée</span> par l'administration regionale de {identity.region}.
                    </p>
                  </>
                ) : (
                  <>
                    <Clock size={48} className="text-amber-500 animate-pulse" />
                    <p className="text-amber-400 font-mono text-sm leading-relaxed">
                      Votre compte est en attente de validation par l'administrateur de votre région (<span className="text-white">{identity?.region}</span>).
                    </p>
                    <p className="text-neutral-500 text-[10px] font-mono uppercase tracking-widest">Verification en cours...</p>
                  </>
                )}
             </div>
             <button onClick={() => setView("CONNECT")} className="w-full py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-mono text-sm rounded-lg transition">RETENTER</button>
          </div>
        )}

        {view === "LOGIN" && (
          <div className="space-y-6 py-4">
             <div className="p-4 bg-emerald-950/20 border border-emerald-900/50 rounded-xl flex items-center gap-4">
                <CheckCircle2 className="text-emerald-500" size={24} />
                <div className="font-mono text-left">
                   <p className="text-emerald-500 text-[10px] uppercase font-bold">Identité Validée</p>
                   <p className="text-white text-sm">{identity.fullName}</p>
                   <p className="text-neutral-500 text-[10px]">{identity.role} | {identity.region}</p>
                </div>
             </div>
             <button
              onClick={handleFinalSignIn}
              disabled={loading}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:opacity-50"
            >
              {loading ? "[ INITIALISATION... ]" : "[ ACCÉDER_AU_DASHBOARD ]"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-8 pt-6 border-t border-neutral-800 text-[10px] font-mono text-neutral-600 flex justify-between">
        <span>EST: 2026.MOROCCO</span>
        <span>NODE: {view}</span>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 relative">
      <div className="absolute top-8 left-8 text-neutral-600 flex items-center gap-2 font-mono text-sm">
        <Terminal size={16} /> MA_SANTE_EN_CHAINE.terminal
      </div>
      
      {/* Background Decor */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.05),transparent_50%)] -z-0"></div>
      
      <LoginForm />
    </div>
  );
}
