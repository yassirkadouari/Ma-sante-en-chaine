"use client";

import { useEffect, useState, useRef } from "react";
import { Beaker, Search, Send, User, ClipboardList, CheckCircle2, AlertCircle, Landmark, Upload, UserSearch, Activity, FileText } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { loadSession } from "@/lib/session";

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

export default function LaboDashboard() {
  const [patientWallet, setPatientWallet] = useState("");
  const [testType, setTestType] = useState("");
  const [resultSummary, setResultSummary] = useState("");
  const [amountClaim, setAmountClaim] = useState("");
  const [status, setStatus] = useState<{ type: "success" | "error", msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Archive Search State
  const [searchWallet, setSearchWallet] = useState("");
  const [archive, setArchive] = useState<PatientArchive | null>(null);

  // PDF Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRecordResult = async () => {
    try {
      setBusy(true);
      setStatus(null);
      
      const file = fileInputRef.current?.files?.[0];
      if (!file) throw new Error("Le fichier PDF de l'analyse est obligatoire.");
      if (!patientWallet) throw new Error("Le wallet du patient est obligatoire.");

      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("payload", JSON.stringify({
        patientWallet,
        testType,
        resultSummary,
        amountClaim: amountClaim ? Number(amountClaim) : 0
      }));

      const session = loadSession();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/labo/results`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session?.token || ""}`
        },
        body: formData
      });

      const resBody = await response.json();
      if (!response.ok) throw new Error(resBody.error || "Échec de l'enregistrement");

      setStatus({ 
        type: "success", 
        msg: `Résultat enregistré et ancré sur Blockchain. ID: ${resBody.eventId.slice(0, 8)}` 
      });
      
      setPatientWallet("");
      setTestType("");
      setResultSummary("");
      setAmountClaim("");
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      setStatus({ type: "error", msg: "Échec de récupération: " + error.message });
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
            <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <Beaker className="text-emerald-500" size={24} />
            </div>
            <h1 className="text-3xl font-black text-white tracking-tighter">LABO_NODE</h1>
          </div>
          <p className="text-neutral-500 text-[10px] uppercase tracking-widest font-bold">Unité de Biologie Médicale • Cryptage Blockchain</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center gap-3 font-black text-[10px] text-neutral-400">
             <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
             SÉQUENCEUR_ACTIF
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Entry Form */}
        <div className="bg-neutral-900/50 p-8 rounded-[2rem] border border-neutral-800 shadow-xl space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-3 uppercase tracking-tighter">
            <ClipboardList className="text-emerald-500" /> Saisie Analyse & Scellage PDF
          </h2>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Identité Patient (Wallet)</label>
              <div className="relative">
                <User className="absolute left-3 top-3.5 text-neutral-600" size={16} />
                <input 
                  value={patientWallet}
                  onChange={(e) => setPatientWallet(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-black border border-neutral-800 p-3.5 pl-10 rounded-xl text-xs text-white outline-none focus:border-emerald-500/50 transition-all font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div>
                  <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Type d'Analyse</label>
                  <input 
                    value={testType}
                    onChange={(e) => setTestType(e.target.value)}
                    placeholder="ex: Bilan Lipidique, PCR..."
                    className="w-full bg-black border border-neutral-800 p-3.5 rounded-xl text-xs text-white outline-none focus:border-emerald-500/50 transition-all font-bold"
                  />
               </div>
               <div>
                  <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Frais Laboratoire (DH)</label>
                  <div className="relative">
                    <input 
                      value={amountClaim}
                      onChange={(e) => setAmountClaim(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-black border border-neutral-800 p-3.5 pr-10 rounded-xl text-xs text-white outline-none focus:border-amber-500/50 transition-all font-mono"
                    />
                    <Landmark className="absolute right-3 top-3.5 text-neutral-700" size={16} />
                  </div>
               </div>
            </div>

            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Compte-rendu (PDF Scellé)</label>
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-neutral-800 rounded-2xl cursor-pointer bg-black/40 hover:bg-black/60 hover:border-emerald-500/30 transition-all group">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 mb-3 text-neutral-600 group-hover:text-emerald-500 transition-colors" />
                    <p className="text-xs text-neutral-500 tracking-tighter uppercase font-bold">Sélectionner le rapport d'analyse</p>
                  </div>
                  <input type="file" ref={fileInputRef} accept="application/pdf" className="hidden" />
                </label>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Observations</label>
              <textarea 
                value={resultSummary}
                onChange={(e) => setResultSummary(e.target.value)}
                placeholder="Résumé des conclusions..."
                className="w-full h-24 bg-black border border-neutral-800 p-4 rounded-xl text-xs text-neutral-300 outline-none focus:border-emerald-500/50 transition-all resize-none"
              />
            </div>

            <button 
              disabled={busy || !patientWallet || !testType || !resultSummary}
              onClick={handleRecordResult}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-3 disabled:opacity-30 uppercase tracking-widest text-xs"
            >
              {busy ? "[ SCELLAGE_EN_COURS... ]" : "[ ANCRER_SCELLÉ_BLOCKCHAIN ]"}
              <Send size={18} />
            </button>
          </div>
        </div>

        {/* Search Archive Section */}
        <div className="space-y-6">
           <div className="bg-neutral-900/50 p-8 rounded-[2rem] border border-neutral-800 shadow-xl space-y-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-3 uppercase tracking-tighter">
                <UserSearch className="text-amber-500" /> Archives Patient
              </h2>
              <div className="flex gap-2">
                 <input 
                    value={searchWallet}
                    onChange={(e) => setSearchWallet(e.target.value)}
                    placeholder="Scanner wallet patient..."
                    className="flex-1 bg-black border border-neutral-800 p-3 rounded-xl text-xs text-white outline-none focus:border-amber-500/50 transition-all font-mono"
                 />
                 <button 
                    onClick={fetchArchive}
                    disabled={busy || !searchWallet}
                    className="p-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-all disabled:opacity-30"
                 >
                    <Search size={18} />
                 </button>
              </div>

              {archive && (
                 <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-2 gap-2">
                       <div className="bg-black/40 p-3 rounded-xl border border-neutral-800">
                          <p className="text-[8px] text-neutral-500 uppercase font-black">Visites</p>
                          <p className="text-lg font-black text-white">{archive.summary.totalVisits}</p>
                       </div>
                       <div className="bg-black/40 p-3 rounded-xl border border-neutral-800">
                          <p className="text-[8px] text-neutral-500 uppercase font-black">Prescriptions</p>
                          <p className="text-lg font-black text-emerald-500">{archive.summary.totalPrescriptions}</p>
                       </div>
                    </div>
                    <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                       {archive.events.map(ev => (
                         <div key={ev.eventId} className="p-3 bg-black/20 rounded-xl border border-neutral-800 flex justify-between items-center text-[10px]">
                            <span className="text-neutral-400 font-bold uppercase">{ev.eventType}</span>
                            <span className="text-neutral-600 font-mono italic">{new Date(ev.occurredAt).toLocaleDateString()}</span>
                         </div>
                       ))}
                    </div>
                 </div>
              )}
           </div>

           <div className="bg-emerald-950/20 border border-emerald-900/40 p-8 rounded-[2rem] space-y-4">
              <h3 className="font-black text-white text-sm uppercase tracking-tighter flex items-center gap-2">
                 <AlertCircle className="text-emerald-500" size={18} /> Intégrité des Données
              </h3>
              <p className="text-[10px] text-neutral-400 leading-relaxed font-bold italic">
                 "Chaque analyse scellée génère une empreinte unique. Ce certificat numérique garantit que le rapport PDF consulté par les autres praticiens est strictement identique à l'original émis ici."
              </p>
           </div>
        </div>
      </div>

      {status && (
        <div className={`fixed bottom-6 right-6 p-4 rounded-2xl border shadow-2xl flex items-center gap-3 text-xs animate-in slide-in-from-bottom-4 duration-300 font-black ${
          status.type === "success" ? "bg-emerald-950 border-emerald-500 text-emerald-400" : "bg-red-950 border-red-500 text-red-400"
        }`}>
          {status.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {status.msg}
        </div>
      )}
    </div>
  );
}
