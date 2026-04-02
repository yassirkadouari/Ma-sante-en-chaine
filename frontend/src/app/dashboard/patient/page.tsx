"use client";

import { useEffect, useState } from "react";
import { 
  FileText, HeartPulse, Wallet, QrCode, Download, UserCircle, Activity, 
  ChevronRight, Stethoscope, Landmark, TestTube, Hotel, History, 
  CheckCircle2, Clock, AlertCircle, TrendingUp, Info
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { loadSession } from "@/lib/session";

type PrescriptionSummary = {
  recordId: string;
  status: string;
  doctorWallet: string;
  version: number;
  hasTextContent?: boolean;
  totalAmount?: number;
};

type PrescriptionDetails = {
  recordId: string;
  data: {
    ordonnanceText?: string;
    medications?: string;
    instructions?: string;
  };
};

type MedicalMine = {
  profile: {
    bloodType?: string | null;
    age?: number | null;
    diseases?: string[];
    primaryDoctorWallet?: string | null;
    region?: string | null;
  } | null;
  visits: Array<{
    eventId: string;
    occurredAt: string;
    data: { diagnosis?: string; notes?: string; };
  }>;
  labResults: Array<{
    eventId: string;
    occurredAt: string;
    data: { testType: string; resultSummary: string; amountClaim?: number; pdfPath?: string };
    actorWallet: string;
  }>;
  pastOperations: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
    data: { operationName?: string; details?: string; department?: string; notes?: string; amountClaim?: number; pdfPath?: string };
    actorWallet: string;
  }>;
};

type ClaimItem = {
  claimId: string;
  sourceType: string;
  sourceId: string;
  amountRequested: number;
  amountApproved?: number;
  status: string;
  reason?: string;
  paymentReference?: string;
  sourceInfo?: { date: string; label: string; institution?: string } | null;
};

export default function PatientDashboard() {
  const [activeTab, setActiveTab] = useState<"presc" | "events" | "claims">("presc");
  const [items, setItems] = useState<PrescriptionSummary[]>([]);
  const [medical, setMedical] = useState<MedicalMine | null>(null);
  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [newDoctorWallet, setNewDoctorWallet] = useState("");
  const [selectedPresc, setSelectedPresc] = useState<PrescriptionSummary | null>(null);
  const [selectedPrescDetails, setSelectedPrescDetails] = useState<PrescriptionDetails | null>(null);
  const [loadingSelectedPresc, setLoadingSelectedPresc] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error", msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const [prescriptions, mine, claimRows] = await Promise.all([
        apiRequest<{ items: PrescriptionSummary[] }>({ path: "/prescriptions" }),
        apiRequest<MedicalMine>({ path: "/medical-events/mine" }),
        apiRequest<{ items: ClaimItem[] }>({ path: "/claims" })
      ]);
      setItems(prescriptions.items || []);
      setMedical(mine);
      setClaims(claimRows.items || []);
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const loadSelectedPrescription = async () => {
      if (!selectedPresc) {
        setSelectedPrescDetails(null);
        return;
      }

      try {
        setLoadingSelectedPresc(true);
        const details = await apiRequest<PrescriptionDetails>({
          path: `/prescriptions/${selectedPresc.recordId}`,
          signed: true
        });
        setSelectedPrescDetails(details);
      } catch (error: any) {
        setSelectedPrescDetails(null);
        setStatus({ type: "error", msg: error.message || "Impossible de charger le contenu de l'ordonnance." });
      } finally {
        setLoadingSelectedPresc(false);
      }
    };

    loadSelectedPrescription();
  }, [selectedPresc]);

  const changeDoctor = async () => {
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "PATCH",
        path: "/auth/relink-doctor",
        signed: true,
        body: { doctorWallet: newDoctorWallet }
      });
      setStatus({ type: "success", msg: "Médecin traitant mis à jour avec succès." });
      setNewDoctorWallet("");
      refresh();
    } catch (error: any) {
      setStatus({ type: "error", msg: error.message });
    } finally {
      setBusy(false);
    }
  };

  const getClaimForSource = (sourceId: string) => {
    return claims.find(c => c.sourceId === sourceId);
  };

  const downloadPdf = async (pathOrUrl: string) => {
    if (!pathOrUrl) return;

    const session = loadSession();
    const isAbsolute = /^https?:\/\//i.test(pathOrUrl);
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const url = isAbsolute ? pathOrUrl : `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session?.token || ""}` }
      });
      if (!res.ok) throw new Error("Fichier introuvable");

      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `document-${Date.now()}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      setStatus({ type: "error", msg: "Impossible de télécharger le document." });
    }
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
      APPROVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      PENDING: "bg-amber-500/10 text-amber-500 border-amber-500/20",
      REJECTED: "bg-red-500/10 text-red-500 border-red-500/20",
      REIMBURSED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      DELIVERED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      PRESCRIBED: "bg-sky-500/10 text-sky-400 border-sky-500/20"
    };

    return (
      <span className={`px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${colors[status] || "bg-neutral-800 text-neutral-500"}`}>
        {status}
      </span>
    );
  };

  const totalExpenses = (medical?.labResults.reduce((s, r) => s + (r.data.amountClaim || 0), 0) || 0) + 
                        (medical?.pastOperations.reduce((s, o) => s + (o.data.amountClaim || 0), 0) || 0);

  return (
    <div className="space-y-8 font-mono pb-20 max-w-7xl mx-auto">
      {/* Header */}
      <div className="relative overflow-hidden bg-neutral-900/80 backdrop-blur-xl p-8 rounded-[2rem] border border-neutral-800 shadow-2xl">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <UserCircle size={150} />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row justify-between gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-blue-600/20 rounded-2xl border border-blue-500/30 flex items-center justify-center">
                <HeartPulse className="text-blue-500" size={32} />
              </div>
              <div>
                <h1 className="text-3xl font-black text-white tracking-tighter">PORTAIL_PATIENT_SÉCURISÉ</h1>
                <p className="text-neutral-500 text-xs uppercase tracking-[0.2em] font-bold">Réseau Médical Scellé • Région {medical?.profile?.region || "..."}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-black/40 p-4 rounded-2xl border border-neutral-800/50">
                <p className="text-[10px] text-neutral-500 uppercase font-black mb-1 flex items-center gap-1"><TrendingUp size={10} /> Groupe</p>
                <p className="text-xl font-bold text-blue-400">{medical?.profile?.bloodType || "N/A"}</p>
              </div>
              <div className="bg-black/40 p-4 rounded-2xl border border-neutral-800/50">
                <p className="text-[10px] text-neutral-500 uppercase font-black mb-1 flex items-center gap-1"><Clock size={10} /> Âge</p>
                <p className="text-xl font-bold text-white">{medical?.profile?.age || "0"} ans</p>
              </div>
              <div className="bg-black/40 p-4 rounded-2xl border border-neutral-800/50">
                <p className="text-[10px] text-neutral-500 uppercase font-black mb-1 flex items-center gap-1"><Landmark size={10} /> Dépenses</p>
                <p className="text-xl font-bold text-amber-500">{totalExpenses} <span className="text-[10px]">DH</span></p>
              </div>
            </div>
          </div>

          <div className="bg-neutral-950/80 p-6 rounded-3xl border border-blue-500/20 min-w-[320px] shadow-inner">
             <h3 className="text-[10px] text-neutral-400 font-black uppercase mb-4 flex items-center gap-2">
               <Stethoscope size={14} className="text-blue-500" /> Gestion Médecin Traitant
             </h3>
             <div className="space-y-4">
                <div className="bg-black/40 p-3 rounded-xl border border-neutral-800">
                   <p className="text-[8px] text-neutral-500 uppercase mb-1 font-black">Actuel</p>
                   <p className="text-[10px] font-bold text-white truncate font-mono">
                    {medical?.profile?.primaryDoctorWallet || "AUCUN_MÉDECIN_LIÉ"}
                   </p>
                </div>
                <div className="flex gap-2">
                  <input 
                    value={newDoctorWallet}
                    onChange={(e) => setNewDoctorWallet(e.target.value)}
                    placeholder="Coller wallet médecin..."
                    className="flex-1 bg-black border border-neutral-800 p-2.5 rounded-xl text-[10px] text-blue-400 outline-none focus:border-blue-500 transition-all font-mono"
                  />
                  <button 
                    onClick={changeDoctor} 
                    disabled={busy || !newDoctorWallet}
                    className="px-4 py-2 bg-blue-600 text-[10px] font-black rounded-xl hover:bg-blue-500 transition-all uppercase disabled:opacity-30"
                  >
                    Actualiser
                  </button>
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 p-1.5 bg-neutral-900/50 rounded-2xl border border-neutral-800 w-fit mx-auto lg:mx-0">
        {[
          { id: "presc", label: "Traitement", icon: FileText },
          { id: "events", label: "Analyses & Suivi", icon: TestTube },
          { id: "claims", label: "Assurance", icon: Landmark },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-8 py-4 rounded-xl text-[10px] font-black transition-all flex items-center gap-2 uppercase tracking-widest ${
              activeTab === tab.id 
                ? "bg-white text-black shadow-lg shadow-white/5" 
                : "text-neutral-500 hover:text-white"
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-12">
          {/* TAB: PRESCRIPTIONS */}
          {activeTab === "presc" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="lg:col-span-8 space-y-6">
                  <div className="bg-neutral-900/50 rounded-[2.5rem] border border-neutral-800 p-8 shadow-xl">
                    <div className="flex justify-between items-center mb-8 pb-4 border-b border-neutral-800">
                      <h2 className="text-xl font-black text-white flex items-center gap-3">
                         <FileText className="text-emerald-500" /> REGISTRE DES ORDONNANCES
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {items.map((item) => {
                        const claim = getClaimForSource(item.recordId);
                        return (
                          <div 
                            key={item.recordId} 
                            onClick={() => setSelectedPresc(item)}
                            className={`p-6 rounded-3xl border transition-all cursor-pointer group relative overflow-hidden ${
                              selectedPresc?.recordId === item.recordId 
                                ? "bg-emerald-500/5 border-emerald-500/40 shadow-lg" 
                                : "bg-black/20 border-neutral-800 hover:border-neutral-700"
                            }`}
                          >
                            <div className="flex justify-between items-start mb-4">
                              <div className="p-2 bg-neutral-900 rounded-xl">
                                <QrCode className={selectedPresc?.recordId === item.recordId ? "text-emerald-500" : "text-neutral-600"} size={20} />
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <StatusBadge status={item.status} />
                                {claim && <StatusBadge status={`CLAIM_${claim.status}`} />}
                              </div>
                            </div>
                            <h3 className="font-bold text-white text-sm mb-1 uppercase">OR- {item.recordId.slice(0, 12)}</h3>
                            <p className="text-[10px] text-neutral-500 mb-4 tracking-tighter font-mono italic">Signature: {item.doctorWallet.slice(0, 16)}...</p>
                            
                            <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
                              {item.status === "DELIVERED" && !claim && (
                                <button 
                                  onClick={async (e) => { 
                                    e.stopPropagation(); 
                                    try {
                                      setBusy(true);
                                      await apiRequest({ method: "POST", path: `/claims/prescriptions/${item.recordId}`, signed: true });
                                      setStatus({ type: "success", msg: "Demande de remboursement envoyée." });
                                      refresh();
                                    } catch (err: any) {
                                      setStatus({ type: "error", msg: err.message });
                                    } finally {
                                      setBusy(false);
                                    }
                                  }} 
                                  className="w-full py-2.5 bg-amber-600/20 border border-amber-600/30 text-amber-400 rounded-xl text-[10px] font-black hover:bg-amber-600 hover:text-white transition-all flex items-center justify-center gap-2"
                                >
                                  <Landmark size={14} /> RÉCLAMER REMBOURSEMENT
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {items.length === 0 && <div className="col-span-2 py-20 text-center text-neutral-600 flex flex-col items-center gap-4">
                         <AlertCircle size={40} className="text-neutral-800" />
                         <p className="text-sm italic font-bold">AUCUNE_ORDONNANCE_DÉTECTÉE</p>
                      </div>}
                    </div>
                  </div>
               </div>

               <div className="lg:col-span-4">
                  {selectedPresc ? (
                    <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl text-black space-y-6 sticky top-8">
                       <div className="text-center">
                         <p className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 mb-6 font-mono">TOKEN_D'AUTHENTIFICATION_SCRUPULEUSE</p>
                         <div className="bg-neutral-100 p-8 rounded-[2.5rem] inline-block border-2 border-emerald-500/10 mb-6 shadow-inner">
                           <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${selectedPresc.recordId}`} alt="QR" className="w-48 h-48 mix-blend-multiply" />
                         </div>
                       </div>
                       <div className="space-y-4 border-t border-neutral-100 pt-8">
                         <div className="flex justify-between items-center bg-neutral-50 p-3 rounded-xl"><span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest">TRANSACTION_ID</span><span className="text-xs font-mono font-bold">{selectedPresc.recordId.slice(0, 10)}...</span></div>
                         <div className="flex justify-between items-center bg-neutral-50 p-3 rounded-xl"><span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest">SÉCURITÉ</span><span className="text-xs font-bold text-emerald-600">SCELLÉ_ANCRÉ</span></div>
                       </div>
                       <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-3">
                          <p className="text-[9px] text-neutral-500 font-black uppercase tracking-[0.15em]">Contenu de l'ordonnance</p>
                          {loadingSelectedPresc ? (
                            <p className="text-[10px] text-neutral-500 font-mono">Chargement du contenu...</p>
                          ) : (
                            <>
                              <p className="text-[10px] text-neutral-800 font-mono whitespace-pre-wrap leading-relaxed">
                                {selectedPrescDetails?.data?.ordonnanceText || "Aucun contenu texte disponible pour cette ordonnance."}
                              </p>
                              {(selectedPrescDetails?.data?.medications || selectedPrescDetails?.data?.instructions) ? (
                                <div className="pt-2 border-t border-neutral-200 space-y-2">
                                  {selectedPrescDetails?.data?.medications ? (
                                    <p className="text-[10px] text-neutral-700 font-mono"><span className="font-black">Médicaments:</span> {selectedPrescDetails.data.medications}</p>
                                  ) : null}
                                  {selectedPrescDetails?.data?.instructions ? (
                                    <p className="text-[10px] text-neutral-700 font-mono"><span className="font-black">Instructions:</span> {selectedPrescDetails.data.instructions}</p>
                                  ) : null}
                                </div>
                              ) : null}
                            </>
                          )}
                       </div>
                       <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex gap-3">
                          <Info size={16} className="text-blue-500 shrink-0 mt-1" />
                          <p className="text-[9px] text-blue-800 font-bold leading-relaxed">Presentez ce QR code à la pharmacie pour débloquer votre traitement authentifié sur la blockchain.</p>
                       </div>
                    </div>
                  ) : (
                    <div className="bg-neutral-900/50 p-12 rounded-[2.5rem] border border-neutral-800 text-center flex flex-col items-center justify-center opacity-40 grayscale h-[400px]">
                       <QrCode size={64} className="text-neutral-500 mb-6 stroke-1" />
                       <p className="text-xs font-black uppercase tracking-[0.3em] text-neutral-500">SÉLECTIONNEZ_UN_TRAITEMENT</p>
                    </div>
                  )}
               </div>
            </div>
          )}

          {/* TAB: MEDICAL EVENTS (LABO & HÔPITAL) */}
          {activeTab === "events" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <section className="bg-neutral-900/50 rounded-[2.5rem] border border-neutral-800 p-8 shadow-xl">
                 <h2 className="text-xl font-black text-white flex items-center gap-3 mb-8 pb-4 border-b border-neutral-800">
                   <Activity className="text-blue-500" /> REGISTRE DES ANALYSES & ACTES MÈDICAUX
                 </h2>

                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {/* Lab Results */}
                    {medical?.labResults?.map(res => {
                      const claim = getClaimForSource(res.eventId);
                      return (
                        <div key={res.eventId} className="bg-black/30 p-8 rounded-[2rem] border border-neutral-800 hover:border-blue-500/30 transition-all flex flex-col h-full">
                          <div className="flex justify-between items-start mb-6">
                            <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20"><TestTube className="text-blue-500" size={28} /></div>
                            <div className="flex flex-col items-end gap-2">
                               <span className="text-[10px] text-neutral-500 font-black uppercase">{new Date(res.occurredAt).toLocaleDateString()}</span>
                               {claim && <StatusBadge status={`CLAIM_${claim.status}`} />}
                            </div>
                          </div>
                          <div className="flex-1">
                            <h3 className="text-blue-400 font-black text-sm uppercase tracking-widest mb-3">{res.data.testType}</h3>
                            <p className="text-[10px] text-neutral-400 font-mono leading-relaxed italic border-l-2 border-neutral-800 pl-4 py-1">" {res.data.resultSummary} "</p>
                          </div>
                          
                          <div className="mt-8 space-y-4">
                             {res.data.amountClaim && (
                               <div className="flex justify-between items-center text-[10px] font-black text-neutral-500">
                                 <span className="uppercase font-mono">Montant:</span>
                                 <span className="text-white bg-neutral-900 px-3 py-1 rounded-lg border border-neutral-800">{res.data.amountClaim} DH</span>
                               </div>
                             )}
                             {res.data.pdfPath && (
                                <button onClick={() => downloadPdf(res.data.pdfPath!)} className="w-full py-3 bg-blue-600/10 border border-blue-500/30 text-blue-400 rounded-xl text-[10px] font-black hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2 uppercase tracking-tighter">
                                   <Download size={14} /> Voir le Rapport Signé
                                </button>
                             )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Hospital Events */}
                    {medical?.pastOperations?.map(op => {
                       const claim = getClaimForSource(op.eventId);
                       return (
                        <div key={op.eventId} className="bg-black/30 p-8 rounded-[2rem] border border-neutral-800 hover:border-red-500/30 transition-all flex flex-col h-full">
                          <div className="flex justify-between items-start mb-6">
                            <div className={`p-4 rounded-2xl border ${op.eventType === "INTERVENTION" || op.eventType === "OPERATION" ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
                              {op.eventType === "INTERVENTION" || op.eventType === "OPERATION" ? <Activity className="text-red-500" size={28} /> : <Hotel className="text-amber-500" size={28} />}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                               <span className="text-[10px] text-neutral-500 font-black uppercase">{new Date(op.occurredAt).toLocaleDateString()}</span>
                               {claim && <StatusBadge status={`CLAIM_${claim.status}`} />}
                            </div>
                          </div>
                          <div className="flex-1">
                            <h3 className="text-white font-black text-sm uppercase tracking-widest mb-1">{op.data.operationName || op.eventType}</h3>
                            <p className="text-[9px] text-neutral-500 font-black uppercase tracking-[0.2em] mb-4">{op.data.department || "SERVICE_HOSPITALIER"}</p>
                            <p className="text-[10px] text-neutral-400 font-mono line-clamp-3 leading-relaxed"> {op.data.details || op.data.notes} </p>
                          </div>
                          
                          <div className="mt-8 space-y-4">
                             {op.data.amountClaim && (
                               <div className="flex justify-between items-center text-[10px] font-black text-neutral-500">
                                 <span className="uppercase font-mono">Honoraires:</span>
                                 <span className="text-red-400 bg-neutral-900 px-3 py-1 rounded-lg border border-neutral-800">{op.data.amountClaim} DH</span>
                               </div>
                             )}
                             {op.data.pdfPath && (
                                <button onClick={() => downloadPdf(op.data.pdfPath!)} className="w-full py-3 bg-red-600/10 border border-red-500/30 text-red-400 rounded-xl text-[10px] font-black hover:bg-red-600 hover:text-white transition-all flex items-center justify-center gap-2 uppercase tracking-tighter">
                                   <Download size={14} /> Dossier Hospitalisation PDF
                                </button>
                             )}
                          </div>
                        </div>
                       );
                    })}
                 </div>

                 {(!medical?.labResults?.length && !medical?.pastOperations?.length) && (
                   <div className="text-center py-24 opacity-20">
                      <History size={64} className="mx-auto mb-6 stroke-1" />
                      <p className="text-xs font-black uppercase tracking-[0.5em]">AUCUN_ACTE_ENREGISTRÉ</p>
                   </div>
                 )}
              </section>

              {/* Patient Visits */}
              <section className="bg-neutral-900/50 rounded-[2.5rem] border border-neutral-800 p-8 shadow-xl">
                 <h2 className="text-xl font-bold text-white flex items-center gap-3 mb-8">
                   <Activity className="text-neutral-500" size={24} /> RÉCAPITULATIF DES CONSULTATIONS
                 </h2>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {medical?.visits?.map(visit => {
                      const claim = getClaimForSource(visit.eventId);
                      return (
                        <div key={visit.eventId} className="flex gap-6 p-6 bg-black/40 rounded-[2rem] border border-neutral-800 hover:border-neutral-700 transition-all items-center group">
                          <div className="text-center min-w-[60px] bg-neutral-950 p-4 rounded-2xl border border-neutral-800 group-hover:bg-neutral-900 transition-colors">
                             <span className="text-2xl font-black text-white block leading-none">{new Date(visit.occurredAt).getDate()}</span>
                             <span className="text-[9px] text-neutral-500 uppercase font-black">{new Date(visit.occurredAt).toLocaleString('default', { month: 'short' })}</span>
                          </div>
                          <div className="flex-1 border-l border-neutral-800 pl-6">
                            <div className="flex items-center gap-4 mb-2">
                               <p className="text-xs font-black text-neutral-200 uppercase tracking-widest">{visit.data.diagnosis || "Synthèse Médicale"}</p>
                               {claim && <StatusBadge status={`CLAIM_${claim.status}`} />}
                            </div>
                            <p className="text-[10px] text-neutral-500 font-mono italic">"{visit.data.notes || "Dossier patient mis à jour via Node Sécurisé"}"</p>
                          </div>
                        </div>
                      );
                    })}
                 </div>
              </section>
            </div>
          )}

          {/* TAB: CLAIMS */}
          {activeTab === "claims" && (
            <section className="bg-neutral-900/50 rounded-[2.5rem] border border-neutral-800 p-10 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-12 gap-8">
                <div>
                  <h2 className="text-2xl font-black text-white flex items-center gap-3">
                    <Landmark className="text-amber-500" /> GESTION DES REMBOURSEMENTS ASSURANCE
                  </h2>
                  <p className="text-[10px] text-neutral-500 uppercase font-bold mt-2 tracking-widest font-mono">Traçabilité Blockchain ANAM • {claims.length} Dossiers Actifs</p>
                </div>
                <div className="flex gap-4">
                  <div className="bg-black/80 px-8 py-5 rounded-3xl border border-neutral-800 shadow-inner">
                    <p className="text-[9px] text-neutral-500 font-black uppercase mb-1 tracking-widest">Cumul_Approuvé</p>
                    <p className="text-3xl font-black text-emerald-500">{claims.filter(c => c.status === 'REIMBURSED' || c.status === 'APPROVED').reduce((s,c) => s + (c.amountApproved || 0), 0)} <span className="text-xs">DH</span></p>
                  </div>
                  <div className="bg-black/40 px-8 py-5 rounded-3xl border border-neutral-800">
                    <p className="text-[9px] text-neutral-500 font-black uppercase mb-1 tracking-widest">En_Attente</p>
                    <p className="text-3xl font-black text-amber-500">{claims.filter(c => c.status === 'PENDING').reduce((s,c) => s + c.amountRequested, 0)} <span className="text-xs">DH</span></p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {claims.map((claim) => (
                  <div key={claim.claimId} className={`bg-black/30 p-8 rounded-[2.5rem] border transition-all relative overflow-hidden ${claim.status === 'REJECTED' ? 'border-red-500/30' : 'border-neutral-800 hover:border-amber-500/20'}`}>
                    <div className="flex justify-between items-start mb-6">
                      <div className="p-3 bg-neutral-950 rounded-[1.5rem] border border-neutral-900 shadow-inner">
                         <span className="text-[8px] font-black text-neutral-600 uppercase block mb-1">ORIGIN_NODE</span>
                         <div className="text-white font-bold text-[10px] uppercase tracking-tighter flex items-center gap-2">
                            {claim.sourceType}
                         </div>
                      </div>
                      <StatusBadge status={claim.status} />
                    </div>
                    
                    <div className="space-y-6">
                       <div>
                         <p className="text-xs font-black text-neutral-200 mb-1 uppercase tracking-tight">
                            {claim.sourceInfo?.label || `RÉF: ${claim.sourceId.slice(0, 12)}`}
                         </p>
                         <div className="flex items-center gap-2 text-neutral-500">
                            <span className="text-[9px] font-bold uppercase ">{claim.sourceInfo?.institution || "PRESTATAIRE_INCONNU"}</span>
                            <span className="text-neutral-800">•</span>
                            <span className="text-[9px] font-mono">{new Date(claim.sourceInfo?.date || Date.now()).toLocaleDateString()}</span>
                         </div>
                       </div>

                       <div className="bg-neutral-950/80 p-5 rounded-2xl border border-neutral-900 flex justify-between items-center shadow-inner">
                          <span className="text-[9px] font-black text-neutral-500 uppercase">Val_Certifiée</span>
                          <span className={`text-lg font-black ${claim.status === 'REJECTED' ? 'text-red-500 line-through' : 'text-amber-500'}`}>{claim.amountApproved || claim.amountRequested} DH</span>
                       </div>

                       {claim.status === "REJECTED" && (
                         <div className="p-4 bg-red-950/20 border border-red-500/30 rounded-2xl space-y-2">
                            <p className="text-[9px] text-red-400 font-black uppercase flex items-center gap-2">
                               <AlertCircle size={14} /> Motif de Refus Assurance
                            </p>
                            <p className="text-[10px] text-red-500 font-bold italic leading-relaxed">
                               "{claim.reason || "Dossier incomplet ou incohérence avec le Smart Contract."}"
                            </p>
                         </div>
                       )}

                       {claim.paymentReference && (
                         <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                            <CheckCircle2 className="text-emerald-500" size={16} />
                            <div>
                               <p className="text-[9px] text-emerald-500 font-black uppercase">Virement_Ref_Officiel</p>
                               <p className="text-[10px] font-mono text-emerald-400 font-bold">{claim.paymentReference}</p>
                            </div>
                         </div>
                       )}
                    </div>
                  </div>
                ))}
              </div>
              {claims.length === 0 && (
                <div className="text-center py-24 opacity-20 flex flex-col items-center grayscale">
                   <Landmark size={80} className="mb-6 stroke-1" />
                   <p className="text-xs font-black uppercase tracking-[0.4em]">AUCUN_FLUX_FINANCIER_SCANNÉ</p>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Notifications Overlay */}
      {status && (
        <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 p-6 rounded-3xl border shadow-2xl flex items-center gap-4 text-[10px] font-black animate-in slide-in-from-bottom-12 duration-500 z-[100] backdrop-blur-xl ${
          status.type === "success" ? "bg-emerald-950/90 border-emerald-400/50 text-emerald-400" : "bg-red-950/90 border-red-400/50 text-red-400"
        }`}>
          <div className={`p-2 rounded-xl ${status.type === 'success' ? 'bg-emerald-400/10' : 'bg-red-400/10'}`}>
            {status.type === "success" ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          </div>
          <div className="space-y-1">
            <p className="uppercase tracking-[0.2em]">{status.type === 'success' ? 'Transaction_Validée' : 'Erreur_Node'}</p>
            <p className="text-neutral-400 italic">"{status.msg}"</p>
          </div>
          <button onClick={() => setStatus(null)} className="ml-8 text-neutral-500 hover:text-white font-bold text-xs">ANNULER</button>
        </div>
      )}
    </div>
  );
}
