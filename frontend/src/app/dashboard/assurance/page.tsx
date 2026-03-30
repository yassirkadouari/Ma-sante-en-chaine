"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/api";

type ClaimItem = {
  claimId: string;
  sourceType: "PRESCRIPTION" | "VISIT" | "OPERATION";
  sourceId: string;
  patientWallet: string;
  providerWallet?: string;
  providerRole?: string;
  amountRequested: number;
  amountApproved?: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason?: string;
  verification?: {
    method?: string;
    anchorValid?: boolean;
    anchorStatus?: string;
  };
  createdAt?: string;
};

export default function AssuranceDashboard() {
  const [items, setItems] = useState<ClaimItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [decisionReason, setDecisionReason] = useState("");
  const [approveAmount, setApproveAmount] = useState("");
  const [targetClaimId, setTargetClaimId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const response = await apiRequest<{ items: ClaimItem[] }>({ path: `/claims?status=${statusFilter}` });
    setItems(response.items || []);
  };

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
  }, [statusFilter]);

  const reviewClaim = async (claimId: string, decision: "APPROVED" | "REJECTED") => {
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "PATCH",
        path: `/claims/${claimId}/review`,
        signed: true,
        body: {
          decision,
          amountApproved: decision === "APPROVED" ? Number(approveAmount || 0) || undefined : 0,
          reason: decisionReason || undefined
        }
      });
      setStatus(`Claim ${claimId} ${decision}`);
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
          <h1 className="text-2xl font-bold text-white">NOEUD_ASSURANCE</h1>
          <p className="text-amber-500 text-sm">Validation/refus des claims (ordonnances utilisees + visites + operations).</p>
        </div>
        <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold rounded flex items-center gap-2 text-sm">
          <ShieldCheck size={18} /> CLAIM_ENGINE
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
          >
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="ALL">ALL</option>
          </select>
          <input
            value={targetClaimId}
            onChange={(event) => setTargetClaimId(event.target.value)}
            placeholder="Claim ID to review"
            className="flex-1 p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
          />
          <input
            value={approveAmount}
            onChange={(event) => setApproveAmount(event.target.value)}
            placeholder="Approved amount (optional)"
            className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
          />
        </div>

        <textarea
          value={decisionReason}
          onChange={(event) => setDecisionReason(event.target.value)}
          placeholder="Decision reason"
          className="w-full min-h-24 p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
        />

        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy || !targetClaimId}
            onClick={() => reviewClaim(targetClaimId, "APPROVED")}
            className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50 flex items-center gap-2"
          >
            <CheckCircle2 size={16} /> APPROVE_CLAIM
          </button>
          <button
            type="button"
            disabled={busy || !targetClaimId}
            onClick={() => reviewClaim(targetClaimId, "REJECTED")}
            className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50 flex items-center gap-2"
          >
            <XCircle size={16} /> REJECT_CLAIM
          </button>
        </div>

        {status ? <p className="text-xs text-neutral-300">{status}</p> : null}
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 text-white">Claims Queue</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500">
                <th className="p-2">CLAIM_ID</th>
                <th className="p-2">TYPE</th>
                <th className="p-2">PATIENT</th>
                <th className="p-2">AMOUNT</th>
                <th className="p-2">STATUS</th>
                <th className="p-2">VERIFICATION</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="p-2 text-neutral-500" colSpan={6}>
                    No claims found.
                  </td>
                </tr>
              ) : null}
              {items.map((item) => (
                <tr key={item.claimId} className="border-b border-neutral-800/50">
                  <td className="p-2 text-amber-400">{item.claimId}</td>
                  <td className="p-2 text-neutral-300">{item.sourceType}</td>
                  <td className="p-2 text-neutral-300 break-all">{item.patientWallet}</td>
                  <td className="p-2 text-neutral-300">{item.amountRequested} DH</td>
                  <td className="p-2 text-neutral-300">{item.status}</td>
                  <td className="p-2 text-neutral-300">
                    {item.verification?.method || "-"} / {item.verification?.anchorStatus || "-"}
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
