"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, UserCog, UserMinus, CheckCircle, XCircle, MapPin, Globe } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { loadSession } from "@/lib/session";

type WalletRoleItem = {
  walletAddress: string;
  roles: string[];
  identity?: {
    role: string;
    fullName: string;
    nickname: string;
    dateOfBirth: string;
    region: string | null;
    isGlobalAdmin: boolean;
    cabinetName?: string | null;
    institutionName?: string | null;
    departmentName?: string | null;
    approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  } | null;
};

const ROLE_OPTIONS = ["SUB_ADMIN", "PATIENT", "MEDECIN", "PHARMACIE", "HOPITAL", "LABO", "ASSURANCE"];
const DETAILS_ROLES = new Set(["ASSURANCE", "HOPITAL", "PHARMACIE", "MEDECIN"]);

const REGIONS = [
  "TANGER-TETOUAN-AL HOCEIMA", "L'ORIENTAL", "FES-MEKNES", "RABAT-SALE-KENITRA",
  "BENI MELLAL-KHENIFRA", "CASABLANCA-SETTAT", "MARRAKECH-SAFI", "DRAA-TAFILALET",
  "SOUSS-MASSA", "GUELMIM-OUED NOUN", "LAAYOUNE-SAKIA EL HAMRA", "EDDAKHLA-OUED EDDAHAB"
];

export default function AdminDashboard() {
  const [items, setItems] = useState<WalletRoleItem[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [role, setRole] = useState("PATIENT");
  const [region, setRegion] = useState(REGIONS[0]);
  const [institutionName, setInstitutionName] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const refresh = async () => {
    const response = await apiRequest<{ items: WalletRoleItem[] }>({ path: "/admin/users" });
    setItems(response.items);
  };

  useEffect(() => {
    const session = loadSession();
    setCurrentUser(session?.identity);
    refresh().catch((error) => setStatus(error.message));
  }, []);

  const assignRole = async () => {
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "POST",
        path: "/admin/users",
        signed: true,
        body: {
          walletAddress,
          role,
          region,
          institutionName: institutionName || undefined,
          departmentName: departmentName || undefined
        }
      });
      setStatus(`Rôle ${role} assigné à ${walletAddress} (Région: ${region})`);
      await refresh();
    } catch (error: any) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  const revokeRole = async () => {
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "DELETE",
        path: "/admin/users",
        signed: true,
        body: {
          walletAddress,
          role
        }
      });
      setStatus(`Rôle ${role} révoqué de ${walletAddress}`);
      await refresh();
    } catch (error: any) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateRoleDetails = async () => {
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "PATCH",
        path: "/admin/users/institution",
        signed: true,
        body: {
          walletAddress,
          role,
          institutionName: institutionName || undefined,
          departmentName
        }
      });
      setStatus(`Détails mis à jour pour ${walletAddress}`);
      await refresh();
    } catch (error: any) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  const setUserApproval = async (targetWallet: string, approved: boolean) => {
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "PATCH",
        path: "/admin/users/approval",
        signed: true,
        body: {
          walletAddress: targetWallet,
          approved
        }
      });
      setStatus(`${targetWallet} -> ${approved ? "APPROUVÉ" : "REJETÉ"}`);
      await refresh();
    } catch (error: any) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 font-mono">
      <div className="flex justify-between items-center bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20">
            <ShieldCheck className="text-red-500" size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tighter">
              {currentUser?.isGlobalAdmin ? "GLOBAL_ADMIN_CONSOLE" : "REGIONAL_ADMIN_CONSOLE"}
            </h1>
            <p className="text-neutral-500 text-xs flex items-center gap-1 uppercase">
              <MapPin size={12} className="text-red-400" /> 
              Secteur: {currentUser?.isGlobalAdmin ? "Makhzen Global" : currentUser?.region || "Non défini"}
            </p>
          </div>
        </div>
        <div className="px-4 py-2 bg-neutral-950 border border-neutral-800 text-[10px] text-neutral-500 rounded uppercase tracking-widest">
          Auth_Level: {currentUser?.isGlobalAdmin ? "Lvl_0_Global" : "Lvl_1_Regional"}
        </div>
      </div>

      {currentUser?.isGlobalAdmin && (
        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-4">
          <h2 className="font-bold text-lg text-white flex items-center gap-2 uppercase">
            <UserCog size={18} className="text-red-400" /> Assignation de Rôles
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input
              type="text"
              value={walletAddress}
              onChange={(event) => setWalletAddress(event.target.value)}
              placeholder="Adresse Wallet (Polkadot / Web3)"
              className="w-full p-3 bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-lg focus:border-red-500/50 outline-none text-sm"
            />

            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="w-full p-3 bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-lg focus:border-red-500/50 outline-none text-sm"
            >
              {ROLE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className="w-full p-3 bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-lg focus:border-red-500/50 outline-none text-sm font-black"
            >
              {REGIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          {(DETAILS_ROLES.has(role) || role === "LABO") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
               <input
                type="text"
                value={institutionName}
                onChange={(event) => setInstitutionName(event.target.value)}
                placeholder="Nom de l'Institution (Hôpital, Labo, etc.)"
                className="w-full p-3 bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-lg focus:border-red-500/50 outline-none text-sm"
              />
              <input
                type="text"
                value={departmentName}
                onChange={(event) => setDepartmentName(event.target.value)}
                placeholder="Département / Service (ex: Biochimie, Urgences)"
                className="w-full p-3 bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-lg focus:border-red-500/50 outline-none text-sm"
              />
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy || !walletAddress.trim()}
              onClick={assignRole}
              className="px-6 py-2 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-600 hover:text-white transition-all text-xs font-bold disabled:opacity-50"
            >
              [ ASSIGNER_ROLE ]
            </button>
            <button
              type="button"
              disabled={busy || !walletAddress.trim()}
              onClick={revokeRole}
              className="px-6 py-2 bg-red-600/20 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-600 hover:text-white transition-all text-xs font-bold disabled:opacity-50 flex items-center gap-2"
            >
              <UserMinus size={14} /> [ RÉVOQUER ]
            </button>
          </div>

          {DETAILS_ROLES.has(role) && (
            <div className="space-y-4 pt-4 border-t border-neutral-800">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  value={institutionName}
                  onChange={(event) => setInstitutionName(event.target.value)}
                  placeholder="Nom de l'Institution (Hôpital, Pharmacie...)"
                  className="w-full p-3 bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-lg focus:border-red-500/50 outline-none text-sm"
                />
                <input
                  type="text"
                  value={departmentName}
                  onChange={(event) => setDepartmentName(event.target.value)}
                  placeholder="Département / Service"
                  className="w-full p-3 bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-lg focus:border-red-500/50 outline-none text-sm"
                />
              </div>
              <button
                type="button"
                disabled={busy || !walletAddress.trim() || !departmentName.trim()}
                onClick={updateRoleDetails}
                className="px-6 py-2 bg-sky-600/20 border border-sky-500/30 text-sky-400 rounded-lg hover:bg-sky-600 hover:text-white transition-all text-xs font-bold disabled:opacity-50"
              >
                [ VALIDER_DETAILS_INSTITUTION ]
              </button>
            </div>
          )}

          {status && <p className="text-[10px] text-amber-500 px-1 italic">&gt; {status}</p>}
        </div>
      )}

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-lg mb-4 text-white flex items-center gap-2 uppercase tracking-widest">
           <Globe size={18} className="text-neutral-500" /> Registre des Utilisateurs
           <span className="text-[10px] text-neutral-500 ml-auto lowercase font-normal italic">
             {currentUser?.isGlobalAdmin ? "Affichage de tous les secteurs" : `Secteur: ${currentUser?.region}`}
           </span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500 font-bold uppercase tracking-tighter">
                <th className="p-3">Wallet</th>
                <th className="p-3">Rôles</th>
                <th className="p-3">Région</th>
                <th className="p-3">Identité & Détails</th>
                <th className="p-3 text-right">Actions_Vérification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/50">
              {items.length === 0 ? (
                <tr>
                  <td className="p-8 text-neutral-600 text-center italic font-mono" colSpan={5}>
                    Aucun utilisateur actif détecté dans ce secteur.
                  </td>
                </tr>
              ) : null}
              {items.map((item) => (
                <tr key={item.walletAddress} className="group hover:bg-neutral-800/20 transition-colors">
                  <td className="p-3 font-mono text-red-400/80 break-all w-1/4">
                    {item.walletAddress.slice(0, 8)}...{item.walletAddress.slice(-8)}
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-[10px] text-neutral-400">
                      {item.roles.join(" | ")}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1 text-neutral-400">
                       <MapPin size={10} className="text-neutral-600" />
                       {item.identity?.region || "Global"}
                    </div>
                  </td>
                  <td className="p-3">
                    {item.identity ? (
                      <div className="space-y-1">
                        <div className="text-white font-bold">{item.identity.fullName}</div>
                        <div className="text-[10px] text-neutral-500 flex flex-wrap gap-x-3">
                          <span>DN: {item.identity.dateOfBirth}</span>
                          {item.identity.cabinetName && (
                            <span className="text-emerald-500/70">CAB: {item.identity.cabinetName}</span>
                          )}
                        </div>
                        {(item.identity.institutionName || item.identity.departmentName) && (
                          <div className="text-[10px] text-sky-500/70">
                            {item.identity.institutionName} | {item.identity.departmentName}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-neutral-600 italic">Anonyme</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {item.identity?.role !== "ADMIN" && item.identity?.role !== "PATIENT" ? (
                      <div className="flex justify-end gap-2">
                        {item.identity?.approvalStatus === "APPROVED" ? (
                          <div className="flex items-center gap-1 text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 text-[10px] font-bold">
                            <CheckCircle size={10} /> ACTIF
                          </div>
                        ) : item.identity?.approvalStatus === "REJECTED" ? (
                          <div className="flex items-center gap-1 text-red-500 bg-red-500/10 px-2 py-1 rounded border border-red-500/20 text-[10px] font-bold">
                            <XCircle size={10} /> RÉVOQUÉ
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={() => setUserApproval(item.walletAddress, true)}
                              disabled={busy}
                              className="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-900/20"
                            >
                              APPROUVER
                            </button>
                            <button
                              onClick={() => setUserApproval(item.walletAddress, false)}
                              disabled={busy}
                              className="px-2 py-1 bg-neutral-800 text-neutral-400 rounded text-[10px] font-bold hover:bg-red-600 hover:text-white transition-all shadow-lg"
                            >
                              REJETER
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-neutral-700 italic">Permanent</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
