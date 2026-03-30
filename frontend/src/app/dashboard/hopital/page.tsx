"use client";

import { useState } from "react";
import { Activity, Link2 } from "lucide-react";
import { apiRequest } from "@/lib/api";

export default function HopitalDashboard() {
  const [profilePatientWallet, setProfilePatientWallet] = useState("");
  const [bloodType, setBloodType] = useState("");
  const [age, setAge] = useState("");
  const [diseases, setDiseases] = useState("");
  const [patientWallet, setPatientWallet] = useState("");
  const [operationName, setOperationName] = useState("");
  const [department, setDepartment] = useState("");
  const [amountClaim, setAmountClaim] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linkOperation = async () => {
    try {
      setBusy(true);
      setStatus(null);
      const response = await apiRequest<{ eventId: string; claimId?: string | null }>({
        method: "POST",
        path: "/medical-events/operation",
        signed: true,
        body: {
          patientWallet,
          operationName,
          department,
          amountClaim: Number(amountClaim || 0),
          notes: notes || undefined
        }
      });

      setStatus(`Operation linked to patient wallet. Event: ${response.eventId} | Claim: ${response.claimId || "auto-not-created"}`);
    } catch (error: any) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  const createMedicalProfile = async () => {
    try {
      setBusy(true);
      setStatus(null);
      const response = await apiRequest<{ eventId: string }>({
        method: "POST",
        path: "/medical-events/profile",
        signed: true,
        body: {
          patientWallet: profilePatientWallet,
          bloodType,
          age: Number(age),
          diseases: diseases
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        }
      });

      setStatus(`Medical profile created/updated for patient wallet. Event: ${response.eventId}`);
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
          <h1 className="text-2xl font-bold text-white">NOEUD_HOPITAL</h1>
          <p className="text-sky-500 text-sm">Lier une operation/intervention au wallet patient et ecrire dans le dossier medical.</p>
        </div>
        <div className="px-4 py-2 bg-sky-500/10 border border-sky-500/30 text-sky-400 font-bold rounded flex items-center gap-2 text-sm">
          <Activity size={18} /> OPERATION_LINKER
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-4">
        <h2 className="font-bold text-xl text-white">Create Patient Medical Dossier</h2>

        <input
          value={profilePatientWallet}
          onChange={(event) => setProfilePatientWallet(event.target.value)}
          placeholder="Patient wallet"
          className="w-full p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            value={bloodType}
            onChange={(event) => setBloodType(event.target.value)}
            placeholder="Blood type"
            className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
          />
          <input
            value={age}
            onChange={(event) => setAge(event.target.value)}
            placeholder="Age"
            className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
          />
          <input
            value={diseases}
            onChange={(event) => setDiseases(event.target.value)}
            placeholder="Diseases (comma separated)"
            className="p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
          />
        </div>

        <button
          type="button"
          disabled={busy || !profilePatientWallet || !bloodType || !age}
          onClick={createMedicalProfile}
          className="px-4 py-2 bg-cyan-600 text-white rounded disabled:opacity-50"
        >
          CREATE_MEDICAL_DOSSIER
        </button>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-4">
        <h2 className="font-bold text-xl text-white flex items-center gap-2">
          <Link2 size={18} className="text-sky-400" /> Link Operation To Patient Wallet
        </h2>

        <input
          value={patientWallet}
          onChange={(event) => setPatientWallet(event.target.value)}
          placeholder="Patient wallet"
          className="w-full p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
        />

        <input
          value={operationName}
          onChange={(event) => setOperationName(event.target.value)}
          placeholder="Operation name"
          className="w-full p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
        />

        <input
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
          placeholder="Department"
          className="w-full p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
        />

        <input
          value={amountClaim}
          onChange={(event) => setAmountClaim(event.target.value)}
          placeholder="Claim amount (DH)"
          className="w-full p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
        />

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Notes"
          className="w-full min-h-28 p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300"
        />

        <button
          type="button"
          disabled={busy || !patientWallet || !operationName || !department || !amountClaim}
          onClick={linkOperation}
          className="px-4 py-2 bg-sky-600 text-white rounded disabled:opacity-50"
        >
          LINK_OPERATION
        </button>

        {status ? <p className="text-xs text-neutral-300">{status}</p> : null}
      </div>
    </div>
  );
}
