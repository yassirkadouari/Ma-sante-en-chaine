"use client";

import { useEffect, useState, useRef } from "react";
import { FilePlus2, ShieldCheck, Upload, FileText, UserSearch, ClipboardList, Activity, CheckCircle2, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { loadSession } from "@/lib/session";

type PrescriptionSummary = {
  recordId: string;
  patientWallet: string;
  pharmacyWallet: string | null;
  version: number;
  status: string;
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

export default function MedecinDashboard() {
  const [patientWallet, setPatientWallet] = useState("");
  const [pharmacyWallet, setPharmacyWallet] = useState("");
  const [items, setItems] = useState<PrescriptionSummary[]>([]);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info", msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  
  // Medical File State
  const [visitPatientWallet, setVisitPatientWallet] = useState("");
  const [visitDiagnosis, setVisitDiagnosis] = useState("");
  const [visitNotes, setVisitNotes] = useState("");

  // Archive Search State
  const [searchWallet, setSearchWallet] = useState("");
  const [archive, setArchive] = useState<PatientArchive | null>(null);
  
  // PDF Prescription State
  const prescFileInputRef = useRef<HTMLInputElement>(null);
  const [prescData, setPrescData] = useState({
    medications: "Ex: Paracétamol 1g (3x/j)",
    instructions: "Repos complet 3 jours."
  });

  const refresh = async () => {
    try {
      const response = await apiRequest<{ items: PrescriptionSummary[] }>({ path: "/prescriptions" });
      setItems(response.items);
    } catch (err) {
      console.error("Fetch failed", err);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const createPdfPrescription = async () => {
    try {
      setBusy(true);
      setStatus(null);
      
      const file = prescFileInputRef.current?.files?.[0];
      if (!file) throw new Error("Le fichier PDF de l'ordonnance est obligatoire.");
      if (!patientWallet) throw new Error("L'adresse wallet du patient est obligatoire.");

      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("payload", JSON.stringify({
        patientWallet,
        pharmacyWallet: pharmacyWallet || undefined,
        data: prescData
      }));

      const session = loadSession();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/prescriptions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session?.token || ""}`
        },
        body: formData
      });

      const resBody = await response.json();
      if (!response.ok) throw new Error(resBody.error || "Échec de l'émission");

      setStatus({ type: "success", msg: `Ordonnance émise & ancrée! Hash: ${resBody.blockchainHash.slice(0, 16)}...` });
      setPatientWallet("");
      setPharmacyWallet("");
      if (prescFileInputRef.current) prescFileInputRef.current.value = "";
      refresh();
    } catch (error: any) {
      setStatus({ type: "error", msg: error.message });
    } finally {
      setBusy(false);
    }
  };

  const registerMedicalEvent = async () => {
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "POST",
        path: "/medical-events/visit",
        signed: true,
        body: {
          patientWallet: visitPatientWallet,
          diagnosis: visitDiagnosis,
          notes: visitNotes || undefined
        }
      });

      setStatus({ type: "success", msg: `Dossier médical mis à jour pour ${visitPatientWallet.slice(0, 8)}...` });
      setVisitDiagnosis("");
      setVisitNotes("");
    } catch (error: any) {
      setStatus({ type: "error", msg: error.message });
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
      setStatus({ type: "error", msg: "Échec de récupération de l'archive: " + error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 font-mono pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-neutral-900/80 backdrop-blur-md p-8 rounded-3xl border border-neutral-800 shadow-2xl gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <Activity className="text-emerald-500" size={24} />
            </div>
            <h1 className="text-3xl font-black text-white tracking-tighter">CORPUS_MEDICA</h1>
          </div>
          <p className="text-neutral-500 text-xs uppercase tracking-widest font-bold">Terminal Praticien Scellé • Blockchain Maroc</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center gap-3 group">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] text-neutral-400 font-bold">RÉSEAU_ACTIF</span>
          </div>
          <div className="px-4 py-2 bg-emerald-600/10 border border-emerald-600/30 text-emerald-400 font-bold rounded-xl flex items-center gap-2 text-xs">
            <ShieldCheck size={16} /> SECURE_NODE
          </div>
        </div>
      </div>

      {status && (
        <div className={`p-4 rounded-2xl border flex items-center gap-3 text-sm animate-in fade-in slide-in-from-top-2 duration-300 ${
          status.type === "success" ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400" : 
          status.type === "error" ? "bg-red-950/20 border-red-500/30 text-red-400" : 
          "bg-blue-950/20 border-blue-500/30 text-blue-400"
        }`}>
          {status.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {status.msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Prescription Section */}
        <div className="bg-neutral-900/50 p-8 rounded-3xl border border-neutral-800 space-y-6 shadow-xl hover:border-emerald-500/30 transition-all group">
          <div className="flex items-center gap-3 border-b border-neutral-800 pb-4">
            <FilePlus2 className="text-emerald-500" size={24} />
            <h2 className="font-bold text-xl text-white tracking-tight">ÉMISSION D'ORDONNANCE</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Identité Patient (Wallet)</label>
              <div className="relative">
                <UserSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" size={16} />
                <input
                  value={patientWallet}
                  onChange={(event) => setPatientWallet(event.target.value)}
                  placeholder="0x..."
                  className="w-full p-3 pl-10 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 outline-none focus:border-emerald-500/50 transition-all text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Charger l'Ordonnance (PDF)</label>
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-neutral-800 rounded-2xl cursor-pointer bg-neutral-950 hover:bg-neutral-900 hover:border-emerald-500/30 transition-all">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 mb-3 text-neutral-600 group-hover:text-emerald-500 transition-colors" />
                    <p className="text-xs text-neutral-500 tracking-tighter uppercase font-bold">Cliquez pour téléverser le scellé PDF</p>
                  </div>
                  <input type="file" ref={prescFileInputRef} accept="application/pdf" className="hidden" />
                </label>
              </div>
            </div>

            <button 
              disabled={busy || !patientWallet} 
              onClick={createPdfPrescription} 
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-30 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
            >
              {busy ? "[ ANCRAGE_EN_COURS... ]" : <><FileText size={18} /> ÉMETTRE_ORDONNANCE</>}
            </button>
          </div>
        </div>

        {/* Medical Registry Section */}
        <div className="bg-neutral-900/50 p-8 rounded-3xl border border-neutral-800 space-y-6 shadow-xl hover:border-blue-500/30 transition-all">
          <div className="flex items-center gap-3 border-b border-neutral-800 pb-4">
            <ClipboardList className="text-blue-500" size={24} />
            <h2 className="font-bold text-xl text-white tracking-tight">DOSSIER MÉDICAL PATIENT</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Patient Node</label>
              <input
                value={visitPatientWallet}
                onChange={(event) => setVisitPatientWallet(event.target.value)}
                placeholder="Wallet du patient"
                className="w-full p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 outline-none focus:border-blue-500/50 transition-all text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Diagnostic / Observation</label>
              <input
                value={visitDiagnosis}
                onChange={(event) => setVisitDiagnosis(event.target.value)}
                placeholder="Ex: Hypertension, Diabète Type II..."
                className="w-full p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 outline-none focus:border-blue-500/50 transition-all text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Notes de Consultation</label>
              <textarea
                value={visitNotes}
                onChange={(event) => setVisitNotes(event.target.value)}
                placeholder="Détails confidentiels du dossier..."
                className="w-full min-h-[100px] p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 outline-none focus:border-blue-500/50 transition-all text-sm"
              />
            </div>
            <button
              disabled={busy || !visitPatientWallet || !visitDiagnosis}
              onClick={registerMedicalEvent}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-900/20 disabled:opacity-30 text-sm"
            >
              METTRE_À_JOUR_LE_DOSSIER
            </button>
          </div>
        </div>
      </div>

      {/* Global Archive Search */}
      <div className="bg-neutral-900/80 backdrop-blur-xl p-8 rounded-[2.5rem] border border-neutral-800 shadow-2xl space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20">
              <UserSearch className="text-amber-500" size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-widest uppercase">Consultation Archives Patient</h2>
              <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">Recherche Multidimensionnelle (Prescriptions, Labo, Hôpital)</p>
            </div>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <input 
              value={searchWallet}
              onChange={(e) => setSearchWallet(e.target.value)}
              placeholder="Wallet du patient (0x...)"
              className="flex-1 md:w-80 p-4 bg-neutral-950 border border-neutral-800 rounded-2xl text-white outline-none focus:border-amber-500/50 transition-all text-sm font-mono"
            />
            <button 
              onClick={fetchArchive}
              disabled={busy || !searchWallet}
              className="px-8 py-4 bg-amber-600 hover:bg-amber-500 text-white font-black rounded-2xl transition-all shadow-lg shadow-amber-900/20 disabled:opacity-30 uppercase text-xs"
            >
              Scanner_Archives
            </button>
          </div>
        </div>

        {archive && (
          <div className="animate-in fade-in zoom-in duration-500 space-y-8">
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-black/40 p-5 rounded-2xl border border-neutral-800">
                  <p className="text-[10px] text-neutral-500 font-black uppercase mb-1">Visites</p>
                  <p className="text-2xl font-bold text-white">{archive.summary.totalVisits}</p>
                </div>
                <div className="bg-black/40 p-5 rounded-2xl border border-neutral-800">
                  <p className="text-[10px] text-neutral-500 font-black uppercase mb-1">Analyses Labo</p>
                  <p className="text-2xl font-bold text-blue-400">{archive.summary.totalLabTests}</p>
                </div>
                <div className="bg-black/40 p-5 rounded-2xl border border-neutral-800">
                  <p className="text-[10px] text-neutral-500 font-black uppercase mb-1">Actes Hopitaux</p>
                  <p className="text-2xl font-bold text-red-500">{archive.summary.totalHospitalEvents}</p>
                </div>
                <div className="bg-black/40 p-5 rounded-2xl border border-neutral-800">
                  <p className="text-[10px] text-neutral-500 font-black uppercase mb-1">Ordonnances</p>
                  <p className="text-2xl font-bold text-emerald-500">{archive.summary.totalPrescriptions}</p>
                </div>
             </div>

             <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-black/20 p-6 rounded-3xl border border-neutral-800">
                   <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest mb-6 border-b border-neutral-800 pb-4">Chronologie des Événements</h3>
                   <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                      {archive.events.map(ev => (
                        <div key={ev.eventId} className="p-4 bg-neutral-900/50 rounded-2xl border border-neutral-800 flex items-center gap-4">
                           <div className={`p-2 rounded-lg ${ev.eventType === 'VISIT' ? 'bg-blue-500/10 text-blue-400' : 'bg-red-500/10 text-red-400'}`}>
                              <Activity size={16} />
                           </div>
                           <div className="flex-1">
                              <p className="text-[11px] font-bold text-white uppercase">{ev.eventType}</p>
                              <p className="text-[9px] text-neutral-500 font-mono italic">"{JSON.stringify(ev.data).slice(0, 50)}..."</p>
                           </div>
                           <p className="text-[9px] text-neutral-600 font-bold">{new Date(ev.occurredAt).toLocaleDateString()}</p>
                        </div>
                      ))}
                   </div>
                </div>

                <div className="bg-black/20 p-6 rounded-3xl border border-neutral-800">
                   <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest mb-6 border-b border-neutral-800 pb-4">Registre Ordonnances</h3>
                   <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                      {archive.prescriptions.map(p => (
                        <div key={p.recordId} className="p-4 bg-neutral-900/50 rounded-2xl border border-neutral-800 flex justify-between items-center">
                           <div>
                              <p className="text-[10px] font-bold text-emerald-500 uppercase">RÉF: {p.recordId.slice(0, 12)}</p>
                              <p className="text-[9px] text-neutral-500">v{p.version} • {new Date(p.issuedAt).toLocaleDateString()}</p>
                           </div>
                           <span className="text-[8px] px-2 py-1 bg-black/40 border border-neutral-800 rounded font-black text-neutral-500">{p.status}</span>
                        </div>
                      ))}
                   </div>
                </div>
             </div>
          </div>
        )}
      </div>

      {/* History Ledger */}
      <div className="bg-neutral-900/50 rounded-3xl border border-neutral-800 shadow-xl overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex justify-between items-center bg-black/20">
          <h2 className="font-bold text-lg text-white tracking-widest uppercase flex items-center gap-2">
            <Activity size={18} className="text-neutral-500" /> Registre d'Émissions Récents
          </h2>
          <button onClick={refresh} className="text-[10px] text-neutral-500 hover:text-white transition-colors font-bold uppercase underline">Rafraîchir</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-black/40 text-neutral-500 font-bold uppercase tracking-tighter">
              <tr>
                <th className="p-4">RECORD_ID</th>
                <th className="p-4">PATIENT_NODE</th>
                <th className="p-4">STATUT</th>
                <th className="p-4">HASH_BLOCKCHAIN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/40">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-10 text-center text-neutral-600 italic">Aucune transaction ordonnance détectée.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.recordId} className="hover:bg-emerald-500/5 transition-colors">
                    <td className="p-4 font-mono text-emerald-400/80">{item.recordId.slice(0, 16)}...</td>
                    <td className="p-4 text-neutral-400 font-mono tracking-tighter">{item.patientWallet}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                        item.status === "PRESCRIBED" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                        item.status === "USED" ? "bg-neutral-800 text-neutral-500" :
                        "bg-red-500/10 text-red-500"
                      }`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="p-4 text-neutral-600 font-mono text-[10px]">{item.blockchainHash || "N/A"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
