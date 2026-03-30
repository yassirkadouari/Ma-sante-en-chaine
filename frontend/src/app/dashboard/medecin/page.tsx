"use client";

import { useEffect, useState } from "react";
import { FilePlus2, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/api";

const TEST_CASE_PAYLOAD = {
  dossierMedical: {
    patient: {
      nom: "Patient Test",
      age: 41,
      sexe: "M"
    },
    diagnostic: "Appendicite aigue",
    antecedents: ["Allergie penicilline"],
    observations: "Douleur FID, fievre 38.9, CRP elevee"
  },
  interventions: [
    {
      type: "CONSULTATION_MEDECIN",
      praticien: "Dr. Test",
      date: "2026-03-29",
      cout: 350
    },
    {
      type: "INTERVENTION_HOPITAL",
      service: "Urgences CHU",
      date: "2026-03-30",
      cout: 1200
    },
    {
      type: "OPERATION",
      acte: "Appendicectomie",
      etablissement: "CHU Hassan II",
      date: "2026-03-30",
      cout: 8500
    }
  ],
  reimbursements: [
    {
      organisme: "CNSS",
      interventionType: "CONSULTATION_MEDECIN",
      montantDemande: 350,
      montantValide: 280,
      statut: "PENDING"
    },
    {
      organisme: "CNSS",
      interventionType: "INTERVENTION_HOPITAL",
      montantDemande: 1200,
      montantValide: 960,
      statut: "PENDING"
    },
    {
      organisme: "CNSS",
      interventionType: "OPERATION",
      montantDemande: 8500,
      montantValide: 6800,
      statut: "PENDING"
    }
  ],
  medications: [
    { name: "Paracetamol", dose: "1g", frequency: "2/day", durationDays: 5 },
    { name: "Omeprazole", dose: "20mg", frequency: "1/day", durationDays: 7 }
  ]
};

type PrescriptionSummary = {
  recordId: string;
  patientWallet: string;
  pharmacyWallet: string | null;
  version: number;
  status: string;
};

export default function MedecinDashboard() {
  const [patientWallet, setPatientWallet] = useState("");
  const [pharmacyWallet, setPharmacyWallet] = useState("");
  const [payload, setPayload] = useState(JSON.stringify(TEST_CASE_PAYLOAD, null, 2));
  const [recordIdToRevise, setRecordIdToRevise] = useState("");
  const [items, setItems] = useState<PrescriptionSummary[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const response = await apiRequest<{ items: PrescriptionSummary[] }>({ path: "/prescriptions" });
    setItems(response.items);
  };

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
  }, []);

  const createPrescription = async () => {
    try {
      setBusy(true);
      setStatus(null);
      const data = JSON.parse(payload);

      const response = await apiRequest<{ recordId: string }>({
        method: "POST",
        path: "/prescriptions",
        signed: true,
        body: {
          patientWallet,
          pharmacyWallet: pharmacyWallet || undefined,
          data
        }
      });

      setStatus(`Prescription created: ${response.recordId}`);
      await refresh();
    } catch (error: any) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  const revisePrescription = async () => {
    try {
      setBusy(true);
      setStatus(null);
      const data = JSON.parse(payload);

      const response = await apiRequest<{ recordId: string; previousRecordId: string }>({
        method: "POST",
        path: `/prescriptions/${recordIdToRevise}/revise`,
        signed: true,
        body: {
          pharmacyWallet: pharmacyWallet || undefined,
          data,
          reason: "Medication adjusted"
        }
      });

      setStatus(`New version ${response.recordId} created. Previous ${response.previousRecordId} cancelled.`);
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
          <h1 className="text-2xl font-bold text-white">PORTAIL_MEDECIN</h1>
          <p className="text-emerald-500 text-sm">Immutable prescriptions with signed requests + on-chain hash anchoring.</p>
        </div>
        <div className="px-4 py-2 bg-emerald-600/10 border border-emerald-600/50 text-emerald-400 font-bold rounded flex items-center gap-2">
          <ShieldCheck size={20} />
          SECURE_MODE
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-4">
        <h2 className="font-bold text-xl text-white flex items-center gap-2">
          <FilePlus2 size={20} className="text-emerald-500" /> Create / Revise Prescription
        </h2>

        <input
          value={patientWallet}
          onChange={(event) => setPatientWallet(event.target.value)}
          placeholder="Patient wallet (0x...)"
          className="w-full p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-200"
        />

        <input
          value={pharmacyWallet}
          onChange={(event) => setPharmacyWallet(event.target.value)}
          placeholder="Pharmacy wallet (optional 0x...)"
          className="w-full p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-200"
        />

        <textarea
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          className="w-full min-h-44 p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-200"
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setPayload(JSON.stringify(TEST_CASE_PAYLOAD, null, 2))}
            className="px-4 py-2 bg-neutral-700 text-white rounded"
          >
            LOAD_TEST_CASE
          </button>

          <button disabled={busy} onClick={createPrescription} className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50">
            CREATE_PRESCRIPTION
          </button>

          <input
            value={recordIdToRevise}
            onChange={(event) => setRecordIdToRevise(event.target.value)}
            placeholder="Record ID to revise"
            className="flex-1 min-w-64 p-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-200"
          />

          <button disabled={busy || !recordIdToRevise} onClick={revisePrescription} className="px-4 py-2 bg-amber-600 text-white rounded disabled:opacity-50">
            REVISE_VERSION
          </button>
        </div>

        {status ? <p className="text-xs text-neutral-300">{status}</p> : null}
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 text-white">Doctor Ledger</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500">
                <th className="p-2">RECORD_ID</th>
                <th className="p-2">PATIENT</th>
                <th className="p-2">PHARMACY</th>
                <th className="p-2">VERSION</th>
                <th className="p-2">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.recordId} className="border-b border-neutral-800/50">
                  <td className="p-2 text-emerald-400">{item.recordId}</td>
                  <td className="p-2 text-neutral-300">{item.patientWallet}</td>
                  <td className="p-2 text-neutral-300">{item.pharmacyWallet || "-"}</td>
                  <td className="p-2 text-neutral-300">{item.version}</td>
                  <td className="p-2 text-neutral-300">{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
