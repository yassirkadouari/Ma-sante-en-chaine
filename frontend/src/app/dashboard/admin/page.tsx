"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, UserCog, UserMinus } from "lucide-react";
import { apiRequest } from "@/lib/api";

type WalletRoleItem = {
  walletAddress: string;
  roles: string[];
  identity?: {
    role: string;
    fullName: string;
    nickname: string;
    dateOfBirth: string;
    cabinetName?: string | null;
    institutionName?: string | null;
    departmentName?: string | null;
    doctorApprovalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  } | null;
};

const ROLE_OPTIONS = ["ADMIN", "PATIENT", "MEDECIN", "PHARMACIE", "HOPITAL", "LABO", "ASSURANCE"];
const DETAILS_ROLES = new Set(["ASSURANCE", "HOPITAL", "PHARMACIE", "MEDECIN"]);

export default function AdminDashboard() {
  const [items, setItems] = useState<WalletRoleItem[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [role, setRole] = useState("PATIENT");
  const [institutionName, setInstitutionName] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const response = await apiRequest<{ items: WalletRoleItem[] }>({ path: "/admin/users" });
    setItems(response.items);
  };

  useEffect(() => {
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
          role
        }
      });
      setStatus(`Role ${role} assigned to ${walletAddress}`);
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
      setStatus(`Role ${role} revoked from ${walletAddress}`);
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
      setStatus(`Approbation metier enregistree pour ${walletAddress} (${role}) avec institut/entreprise et departement`);
      await refresh();
    } catch (error: any) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  const setDoctorApproval = async (approved: boolean) => {
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "PATCH",
        path: "/admin/users/doctor-approval",
        signed: true,
        body: {
          walletAddress,
          approved
        }
      });
      setStatus(`${walletAddress} -> ${approved ? "MEDECIN_APPROUVE" : "MEDECIN_REJETE"}`);
      await refresh();
    } catch (error: any) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 font-mono">
      <div className="flex justify-between items-center bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <div>
          <h1 className="text-2xl font-bold text-white">ADMIN_DASHBOARD</h1>
          <p className="text-red-500 text-sm">Wallet role governance and access control registry.</p>
        </div>
        <div className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 font-bold rounded flex items-center gap-2 text-sm">
          <ShieldCheck size={18} /> ADMIN_ONLY
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-4">
        <h2 className="font-bold text-xl text-white flex items-center gap-2">
          <UserCog size={20} className="text-red-400" /> Assign / Revoke Role
        </h2>

        <input
          type="text"
          value={walletAddress}
          onChange={(event) => setWalletAddress(event.target.value)}
          placeholder="Wallet address (Polkadot SS58)"
          className="w-full p-3 bg-neutral-950 border border-neutral-700 text-neutral-300 rounded"
        />

        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="w-full p-3 bg-neutral-950 border border-neutral-700 text-neutral-300 rounded"
        >
          {ROLE_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy || !walletAddress.trim()}
            onClick={assignRole}
            className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
          >
            ASSIGN_ROLE
          </button>
          <button
            type="button"
            disabled={busy || !walletAddress.trim()}
            onClick={revokeRole}
            className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50 flex items-center gap-2"
          >
            <UserMinus size={16} /> REVOKE_ROLE
          </button>
        </div>

        {DETAILS_ROLES.has(role) ? (
          <>
            <input
              type="text"
              value={institutionName}
              onChange={(event) => setInstitutionName(event.target.value)}
              placeholder="Institut/Entreprise/Hopital/Pharmacie (obligatoire sauf MEDECIN)"
              className="w-full p-3 bg-neutral-950 border border-neutral-700 text-neutral-300 rounded"
            />
            <input
              type="text"
              value={departmentName}
              onChange={(event) => setDepartmentName(event.target.value)}
              placeholder="Departement (obligatoire)"
              className="w-full p-3 bg-neutral-950 border border-neutral-700 text-neutral-300 rounded"
            />
            <button
              type="button"
              disabled={busy || !walletAddress.trim() || !departmentName.trim() || (role !== "MEDECIN" && !institutionName.trim())}
              onClick={updateRoleDetails}
              className="px-4 py-2 bg-sky-600 text-white rounded disabled:opacity-50"
            >
              APPROVE_ROLE_DETAILS
            </button>
          </>
        ) : null}

        {role === "MEDECIN" ? (
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy || !walletAddress.trim()}
              onClick={() => setDoctorApproval(true)}
              className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
            >
              APPROVE_MEDECIN
            </button>
            <button
              type="button"
              disabled={busy || !walletAddress.trim()}
              onClick={() => setDoctorApproval(false)}
              className="px-4 py-2 bg-orange-600 text-white rounded disabled:opacity-50"
            >
              REJECT_MEDECIN
            </button>
          </div>
        ) : null}

        {status ? <p className="text-xs text-neutral-300">{status}</p> : null}
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 text-white">Wallet Role Registry</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500">
                <th className="p-2">WALLET</th>
                <th className="p-2">ROLES</th>
                <th className="p-2">IDENTITY</th>
                <th className="p-2">APPROVAL</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="p-2 text-neutral-500" colSpan={4}>
                    No wallet roles assigned yet.
                  </td>
                </tr>
              ) : null}
              {items.map((item) => (
                <tr key={item.walletAddress} className="border-b border-neutral-800/50">
                  <td className="p-2 text-red-400 break-all">{item.walletAddress}</td>
                  <td className="p-2 text-neutral-300">{item.roles.join(", ")}</td>
                  <td className="p-2 text-neutral-300">
                    {item.identity ? (
                      <div className="space-y-1">
                        <div>{item.identity.fullName} ({item.identity.nickname})</div>
                        <div className="text-xs text-neutral-500">DOB: {item.identity.dateOfBirth}</div>
                        {item.identity.role ? (
                          <div className="text-xs text-neutral-500">ROLE_PROFILE: {item.identity.role}</div>
                        ) : null}
                        {item.identity.cabinetName ? (
                          <div className="text-xs text-neutral-500">CABINET: {item.identity.cabinetName}</div>
                        ) : null}
                        {item.identity.institutionName ? (
                          <div className="text-xs text-neutral-500">INSTITUT: {item.identity.institutionName}</div>
                        ) : null}
                        {item.identity.departmentName ? (
                          <div className="text-xs text-neutral-500">DEPARTEMENT: {item.identity.departmentName}</div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-neutral-500 text-xs">Identity not registered yet</span>
                    )}
                  </td>
                  <td className="p-2 text-neutral-300">
                    {item.identity?.role === "MEDECIN"
                      ? item.identity.doctorApprovalStatus || "PENDING"
                      : "N/A"}
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
