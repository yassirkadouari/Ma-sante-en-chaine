"use client";

import { useEffect, useState, useRef } from "react";
import { Hospital, Search, Send, User, ClipboardList, CheckCircle2, AlertCircle, Landmark, Activity, UserPlus, LogOut as LogOutIcon, Upload, UserSearch, FileText } from "lucide-react";
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

export default function HopitalDashboard() {
  const [patientWallet, setPatientWallet] = useState("");
  const [eventType, setEventType] = useState<"ADMISSION" | "OPERATION" | "DISCHARGE" | "INTERVENTION">("ADMISSION");
  const [department, setDepartment] = useState("");
  const [details, setDetails] = useState("");
  const [amountClaim, setAmountClaim] = useState("");
  const [status, setStatus] = useState<{ type: "success" | "error", msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Archive Search State
  const [searchWallet, setSearchWallet] = useState("");
  const [archive, setArchive] = useState<PatientArchive | null>(null);

  // PDF Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRecordEvent = async () => {
    try {
      setBusy(true);
      setStatus(null);
      
      const file = fileInputRef.current?.files?.[0];
      if (!file) throw new Error("Le fichier PDF du compte-rendu hospitalier est obligatoire.");
      if (!patientWallet) throw new Error("Le wallet du patient est obligatoire.");

      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("payload", JSON.stringify({
        patientWallet,
        eventType,
        department,
        details,
        amountClaim: amountClaim ? Number(amountClaim) : 0
      }));

      const session = loadSession();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/hopital/events`, {
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
        msg: `Acte ${eventType} enregistré et scellé. ID: ${resBody.eventId.slice(0, 8)}` 
      });
      
      setPatientWallet("");
      setDetails("");
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
            <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <Hospital className="text-blue-500" size={24} />
            </div>
            <h1 className="text-3xl font-black text-white tracking-tighter">HÔPITAL_NODE</h1>
          </div>
          <p className="text-neutral-500 text-[10px] uppercase tracking-widest font-bold">Unité de Soins Intensifs • Secteur Hospitalier Certifié</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center gap-3 font-black text-[10px] text-neutral-400">
             <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
             URGENCE_SÉCURISÉE
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Entry Form */}
        <div className="bg-neutral-900/50 p-8 rounded-[2rem] border border-neutral-800 shadow-xl space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-3 uppercase tracking-tighter">
            <ClipboardList className="text-blue-500" /> Enregistrement Acte & Scellage PDF
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
                  className="w-full bg-black border border-neutral-800 p-3.5 pl-10 rounded-xl text-xs text-white outline-none focus:border-blue-500/50 transition-all font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div>
                  <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Type d'Acte</label>
                  <select 
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value as any)}
                    className="w-full bg-black border border-neutral-800 p-3.5 rounded-xl text-xs text-white outline-none focus:border-blue-500/50 transition-all font-black uppercase"
                  >
                    <option value="ADMISSION">ADMISSION</option>
                    <option value="OPERATION">INTERVENTION / OPÉRATION</option>
                    <option value="DISCHARGE">SORTIE / DÉCHARGE</option>
                  </select>
               </div>
               <div>
                  <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Département</label>
                  <input 
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="ex: Cardiologie, Réanimation..."
                    className="w-full bg-black border border-neutral-800 p-3.5 rounded-xl text-xs text-white outline-none focus:border-blue-500/50 transition-all font-black"
                  />
               </div>
            </div>

            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Compte-rendu Hospitalier (PDF)</label>
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-neutral-800 rounded-2xl cursor-pointer bg-black/40 hover:bg-black/60 hover:border-blue-500/30 transition-all group">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 mb-3 text-neutral-600 group-hover:text-blue-500 transition-colors" />
                    <p className="text-xs text-neutral-500 tracking-tighter uppercase font-bold">Téléverser le rapport scellé</p>
                  </div>
                  <input type="file" ref={fileInputRef} accept="application/pdf" className="hidden" />
                </label>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Détails de l'Acte</label>
              <textarea 
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder=" Motif de l'intervention..."
                className="w-full h-24 bg-black border border-neutral-800 p-4 rounded-xl text-xs text-neutral-300 outline-none focus:border-blue-500/50 transition-all resize-none"
              />
            </div>

            <div>
              <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Facturation Honoraires (DH)</label>
              <div className="relative">
                <input 
                  value={amountClaim}
                  onChange={(e) => setAmountClaim(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-black border border-neutral-800 p-4 pr-12 rounded-xl text-lg font-black text-amber-500 outline-none focus:border-amber-500/50 transition-all font-mono"
                />
                <Landmark className="absolute right-4 top-4 text-neutral-700" size={20} />
              </div>
            </div>

            <button 
              disabled={busy || !patientWallet || !department || !details}
              onClick={handleRecordEvent}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-3 disabled:opacity-30 uppercase tracking-widest text-xs"
            >
              {busy ? "[ ENREGISTREMENT_HOPITAL... ]" : "[ VALIDER_ET_SCELLER_L_ACTE ]"}
              <CheckCircle2 size={18} />
            </button>
          </div>
        </div>

        {/* Search Archive Section */}
        <div className="space-y-6">
           <div className="bg-neutral-900/50 p-8 rounded-[2rem] border border-neutral-800 shadow-xl space-y-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-3 uppercase tracking-tighter">
                <UserSearch className="text-amber-500" /> Archives Médicales
              </h2>
              <div className="flex gap-2">
                 <input 
                    value={searchWallet}
                    onChange={(e) => setSearchWallet(e.target.value)}
                    placeholder="Saisir wallet patient..."
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
                          <p className="text-[8px] text-neutral-500 uppercase font-black">Analyses</p>
                          <p className="text-lg font-black text-blue-400">{archive.summary.totalLabTests}</p>
                       </div>
                       <div className="bg-black/40 p-3 rounded-xl border border-neutral-800">
                          <p className="text-[8px] text-neutral-500 uppercase font-black">Actes Précédents</p>
                          <p className="text-lg font-black text-red-500">{archive.summary.totalHospitalEvents}</p>
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

           <div className="bg-blue-600/5 border border-blue-600/20 p-8 rounded-[2rem] space-y-3">
              <h3 className="font-black text-white text-xs uppercase flex items-center gap-2">
                 <Activity className="text-blue-500" size={16} /> Audit Blockchain
              </h3>
              <p className="text-[10px] text-neutral-400 leading-relaxed font-bold italic">
                 "Tous les actes hospitaliers enregistrés ici bénéficient d'une preuve d'intégrité via blockchain. Cela garantit la traçabilité des interventions et facilite les procédures de remboursement."
              </p>
           </div>
        </div>
      </div>

      {status && (
        <div className={`fixed bottom-6 right-6 p-4 rounded-2xl border shadow-2xl flex items-center gap-3 text-xs animate-in slide-in-from-bottom-4 duration-300 font-black ${
          status.type === "success" ? "bg-blue-950 border-blue-500 text-blue-400" : "bg-red-950 border-red-500 text-red-400"
        }`}>
          {status.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {status.msg}
        </div>
      )}
    </div>
  );
}
