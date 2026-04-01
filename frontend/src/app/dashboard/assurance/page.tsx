"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, CheckCircle2, XCircle, Landmark, Activity, User, FileSearch, Banknote, AlertCircle, Search } from "lucide-react";
import { apiRequest } from "@/lib/api";

type ClaimItem = {
  claimId: string;
  sourceType: "PRESCRIPTION" | "VISIT" | "OPERATION";
  sourceId: string;
  patientWallet: string;
  providerWallet?: string;
  providerRole?: string;
  amountRequested: number;
  amountApproved?: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED";
  paymentReference?: string;
  reimbursedAt?: string;
  verification?: {
    anchorValid?: boolean;
    anchorStatus?: string;
    method?: string;
  };
  createdAt: string;
};

const SOURCE_ICONS: any = {
  PRESCRIPTION: Landmark,
  VISIT: Activity,
  OPERATION: ShieldCheck,
  LAB_TEST: Beaker,
  HOSPITAL_STAY: Hospital
};

import { Hospital, Beaker } from "lucide-react";

export default function AssuranceDashboard() {
  const [items, setItems] = useState<ClaimItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [decisionReason, setDecisionReason] = useState("");
  const [approveAmount, setApproveAmount] = useState("");
  const [targetClaim, setTargetClaim] = useState<ClaimItem | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error", msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const response = await apiRequest<{ items: ClaimItem[] }>({ 
        path: `/claims?status=${statusFilter === "ALL" ? "" : statusFilter}` 
      });
      setItems(response.items || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refresh();
  }, [statusFilter]);

  const reviewClaim = async (decision: "APPROVED" | "REJECTED") => {
    if (!targetClaim) return;
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "PATCH",
        path: `/claims/${targetClaim.claimId}/review`,
        signed: true,
        body: {
          decision,
          amountApproved: decision === "APPROVED" ? Number(approveAmount || targetClaim.amountRequested) : 0,
          reason: decisionReason || undefined
        }
      });
      setStatus({ type: "success", msg: `Dossier ${targetClaim.claimId.slice(0, 8)} ${decision === 'APPROVED' ? 'Approuvé' : 'Rejeté'}.` });
      setTargetClaim(null);
      setDecisionReason("");
      setApproveAmount("");
      refresh();
    } catch (error: any) {
      setStatus({ type: "error", msg: error.message });
    } finally {
      setBusy(false);
    }
  };

  const reimburseClaim = async (claimId: string) => {
    try {
      setBusy(true);
      setStatus(null);
      const response = await apiRequest<{ paymentReference: string }>({
        method: "POST",
        path: `/claims/${claimId}/reimburse`,
        signed: true
      });
      setStatus({ type: "success", msg: `Virement effectué. Réf: ${response.paymentReference}` });
      refresh();
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
            <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
              <Landmark className="text-amber-500" size={24} />
            </div>
            <h1 className="text-3xl font-black text-white tracking-tighter">INSURE_NODE</h1>
          </div>
          <p className="text-neutral-500 text-[10px] uppercase tracking-widest font-bold">Moteur de Remboursement • Validation Blockchain</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center gap-3">
             <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
             <span className="text-[10px] text-neutral-400 font-black">LIQUIDITÉ_OK</span>
          </div>
          <div className="px-4 py-2 bg-amber-600/10 border border-amber-600/30 text-amber-400 font-bold rounded-xl flex items-center gap-2 text-xs">
            <ShieldCheck size={16} /> AUDIT_MODE
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center bg-black/40 p-4 rounded-2xl border border-neutral-800">
             <div className="flex gap-2">
               {["PENDING", "APPROVED", "REIMBURSED", "ALL"].map(f => (
                 <button 
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all ${statusFilter === f ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/20' : 'bg-neutral-900 text-neutral-500 hover:text-neutral-300'}`}
                 >
                   {f}
                 </button>
               ))}
             </div>
             <Search className="text-neutral-700" size={18} />
          </div>

          <div className="bg-neutral-900/50 rounded-[2rem] border border-neutral-800 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-black/40 text-neutral-500 font-black uppercase tracking-widest">
                  <tr>
                    <th className="p-4">Dossier</th>
                    <th className="p-4">Patient</th>
                    <th className="p-4">Provenance</th>
                    <th className="p-4">Montant</th>
                    <th className="p-4">Blockchain</th>
                    <th className="p-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/40">
                  {items.map((item) => (
                    <tr key={item.claimId} className={`hover:bg-neutral-800/30 transition-colors ${targetClaim?.claimId === item.claimId ? 'bg-amber-500/5 border-l-4 border-l-amber-500' : ''}`}>
                      <td className="p-4">
                        <p className="font-bold text-white">{item.claimId.slice(0, 8)}</p>
                        <p className="text-[9px] text-neutral-500 uppercase">{item.createdAt.slice(0, 10)}</p>
                      </td>
                      <td className="p-4 text-neutral-400 font-mono italic">
                        {item.patientWallet.slice(0, 8)}...
                      </td>
                      <td className="p-4 text-neutral-500 font-mono text-[10px]">
                        <div className="flex items-center gap-2 uppercase font-black tracking-tighter">
                           {(() => {
                             const Icon = SOURCE_ICONS[item.sourceType] || Landmark;
                             return <Icon size={12} className="text-amber-500/50" />;
                           })()}
                           {item.sourceType}
                        </div>
                      </td>
                      <td className="p-4 font-bold text-amber-500 text-lg">{item.amountRequested} DH</td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-[8px] font-black tracking-widest ${item.verification?.anchorValid ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                          {item.verification?.anchorValid ? 'CERTIFIÉ' : 'WARNING_HASH'}
                        </span>
                      </td>
                      <td className="p-4">
                        {item.status === "PENDING" && (
                          <button onClick={() => setTargetClaim(item)} className="text-blue-400 hover:text-blue-300 font-bold underline decoration-blue-500/30 underline-offset-4 uppercase text-[10px]">EXAMINER</button>
                        )}
                        {item.status === "APPROVED" && (
                          <button onClick={() => reimburseClaim(item.claimId)} className="bg-amber-600/20 border border-amber-600/50 text-amber-500 px-3 py-1 rounded text-[10px] font-black hover:bg-amber-600 hover:text-white transition-all uppercase">VIREMENT</button>
                        )}
                        {item.status === "REIMBURSED" && (
                          <span className="text-neutral-600 text-[10px] font-bold">PAYÉ</span>
                        )}
                        {item.status === "REJECTED" && (
                          <span className="text-red-900 text-[10px] font-bold uppercase tracking-widest">REJETÉ</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={6} className="p-20 text-center text-neutral-600 italic">Aucune demande trouvée.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Action Panel */}
        <div className="space-y-6">
          {targetClaim ? (
            <div className="bg-white rounded-[2rem] p-8 shadow-2xl shadow-amber-500/20 text-black space-y-6 animate-in zoom-in-95 duration-300 border-4 border-amber-500/10">
               <div className="flex items-center gap-3 border-b border-neutral-100 pb-4">
                 <FileSearch className="text-amber-600" size={24} />
                 <h2 className="font-black text-lg tracking-tight uppercase">Audit du Claim</h2>
               </div>
               
               <div className="space-y-4">
                 <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-100">
                    <p className="text-[9px] text-neutral-400 uppercase font-black mb-2 tracking-widest">Source de Provenance</p>
                    <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-neutral-100 mb-4">
                       <Landmark className="text-amber-600" size={32} />
                       <div>
                          <p className="text-xs font-black uppercase text-amber-600">{targetClaim.sourceType}</p>
                          <p className="text-[9px] text-neutral-400 font-mono">ID: {targetClaim.sourceId.slice(0, 16)}...</p>
                       </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-bold flex justify-between"><span>Patient:</span> <span className="font-mono">{targetClaim.patientWallet.slice(0, 12)}...</span></p>
                      <p className="text-xs font-bold flex justify-between"><span>Prestataire:</span> <span className="font-mono">{targetClaim.providerWallet?.slice(0, 12)}...</span> ({targetClaim.providerRole})</p>
                      <p className="text-xs font-bold flex justify-between pt-2 border-t border-neutral-100"><span>Montant Demandé:</span> <span className="text-amber-600 font-black">{targetClaim.amountRequested} DH</span></p>
                    </div>
                 </div>

                 <div className="space-y-4">
                    <div>
                      <label className="text-[10px] text-neutral-400 uppercase font-black mb-1 block">Décision de Remboursement (DH)</label>
                      <input 
                        value={approveAmount}
                        onChange={(e) => setApproveAmount(e.target.value)}
                        placeholder={String(targetClaim.amountRequested)}
                        className="w-full p-4 bg-neutral-100 border border-neutral-200 rounded-2xl text-xl font-black outline-none focus:border-amber-500 transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-neutral-400 uppercase font-black mb-1 block">Observation Audit</label>
                      <textarea 
                        value={decisionReason}
                        onChange={(e) => setDecisionReason(e.target.value)}
                        placeholder="Détaillez ici la raison de la validation ou du rejet..."
                        className="w-full h-24 p-4 bg-neutral-100 border border-neutral-200 rounded-2xl text-xs outline-none focus:border-amber-500 transition-all resize-none"
                      />
                    </div>
                 </div>

                 <div className="grid grid-cols-2 gap-3 pt-4">
                   <button onClick={() => reviewClaim("APPROVED")} disabled={busy} className="py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl transition-all shadow-lg shadow-emerald-200 flex flex-col items-center justify-center gap-1">
                     <CheckCircle2 size={18} />
                     <span className="text-[10px] uppercase font-black">Approuver</span>
                   </button>
                   <button onClick={() => reviewClaim("REJECTED")} disabled={busy} className="py-4 bg-red-600 hover:bg-red-700 text-white font-black rounded-2xl transition-all shadow-lg shadow-red-200 flex flex-col items-center justify-center gap-1">
                     <XCircle size={18} />
                     <span className="text-[10px] uppercase font-black">Rejeter</span>
                   </button>
                 </div>
                 <button onClick={() => setTargetClaim(null)} className="w-full text-[10px] font-black text-neutral-400 uppercase tracking-widest hover:text-black transition-colors py-2">Fermer l'Audit</button>
               </div>
            </div>
          ) : (
            <div className="bg-neutral-900/50 p-10 rounded-[2rem] border border-neutral-800 space-y-6 text-center opacity-30 flex flex-col items-center border-dashed">
               <div className="p-4 bg-neutral-800 rounded-3xl"><FileSearch size={32} className="text-neutral-600" /></div>
               <p className="text-[10px] text-neutral-500 uppercase font-black leading-relaxed max-w-[200px]">Sélectionnez un claim pour voir l'historique médical ancré sur blockchain.</p>
            </div>
          )}

          <div className="bg-amber-600/5 border border-amber-600/20 p-6 rounded-[2rem] space-y-4">
             <div className="flex items-center gap-3">
               <Landmark size={20} className="text-amber-500" />
               <h3 className="font-black text-white text-xs uppercase tracking-widest">Guide des Honoraires</h3>
             </div>
             <div className="space-y-2">
                <div className="flex justify-between text-[9px] font-bold">
                   <span className="text-neutral-500">CONSULTATIONS</span>
                   <span className="text-white">Ramb : 80%</span>
                </div>
                <div className="flex justify-between text-[9px] font-bold">
                   <span className="text-neutral-500">MÉDICAMENTS</span>
                   <span className="text-white">Ramb : 70-100%</span>
                </div>
                <div className="flex justify-between text-[9px] font-bold">
                   <span className="text-neutral-500">HOSPITALISATION</span>
                   <span className="text-white">Ramb : 90%</span>
                </div>
             </div>
          </div>
        </div>
      </div>

      {status && (
        <div className={`fixed bottom-6 right-6 p-4 rounded-2xl border shadow-2xl flex items-center gap-3 text-xs animate-in slide-in-from-bottom-4 duration-300 font-black ${
          status.type === "success" ? "bg-amber-950/80 backdrop-blur border-amber-500/50 text-amber-400" : "bg-red-950/80 backdrop-blur border-red-500/50 text-red-400"
        }`}>
          {status.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {status.msg}
        </div>
      )}
    </div>
  );
}
