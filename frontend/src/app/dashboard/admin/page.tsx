"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, UserCog, UserMinus } from "lucide-react";
import { apiRequest } from "@/lib/api";

type WalletRoleItem = {
  walletAddress: string;
  roles: string[];
};

const ROLE_OPTIONS = ["ADMIN", "PATIENT", "MEDECIN", "PHARMACIE", "HOPITAL", "LABO", "ASSURANCE"];

export default function AdminDashboard() {
  const [items, setItems] = useState<WalletRoleItem[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [role, setRole] = useState("PATIENT");
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
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="p-2 text-neutral-500" colSpan={2}>
                    No wallet roles assigned yet.
                  </td>
                </tr>
              ) : null}
              {items.map((item) => (
                <tr key={item.walletAddress} className="border-b border-neutral-800/50">
                  <td className="p-2 text-red-400 break-all">{item.walletAddress}</td>
                  <td className="p-2 text-neutral-300">{item.roles.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
