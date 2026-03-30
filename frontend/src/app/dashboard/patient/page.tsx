"use client";

import { useEffect, useState } from "react";
import { FileText, CheckCircle, Fingerprint } from "lucide-react";
import { apiRequest } from "@/lib/api";

type PrescriptionSummary = {
  recordId: string;
  status: string;
  doctorWallet: string;
  version: number;
  createdAt?: string;
};

type PrescriptionDetails = {
  recordId: string;
  status: string;
  data: {
    dossierMedical?: {
      diagnostic?: string;
      observations?: string;
    };
    interventions?: Array<{
      type?: string;
      date?: string;
      cout?: number;
      acte?: string;
      service?: string;
    }>;
    reimbursements?: Array<{
      organisme?: string;
      interventionType?: string;
      montantDemande?: number;
      montantValide?: number;
      statut?: string;
    }>;
    medications?: Array<{ name?: string; dose?: string; frequency?: string; durationDays?: number }>;
    [key: string]: unknown;
  };
  issuedAt?: string;
};

export default function PatientDashboard() {
  const [items, setItems] = useState<PrescriptionSummary[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [details, setDetails] = useState<PrescriptionDetails | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const response = await apiRequest<{ items: PrescriptionSummary[] }>({ path: "/prescriptions" });
    setItems(response.items);
  };

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
  }, []);

  const loadMedicalRecord = async (id: string) => {
    try {
      setStatus(null);
      const response = await apiRequest<PrescriptionDetails>({
        path: `/prescriptions/${id}`,
        signed: true
      });
      setSelectedRecordId(id);
      setDetails(response);
      setStatus("Dossier medical verifie (hash blockchain + decrypt). ");
    } catch (error: any) {
      setStatus(error.message);
      setDetails(null);
    }
  };

  const deliveredCount = items.filter((item) => item.status === "DELIVERED").length;
  const activeCount = items.filter((item) => item.status === "PRESCRIBED").length;

  const reimbursements = details?.data?.reimbursements || [];
  const remboursementTotal = reimbursements.reduce((sum, item) => sum + Number(item.montantValide || 0), 0);

  const qrPayload = selectedRecordId
    ? JSON.stringify(
        {
          type: "MSC_ORDONNANCE",
          recordId: selectedRecordId,
          ts: Date.now()
        },
        null,
        0
      )
    : "";

  const qrImageUrl = selectedRecordId
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrPayload)}`
    : "";

  return (
    <div className="space-y-6 font-mono">
      <h1 className="text-3xl font-bold text-white tracking-tight">PORTAIL_PATIENT</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 flex flex-col justify-center items-center text-center relative overflow-hidden group">
          <div className="absolute -inset-10 bg-blue-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition duration-500 z-0"></div>
          <Fingerprint size={100} className="text-blue-500 mb-4 z-10 relative glitch-text" />
          <h2 className="font-bold text-lg text-white z-10 relative">IDENTITÉ_BLOCKCHAIN</h2>
          <p className="text-neutral-500 text-xs mt-2 z-10 relative">HASH: 0x9B42...F1A8</p>
          <div className="mt-4 w-full">
            <button className="w-full px-3 py-2 bg-blue-600/10 border border-blue-600/30 text-blue-400 font-mono font-bold rounded-lg">
              BLOCKCHAIN_IDENTITY_ACTIVE
            </button>
            <p className="text-[10px] text-neutral-600 mt-2">Wallet-based identity verified by signed login.</p>
          </div>
        </div>

        <div className="md:col-span-2 space-y-6">
          <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white"><FileText className="text-blue-500" /> Ordonnances récentes</h2>
            <ul className="space-y-3">
              {items.length === 0 ? <li className="text-xs text-neutral-500">No prescriptions yet.</li> : null}
              {items.map((item) => (
                <li key={item.recordId} className="flex justify-between items-center p-3 bg-neutral-950 border border-neutral-800 rounded-lg">
                  <div>
                    <p className="font-semibold text-neutral-300">Doctor: {item.doctorWallet}</p>
                    <p className="text-xs text-neutral-500">RECORD: {item.recordId} | V{item.version}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-bold rounded">STATUS: {item.status}</span>
                    <button
                      type="button"
                      onClick={() => loadMedicalRecord(item.recordId)}
                      className="px-3 py-1 border border-neutral-700 text-neutral-300 rounded text-xs hover:bg-neutral-800"
                    >
                      VOIR_DOSSIER
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-3">
            <h2 className="font-bold text-xl text-white">Dossier Medical (ordonnance selectionnee)</h2>
            {details ? (
              <>
                <p className="text-xs text-neutral-500">RECORD: {details.recordId} | STATUS: {details.status}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 border border-neutral-800 rounded bg-neutral-950">
                    <p className="text-neutral-500 mb-1">DIAGNOSTIC</p>
                    <p className="text-neutral-300">{details.data?.dossierMedical?.diagnostic || "Non renseigne"}</p>
                  </div>
                  <div className="p-3 border border-neutral-800 rounded bg-neutral-950">
                    <p className="text-neutral-500 mb-1">OBSERVATIONS</p>
                    <p className="text-neutral-300">{details.data?.dossierMedical?.observations || "Non renseigne"}</p>
                  </div>
                </div>

                <div className="p-3 border border-neutral-800 rounded bg-neutral-950 text-xs">
                  <p className="text-neutral-500 mb-2">INTERVENTIONS / OPERATION</p>
                  {Array.isArray(details.data?.interventions) && details.data.interventions.length > 0 ? (
                    <ul className="space-y-1 text-neutral-300">
                      {details.data.interventions.map((item, idx) => (
                        <li key={`${item.type || "evt"}-${idx}`}>
                          {item.type || "ACTE"} | {item.date || "date inconnue"} | {item.acte || item.service || "-"} | {Number(item.cout || 0)} DH
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-neutral-500">Aucune intervention enregistree.</p>
                  )}
                </div>

                <pre className="text-xs text-neutral-300 bg-neutral-950 border border-neutral-800 rounded p-3 overflow-auto max-h-64">
                  {JSON.stringify(details.data, null, 2)}
                </pre>
              </>
            ) : (
              <p className="text-xs text-neutral-500">Selectionnez une ordonnance puis cliquez sur VOIR_DOSSIER.</p>
            )}
          </div>

          <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 space-y-3">
            <h2 className="font-bold text-xl text-white">QR Ordonnance (pour pharmacie)</h2>
            {selectedRecordId ? (
              <>
                <p className="text-xs text-neutral-500">Le pharmacien peut scanner/coller ce payload pour charger l'ordonnance.</p>
                <div className="flex flex-col md:flex-row gap-4 items-start">
                  <img src={qrImageUrl} alt="QR ordonnance" className="w-52 h-52 bg-white rounded" />
                  <textarea
                    readOnly
                    value={qrPayload}
                    className="w-full min-h-40 p-3 bg-neutral-950 border border-neutral-700 rounded text-neutral-300 text-xs"
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-neutral-500">Aucune ordonnance selectionnee pour generer le QR.</p>
            )}
          </div>

          <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white"><CheckCircle className="text-green-500" /> Remboursements Auto</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="p-3 border border-neutral-800 rounded bg-neutral-950">
                <p className="text-neutral-500 text-xs">ORDONNANCES ACTIVES</p>
                <p className="text-blue-400 font-bold text-xl">{activeCount}</p>
              </div>
              <div className="p-3 border border-neutral-800 rounded bg-neutral-950">
                <p className="text-neutral-500 text-xs">ORDONNANCES DELIVREES</p>
                <p className="text-green-400 font-bold text-xl">{deliveredCount}</p>
              </div>
            </div>

            <div className="mt-4 p-3 border border-neutral-800 rounded bg-neutral-950 text-xs">
              <p className="text-neutral-500 mb-2">REMBoursements (consultation/intervention/operation)</p>
              {reimbursements.length > 0 ? (
                <>
                  <ul className="space-y-1 text-neutral-300">
                    {reimbursements.map((item, idx) => (
                      <li key={`${item.interventionType || "rb"}-${idx}`}>
                        {item.interventionType || "ACTE"} | Demande: {Number(item.montantDemande || 0)} DH | Valide: {Number(item.montantValide || 0)} DH | {item.statut || "PENDING"}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-green-400 font-bold">TOTAL VALIDE: {remboursementTotal} DH</p>
                </>
              ) : (
                <p className="text-neutral-500">Aucun remboursement rattache a cette ordonnance.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
