"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, ShieldAlert, QrCode, Search, CheckCircle2, Package, Activity, Info, AlertTriangle, UserSearch } from "lucide-react";
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
  data: Record<string, any>;
  blockchainHash?: string;
};

type PatientArchive = {
  walletAddress: string;
  summary: {
    totalVisits: number;
    totalLabTests: number;
    totalHospitalEvents: number;
    totalPrescriptions: number;
  };
  events: Array<{
    eventId: string;
    eventType: string;
    actorId: string;
    actorRole: string;
    occurredAt: string;
    data: any;
  }>;
  prescriptions: Array<any>;
};

export default function PharmacieDashboard() {
  const [recordId, setRecordId] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [details, setDetails] = useState<PrescriptionDetails | null>(null);
  const [items, setItems] = useState<PrescriptionSummary[]>([]);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info", msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Archive Search State
  const [searchWallet, setSearchWallet] = useState("");
  const [archive, setArchive] = useState<PatientArchive | null>(null);

  const refresh = async () => {
    try {
      const response = await apiRequest<{ items: PrescriptionSummary[] }>({ path: "/prescriptions" });
      setItems(response.items);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const fetchDetails = async () => {
    try {
      setBusy(true);
      setStatus(null);
      const response = await apiRequest<PrescriptionDetails>({
        path: `/prescriptions/${recordId}/scan`,
        signed: true
      });
      setDetails(response);
      setStatus({ type: "success", msg: "Authentification du scellé réussie via Blockchain." });
    } catch (error: any) {
      setStatus({ type: "error", msg: error.message });
      setDetails(null);
    } finally {
      setBusy(false);
    }
  };

  const fetchArchive = async () => {
    if (!searchWallet) return;
    try {
      setBusy(true);
      setArchive(null);
      const data = await apiRequest<PatientArchive>({ 
        path: `/records/patient/${searchWallet}` 
      });
      setArchive(data);
    } catch (error: any) {
      setStatus({ type: "error", msg: "Archive introuvable: " + error.message });
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
        body: { totalAmount: Number(totalAmount || 0) }
      });
      setStatus({ type: "success", msg: `Ordonnance ${recordId.slice(0, 8)} désactivée et archivée.` });
      setDetails(null);
      setRecordId("");
      setTotalAmount("");
      await refresh();
    } catch (error: any) {
      setStatus({ type: "error", msg: error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 font-mono pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-neutral-900/80 backdrop-blur-md p-8 rounded-[2rem] border border-neutral-800 shadow-2xl gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-violet-500/10 rounded-lg border border-violet-500/20">
              <Package className="text-violet-500" size={24} />
            </div>
            <h1 className="text-3xl font-black text-white tracking-tighter">PHARMA_NODE</h1>
          </div>
          <p className="text-neutral-500 text-[10px] uppercase tracking-widest font-bold">Terminal de Validation Officiel • Ministère de la Santé</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-violet-600/10 border border-violet-600/30 text-violet-400 font-bold rounded-xl flex items-center gap-2 text-xs">
            <ShieldAlert size={16} /> VALIDATION_LEVEL_3
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Verification Section */}
        <div className="bg-neutral-900/50 p-8 rounded-[2rem] border border-neutral-800 space-y-6 shadow-xl hover:border-violet-500/30 transition-all">
          <div className="flex items-center gap-3 border-b border-neutral-800 pb-4">
            <QrCode className="text-violet-400" size={24} />
            <h2 className="font-bold text-xl text-white tracking-tight uppercase">Scanner une Ordonnance</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-black mb-1 block">Prescription ID (OR-xxxx)</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" size={16} />
                <input
                  value={recordId}
                  onChange={(event) => setRecordId(event.target.value)}
                  placeholder="ID de l'ordonnance patient"
                  className="w-full p-4 pl-10 bg-black border border-neutral-800 rounded-2xl text-violet-400 outline-none focus:border-violet-500/50 transition-all text-sm font-mono"
                />
              </div>
            </div>

            <button 
              disabled={busy || !recordId} 
              onClick={fetchDetails} 
              className="w-full py-4 bg-violet-600 hover:bg-violet-500 text-white font-black rounded-2xl transition-all shadow-lg shadow-violet-900/20 disabled:opacity-30 text-sm flex items-center justify-center gap-2"
            >
              {busy ? "[ VÉRIFICATION_EN_COURS... ]" : <><Activity size={18} /> VÉRIFIER_BLOCKCHAIN</>}
            </button>
          </div>

          <div className="bg-black/40 p-4 rounded-xl border border-neutral-800 flex gap-3">
            <Info className="text-violet-500 shrink-0" size={16} />
            <p className="text-[10px] text-neutral-500 leading-normal font-medium">L'authentification vérifie l'empreinte numérique (Hash) stockée sur la blockchain. Si le hash ne correspond pas, l'accès au traitement sera bloqué.</p>
          </div>
        </div>

        {/* Search Archive Section */}
        <div className="bg-neutral-900/50 p-8 rounded-[2rem] border border-neutral-800 space-y-6 shadow-xl">
           <div className="flex items-center gap-3 border-b border-neutral-800 pb-4">
            <UserSearch className="text-amber-400" size={24} />
            <h2 className="font-bold text-xl text-white tracking-tight uppercase">Historique Patient</h2>
          </div>
          <div className="flex gap-2">
            <input 
              value={searchWallet}
              onChange={(e) => setSearchWallet(e.target.value)}
              placeholder="Scanner wallet patient..."
              className="flex-1 bg-black border border-neutral-800 p-4 rounded-2xl text-xs text-white outline-none focus:border-amber-500/50 transition-all font-mono"
            />
            <button 
              onClick={fetchArchive}
              disabled={busy || !searchWallet}
              className="px-6 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl transition-all disabled:opacity-30 font-black text-xs uppercase"
            >
              Scanner
            </button>
          </div>

          {archive && (
            <div className="space-y-4 animate-in fade-in zoom-in duration-300">
               <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black/40 p-3 rounded-xl border border-neutral-800 text-center">
                    <p className="text-[8px] text-neutral-500 uppercase font-black">Actives</p>
                    <p className="text-lg font-black text-emerald-500">{archive.prescriptions.filter(p => p.status === 'PRESCRIBED').length}</p>
                  </div>
                  <div className="bg-black/40 p-3 rounded-xl border border-neutral-800 text-center">
                    <p className="text-[8px] text-neutral-500 uppercase font-black">Total Ordonnances</p>
                    <p className="text-lg font-black text-white">{archive.summary.totalPrescriptions}</p>
                  </div>
               </div>
               <div className="max-h-[150px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {archive.prescriptions.map(p => (
                    <div key={p.recordId} className="p-3 bg-black/20 rounded-xl border border-neutral-800 flex justify-between items-center text-[10px]">
                       <span className="text-violet-400 font-mono">{p.recordId.slice(0, 12)}</span>
                       <span className={`px-2 py-0.5 rounded text-[8px] font-black ${p.status === 'USED' ? 'bg-neutral-800 text-neutral-500' : 'bg-emerald-950/40 text-emerald-400'}`}>
                         {p.status}
                       </span>
                    </div>
                  ))}
               </div>
            </div>
          )}
        </div>
      </div>

       {/* Validation View (Full Width) */}
      {details && (
        <div className="bg-neutral-900/80 backdrop-blur-xl p-8 rounded-[2rem] border border-violet-500/30 shadow-2xl animate-in slide-in-from-bottom-8 duration-500">
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-neutral-800">
              <h2 className="font-black text-2xl text-white flex items-center gap-3">
                <CheckCircle2 className="text-emerald-500" size={32} /> DÉTAILS_ORDONNANCE_SCELLÉE
              </h2>
              <button onClick={() => setDetails(null)} className="text-xs text-neutral-500 hover:text-white uppercase font-black underline">Fermer la vue</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-black/60 p-6 rounded-2xl border border-neutral-800 space-y-4">
                   <div className="grid grid-cols-2 gap-4 border-b border-neutral-800 pb-4 text-[10px]">
                      <div>
                        <p className="text-neutral-500 uppercase font-bold mb-1">Blockchain Audit Hash</p>
                        <p className="font-mono text-emerald-500 truncate">{details.blockchainHash || "N/A"}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-neutral-500 uppercase font-bold mb-1">Statut Actuel</p>
                        <span className="bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full font-black">{details.status}</span>
                      </div>
                   </div>
                   
                   <div>
                      <p className="text-[10px] text-neutral-500 uppercase font-bold mb-3">Prescription Médicale (Dossier Pharmacologique)</p>
                      <pre className="p-5 bg-neutral-950 rounded-xl border border-neutral-800 text-xs text-neutral-300 font-mono whitespace-pre-wrap leading-relaxed shadow-inner">
                        {JSON.stringify(details.data, null, 2)}
                      </pre>
                   </div>
                </div>
              </div>

              <div className="space-y-6">
                {details.status === "PRESCRIBED" ? (
                  <div className="bg-emerald-950/20 p-8 rounded-3xl border border-emerald-500/30 space-y-6 flex flex-col h-full">
                    <h3 className="font-black text-emerald-400 uppercase tracking-widest text-sm text-center">Protocol de Distribution</h3>
                    <div className="space-y-4 flex-1">
                      <div>
                        <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block">Montant Total encaissé (DH)</label>
                        <div className="relative">
                           <input 
                            type="number"
                            value={totalAmount}
                            onChange={(e) => setTotalAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full p-5 bg-black border border-emerald-500/50 rounded-2xl text-2xl font-black text-emerald-500 outline-none focus:border-emerald-400 transition-all font-mono"
                          />
                          <span className="absolute right-5 top-5 text-emerald-600 font-black">MAD</span>
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={deliver}
                      disabled={busy || !totalAmount}
                      className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl transition-all shadow-xl shadow-emerald-900/30 flex items-center justify-center gap-3 uppercase text-xs"
                    >
                      <ShieldAlert size={20} /> Finaliser la Délivrance
                    </button>
                  </div>
                ) : (
                  <div className="bg-red-950/20 p-8 rounded-3xl border border-red-500/30 flex flex-col items-center justify-center text-center space-y-4">
                    <AlertTriangle className="text-red-500" size={48} />
                    <p className="text-xs text-red-500 font-black uppercase tracking-widest">Avertissement : Ordonnance déjà consommée ou désactivée.</p>
                  </div>
                )}
              </div>
            </div>
        </div>
      )}

      {/* Local Queue Table */}
      <div className="bg-neutral-900/50 rounded-[2rem] border border-neutral-800 shadow-xl overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex justify-between items-center bg-black/20">
          <h2 className="font-bold text-lg text-white tracking-widest uppercase flex items-center gap-2">
            <Package size={18} className="text-neutral-500" /> Journal de Validation Local
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-black/40 text-neutral-500 font-bold uppercase tracking-tighter">
              <tr>
                <th className="p-4">RECORD_ID</th>
                <th className="p-4">STATUT_ACTUEL</th>
                <th className="p-4">PATIENT_NODE</th>
                <th className="p-4">VERSION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/40">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-10 text-center text-neutral-600 italic">Aucune transaction détectée dans la file locale.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.recordId} className="hover:bg-violet-500/5 transition-colors cursor-pointer" onClick={() => setRecordId(item.recordId)}>
                    <td className="p-4 font-mono text-violet-400/80">{item.recordId}</td>
                    <td className="p-4 text-neutral-300">
                      <span className={`px-2 py-1 rounded text-[8px] font-black ${
                        item.status === "USED" ? "bg-neutral-800 text-neutral-500" : "bg-emerald-500/10 text-emerald-500"
                      }`}>{item.status}</span>
                    </td>
                    <td className="p-4 text-neutral-400 font-mono italic">{item.patientWallet.slice(0, 20)}...</td>
                    <td className="p-4 text-neutral-500">v{item.version}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {status && (
        <div className={`fixed bottom-6 right-6 p-4 rounded-2xl border shadow-2xl flex items-center gap-3 text-xs animate-in slide-in-from-bottom-4 duration-300 ${
          status.type === "success" ? "bg-emerald-950/80 backdrop-blur border-emerald-500/50 text-emerald-400" : "bg-red-950/80 backdrop-blur border-red-500/50 text-red-400"
        }`}>
          {status.type === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {status.msg}
        </div>
      )}
    </div>
  );
}
