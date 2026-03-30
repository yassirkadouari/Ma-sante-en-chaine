"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/api";

type PrescriptionSummary = {
  recordId: string;
  status: string;
  patientWallet: string;
  doctorWallet: string;
  version: number;
};

type PrescriptionDetails = {
  recordId: string;
  status: string;
  data: Record<string, unknown>;
};

export default function PharmacieDashboard() {
  const [recordId, setRecordId] = useState("");
  const [qrInput, setQrInput] = useState("");
  const [details, setDetails] = useState<PrescriptionDetails | null>(null);
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

  const useQrPayload = () => {
    try {
      const parsed = JSON.parse(qrInput || "{}");
      const extracted = typeof parsed.recordId === "string" ? parsed.recordId : "";
      if (!extracted) {
        setStatus("Payload QR invalide: recordId introuvable");
        return;
      }
      setRecordId(extracted);
      setStatus("Record ID charge depuis QR payload.");
    } catch {
      setStatus("QR payload non valide (JSON attendu)");
    }
  };

  const fetchDetails = async () => {
    try {
      setBusy(true);
      setStatus(null);
      const response = await apiRequest<PrescriptionDetails>({
        path: `/prescriptions/${recordId}`,
        signed: true
      });
      setDetails(response);
      setStatus("Prescription integrity verified from blockchain hash.");
    } catch (error: any) {
      setStatus(error.message);
      setDetails(null);
    } finally {
      setBusy(false);
    }
  };

  const deliver = async () => {
    try {
      setBusy(true);
      setStatus(null);
      const response = await apiRequest<{ status: string }>({
        method: "POST",
        path: `/prescriptions/${recordId}/deliver`,
        signed: true,
        body: {}
      });
      setStatus(`Prescription status updated on-chain: ${response.status}`);
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
          <h1 className="text-2xl font-bold text-white">NOEUD_PHARMACIE</h1>
          <p className="text-violet-500 text-sm">Prescription delivery requires signature + blockchain status transition.</p>
        </div>
        <div className="px-4 py-2 bg-violet-500/10 border border-violet-500/30 text-violet-400 font-bold rounded text-sm">SECURE_DISPENSE</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
          <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
            <ClipboardCheck className="text-violet-500" /> Verify Prescription
          </h2>
          <div className="flex gap-2 mb-4">
            <input
              value={recordId}
              onChange={(event) => setRecordId(event.target.value)}
              type="text"
              placeholder=">> RECORD_ID"
              className="flex-1 bg-neutral-950 p-3 border border-neutral-700 text-violet-400 rounded focus:border-violet-500 outline-none"
            />
            <button onClick={fetchDetails} disabled={busy || !recordId} className="bg-violet-600/20 border border-violet-600 text-violet-400 px-4 py-3 rounded hover:bg-violet-600 hover:text-white transition font-bold disabled:opacity-50">
              VERIFY
            </button>
          </div>
          <textarea
            value={qrInput}
            onChange={(event) => setQrInput(event.target.value)}
            placeholder='Coller le payload QR JSON, ex: {"type":"MSC_ORDONNANCE","recordId":"..."}'
            className="w-full min-h-28 mb-3 bg-neutral-950 p-3 border border-neutral-700 text-violet-300 rounded focus:border-violet-500 outline-none text-xs"
          />
          <button onClick={useQrPayload} disabled={!qrInput.trim()} className="mb-4 px-3 py-2 bg-violet-600/20 border border-violet-600 text-violet-300 rounded text-xs disabled:opacity-50">
            USE_QR_PAYLOAD
          </button>
          <div className="border border-neutral-700 rounded-lg p-4 bg-neutral-950 text-xs text-neutral-400">
            Le pharmacien peut scanner/coller le QR payload patient pour extraire automatiquement le recordId.
          </div>
        </div>

        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 flex flex-col justify-between">
          <div>
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
              <ClipboardCheck className="text-emerald-500" /> VALIDATION_SMART_CONTRACT
            </h2>
            <div className="bg-neutral-950 p-4 border border-emerald-900/50 rounded-lg mb-4 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-neutral-500">ID: {details?.recordId || "-"}</span>
                <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded font-bold">STATUT: {details?.status || "UNKNOWN"}</span>
              </div>
              <p className="text-emerald-400 mb-6 flex items-center gap-1 text-xs">AUTHENTICATED_PAYLOAD</p>
              
              <div className="bg-black p-3 rounded border border-neutral-800">
                <p className="text-xs text-neutral-500 mb-2 border-b border-neutral-800 pb-2">DECRYPTED_PAYLOAD:</p>
                <pre className="text-xs text-neutral-300 overflow-auto">{JSON.stringify(details?.data || {}, null, 2)}</pre>
              </div>
            </div>
          </div>
          <button onClick={deliver} disabled={busy || !recordId} className="w-full bg-emerald-600/20 border border-emerald-600 text-emerald-500 font-bold py-3 rounded hover:bg-emerald-600 hover:text-white transition text-sm flex justify-center items-center gap-2 disabled:opacity-50">
            <ShieldAlert size={18} />
            [ MUTATE_STATE: DELIVERED ]
          </button>
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
          <ClipboardCheck className="text-violet-400" /> Pharmacy Queue
        </h2>
        <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-4">
          {items.length === 0 ? (
            <p className="text-xs text-neutral-500">No prescription assigned to this pharmacy wallet.</p>
          ) : (
            <ul className="space-y-2 text-sm text-neutral-300">
              {items.map((item) => (
                <li key={item.recordId} className="flex items-center justify-between border border-neutral-800 rounded px-3 py-2">
                  <span>
                    {item.recordId} | v{item.version} | {item.patientWallet}
                  </span>
                  <span className="text-xs text-emerald-400">{item.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {status ? <p className="mt-3 text-xs text-neutral-300">{status}</p> : null}
      </div>
    </div>
  );
}
