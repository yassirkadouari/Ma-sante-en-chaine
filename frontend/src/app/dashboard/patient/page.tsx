"use client";

import { useEffect, useState } from "react";
import { FileText, HeartPulse, Wallet } from "lucide-react";
import { apiRequest } from "@/lib/api";

type PrescriptionSummary = {
  recordId: string;
  status: string;
  doctorWallet: string;
  version: number;
};

type MedicalMine = {
  profile: {
    bloodType?: string | null;
    age?: number | null;
    diseases?: string[];
  } | null;
  visits: Array<{
    eventId: string;
    occurredAt: string;
    data: {
      diagnosis?: string;
      notes?: string;
      amountClaim?: number;
    };
  }>;
  pastOperations: Array<{
    eventId: string;
    occurredAt: string;
    data: {
      operationName?: string;
      department?: string;
      notes?: string;
      amountClaim?: number;
    };
  }>;
  currentMedications: Array<{
    recordId: string;
    name?: string;
    dose?: string;
    frequency?: string;
    durationDays?: number;
  }>;
  events: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
    actorRole: string;
    actorWallet: string;
    hash: string;
  }>;
};

type ClaimItem = {
  claimId: string;
  sourceType: string;
  sourceId: string;
  amountRequested: number;
  amountApproved?: number;
  status: string;
};

export default function PatientDashboard() {
  const [items, setItems] = useState<PrescriptionSummary[]>([]);
  const [medical, setMedical] = useState<MedicalMine | null>(null);
  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [claimRecordId, setClaimRecordId] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimReason, setClaimReason] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [prescriptions, mine, claimRows] = await Promise.all([
      apiRequest<{ items: PrescriptionSummary[] }>({ path: "/prescriptions" }),
      apiRequest<MedicalMine>({ path: "/medical-events/mine" }),
      apiRequest<{ items: ClaimItem[] }>({ path: "/claims" })
    ]);
    setItems(prescriptions.items || []);
    setMedical(mine);
    setClaims(claimRows.items || []);
  };

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
  }, []);

  const createClaim = async () => {
    try {
      setBusy(true);
      setStatus(null);
      const response = await apiRequest<{ claimId: string }>({
        method: "POST",
        path: `/claims/prescriptions/${claimRecordId}`,
        signed: true,
        body: {
          amountRequested: claimAmount ? Number(claimAmount) : undefined,
          reason: claimReason || undefined
        }
      });
      setStatus(`Claim created: ${response.claimId}`);
      await refresh();
    } catch (error: any) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 font-mono">
      <h1 className="text-3xl font-bold text-white tracking-tight">PORTAIL_PATIENT</h1>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-4">
        <h2 className="font-bold text-xl text-white flex items-center gap-2">
          <HeartPulse className="text-blue-500" /> Patient Medical Profile
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300">
            BLOOD TYPE: {medical?.profile?.bloodType || "Not set by hospital"}
          </div>
          <div className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300">
            AGE: {medical?.profile?.age ?? "Not set by hospital"}
          </div>
          <div className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300">
            DISEASES: {(medical?.profile?.diseases || []).join(", ") || "None / not set"}
          </div>
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-4">
        <h2 className="font-bold text-xl text-white flex items-center gap-2">
          <Wallet className="text-emerald-500" /> Claim Insurance For Used Ordonnance
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            value={claimRecordId}
            onChange={(event) => setClaimRecordId(event.target.value)}
            placeholder="Delivered prescription recordId"
            className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
          />
          <input
            value={claimAmount}
            onChange={(event) => setClaimAmount(event.target.value)}
            placeholder="Amount (optional)"
            className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
          />
          <input
            value={claimReason}
            onChange={(event) => setClaimReason(event.target.value)}
            placeholder="Reason (optional)"
            className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
          />
        </div>
        <button
          type="button"
          disabled={busy || !claimRecordId}
          onClick={createClaim}
          className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
        >
          CREATE_CLAIM
        </button>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 text-white flex items-center gap-2">
          <FileText className="text-blue-500" /> Current Prescriptions
        </h2>
        <ul className="space-y-2 text-sm">
          {items.length === 0 ? <li className="text-neutral-500">No prescriptions.</li> : null}
          {items.map((item) => (
            <li key={item.recordId} className="border border-neutral-800 rounded p-3 flex justify-between items-center">
              <span>{item.recordId} | v{item.version} | doctor {item.doctorWallet}</span>
              <span className="text-neutral-400">{item.status}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
          <h2 className="font-bold text-xl mb-4 text-white">Medical Visits</h2>
          <ul className="space-y-2 text-sm">
            {(medical?.visits || []).map((item) => (
              <li key={item.eventId} className="border border-neutral-800 rounded p-3">
                {new Date(item.occurredAt).toLocaleDateString()} | {item.data.diagnosis || "-"}
              </li>
            ))}
            {(!medical?.visits || medical.visits.length === 0) ? <li className="text-neutral-500">No visits yet.</li> : null}
          </ul>
        </div>

        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
          <h2 className="font-bold text-xl mb-4 text-white">Past Operations</h2>
          <ul className="space-y-2 text-sm">
            {(medical?.pastOperations || []).map((item) => (
              <li key={item.eventId} className="border border-neutral-800 rounded p-3">
                {new Date(item.occurredAt).toLocaleDateString()} | {item.data.operationName || "-"} | {item.data.department || "-"}
              </li>
            ))}
            {(!medical?.pastOperations || medical.pastOperations.length === 0) ? <li className="text-neutral-500">No operations yet.</li> : null}
          </ul>
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 text-white">Current Medications</h2>
        <ul className="space-y-2 text-sm">
          {(medical?.currentMedications || []).map((item, idx) => (
            <li key={`${item.recordId}-${idx}`} className="border border-neutral-800 rounded p-3">
              {item.name || "Medication"} | {item.dose || "-"} | {item.frequency || "-"} | {item.durationDays || "-"} days
            </li>
          ))}
          {(!medical?.currentMedications || medical.currentMedications.length === 0) ? (
            <li className="text-neutral-500">No medications found.</li>
          ) : null}
        </ul>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 text-white">My Claims</h2>
        <ul className="space-y-2 text-sm">
          {claims.length === 0 ? <li className="text-neutral-500">No claims yet.</li> : null}
          {claims.map((item) => (
            <li key={item.claimId} className="border border-neutral-800 rounded p-3">
              {item.claimId} | {item.sourceType} | Requested {item.amountRequested} DH | Approved {Number(item.amountApproved || 0)} DH | {item.status}
            </li>
          ))}
        </ul>
      </div>

      {status ? <p className="text-xs text-neutral-300">{status}</p> : null}
    </div>
  );
}
