"use client";

import { useCallback, useEffect, useState } from "react";
import { 
  FileText, HeartPulse, QrCode, Download, UserCircle, Activity,
  Stethoscope, Landmark, TestTube, Hotel, History,
  CheckCircle2, Clock, AlertCircle, TrendingUp, Info
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { loadSession } from "@/lib/session";
import { decryptMedicalPayload, type EncryptedPayload } from "@/lib/medicalCrypto";
import { QRCodeSVG } from "qrcode.react";

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
  status?: string;
  blockchainHash?: string;
  ipfsCid?: string | null;
  contentState?: "PENDING_IPFS" | "ENCRYPTED_LOCKED" | "DECRYPTED" | "PLAIN_IPFS" | "UNAVAILABLE";
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
    data: { diagnosis?: string; notes?: string; amountClaim?: number; };
    actorWallet?: string;
  }>;
  labResults: Array<{
    eventId: string;
    occurredAt: string;
    data: { testType: string; resultSummary: string; amountClaim?: number; pdfPath?: string; documentCid?: string };
    actorWallet: string;
  }>;
  pastOperations: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
    data: { operationName?: string; details?: string; department?: string; notes?: string; amountClaim?: number; pdfPath?: string; documentCid?: string };
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

type WalletIdentity = {
  fullName?: string | null;
  cabinetName?: string | null;
  institutionName?: string | null;
  departmentName?: string | null;
};

export default function PatientDashboard() {
  const [activeTab, setActiveTab] = useState<"presc" | "events" | "claims" | "profile">("presc");
  const [items, setItems] = useState<PrescriptionSummary[]>([]);
  const [medical, setMedical] = useState<MedicalMine | null>(null);
  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [newDoctorWallet, setNewDoctorWallet] = useState("");
  const [selectedPresc, setSelectedPresc] = useState<PrescriptionSummary | null>(null);
  const [selectedPrescDetails, setSelectedPrescDetails] = useState<PrescriptionDetails | null>(null);
  const [prescriptionPassphrase, setPrescriptionPassphrase] = useState("");
  const [loadingSelectedPresc, setLoadingSelectedPresc] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error", msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedEventDetails, setSelectedEventDetails] = useState<any | null>(null);
  const [identityByWallet, setIdentityByWallet] = useState<Record<string, WalletIdentity>>({});

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

  const resolveWalletIdentity = useCallback(async (walletAddress: string): Promise<WalletIdentity> => {
    const wallet = String(walletAddress || "").trim();
    if (!wallet) return {};

    try {
      const response = await fetch(`/api/identity/resolve/${encodeURIComponent(wallet)}`, {
        cache: "no-store",
      });
      if (!response.ok) return {};

      const payload = (await response.json()) as {
        fullName?: string | null;
        cabinetName?: string | null;
        institutionName?: string | null;
        departmentName?: string | null;
      };

      return {
        fullName: payload.fullName || null,
        cabinetName: payload.cabinetName || null,
        institutionName: payload.institutionName || null,
        departmentName: payload.departmentName || null,
      };
    } catch {
      return {};
    }
  }, []);

  useEffect(() => {
    const wallets = new Set<string>();
    const addWallet = (value?: string | null) => {
      const wallet = String(value || "").trim();
      if (wallet) wallets.add(wallet);
    };

    addWallet(medical?.profile?.primaryDoctorWallet || null);
    items.forEach((item) => addWallet(item.doctorWallet));
    medical?.labResults?.forEach((result) => addWallet(result.actorWallet));
    medical?.pastOperations?.forEach((event) => addWallet(event.actorWallet));
    medical?.visits?.forEach((visit) => addWallet(visit.actorWallet || null));

    const missingWallets = Array.from(wallets).filter((wallet) => !identityByWallet[wallet]);
    if (missingWallets.length === 0) return;

    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(
        missingWallets.map(async (wallet) => [wallet, await resolveWalletIdentity(wallet)] as const)
      );

      if (cancelled) return;
      setIdentityByWallet((previous) => {
        const next = { ...previous };
        for (const [wallet, identity] of resolved) {
          next[wallet] = identity;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [items, medical, identityByWallet, resolveWalletIdentity]);

  const loadSelectedPrescription = useCallback(
    async (passphrase?: string) => {
      if (!selectedPresc) {
        setSelectedPrescDetails(null);
        return;
      }

      try {
        setLoadingSelectedPresc(true);
        const key = String(passphrase || "").trim();
        const query = key ? `?passphrase=${encodeURIComponent(key)}` : "";
        const details = await apiRequest<PrescriptionDetails>({
          path: `/prescriptions/${selectedPresc.recordId}${query}`
        });
        setSelectedPrescDetails(details);
      } catch (error: any) {
        setSelectedPrescDetails(null);
        setStatus({ type: "error", msg: error.message || "Impossible de charger le contenu de l'ordonnance." });
      } finally {
        setLoadingSelectedPresc(false);
      }
    },
    [selectedPresc]
  );

  useEffect(() => {
    loadSelectedPrescription();
  }, [loadSelectedPrescription]);

  useEffect(() => {
    setPrescriptionPassphrase("");
  }, [selectedPresc?.recordId]);

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

  const requestEventClaim = async (eventId: string) => {
    try {
      setBusy(true);
      setStatus(null);
      await apiRequest({
        method: "POST",
        path: `/claims/events/${eventId}`,
        signed: true,
      });
      setStatus({ type: "success", msg: "Demande de remboursement evenement envoyee." });
      await refresh();
    } catch (error: any) {
      setStatus({ type: "error", msg: error.message || "Impossible d'envoyer la reclamation." });
    } finally {
      setBusy(false);
    }
  };

  const getClaimForSource = (sourceId: string) => {
    return claims.find(c => c.sourceId === sourceId);
  };

  const getProfessionalName = (walletAddress?: string | null) => {
    const wallet = String(walletAddress || "").trim();
    if (!wallet) return null;

    const fullName = String(identityByWallet[wallet]?.fullName || "").trim();
    if (fullName) return fullName;

    const institution = String(identityByWallet[wallet]?.institutionName || "").trim();
    if (institution) return institution;

    const department = String(identityByWallet[wallet]?.departmentName || "").trim();
    if (department) return department;

    const cabinet = String(identityByWallet[wallet]?.cabinetName || "").trim();
    return cabinet || null;
  };

  const getProfessionalCabinet = (walletAddress?: string | null) => {
    const wallet = String(walletAddress || "").trim();
    if (!wallet) return null;

    const cabinet = String(
      identityByWallet[wallet]?.cabinetName ||
      identityByWallet[wallet]?.institutionName ||
      identityByWallet[wallet]?.departmentName ||
      ""
    ).trim();

    return cabinet || null;
  };

  const looksLikeEncryptedPayload = (value: unknown): value is EncryptedPayload => {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return (
      String(item.version || "") === "msce-aes-256-gcm-v1" &&
      String(item.algorithm || "") === "AES-GCM" &&
      typeof item.saltB64 === "string" &&
      typeof item.ivB64 === "string" &&
      typeof item.ciphertextB64 === "string"
    );
  };

  const triggerDownload = (blob: Blob, fileName: string) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const cidFromValue = (value?: string | null) => {
    const raw = String(value || "").trim();
    if (!raw || raw.startsWith("pending-file:")) return "";

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        const parts = parsed.pathname.split("/").filter(Boolean);
        const ipfsIndex = parts.findIndex((part) => part.toLowerCase() === "ipfs");
        if (ipfsIndex >= 0 && parts[ipfsIndex + 1]) {
          return parts[ipfsIndex + 1];
        }
        return parts.at(-1) || "";
      } catch {
        return "";
      }
    }

    return raw;
  };

  const readPdfBlobFromIpfsDocument = async (cid: string): Promise<{ blob: Blob; fileName: string } | null> => {
    if (!cid) return null;

    const response = await fetch("/api/ipfs/read-json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cid }),
    });

    const payload = (await response.json()) as { payload?: unknown; error?: string };
    if (!response.ok || payload.payload === undefined) {
      throw new Error(payload.error || "Lecture IPFS impossible");
    }

    let documentPayload = payload.payload;
    if (looksLikeEncryptedPayload(documentPayload)) {
      const passphrase = window.prompt("Ce document est chiffre. Entrez la passphrase pour ouvrir le PDF.") || "";
      if (!passphrase.trim()) {
        throw new Error("Passphrase requise pour ouvrir ce document.");
      }
      documentPayload = await decryptMedicalPayload<Record<string, unknown>>(documentPayload, passphrase.trim());
    }

    if (!documentPayload || typeof documentPayload !== "object") {
      return null;
    }

    const record = documentPayload as Record<string, unknown>;
    const documentData = String(record.documentData || "").trim();
    if (!documentData.startsWith("data:")) {
      return null;
    }

    const blob = await fetch(documentData).then((result) => result.blob());
    const rawName = String(record.fileName || "").trim();
    const fileName = rawName || `document-${cid.slice(0, 12)}.pdf`;
    return { blob, fileName };
  };

  const downloadPdf = async (pathOrUrl: string, sourceDocumentCid?: string) => {
    const cid = cidFromValue(sourceDocumentCid) || cidFromValue(pathOrUrl);

    try {
      if (cid) {
        try {
          const ipfsPdf = await readPdfBlobFromIpfsDocument(cid);
          if (ipfsPdf) {
            triggerDownload(ipfsPdf.blob, ipfsPdf.fileName);
            return;
          }
        } catch (error: any) {
          const message = String(error?.message || "").toLowerCase();
          if (message.includes("passphrase")) {
            throw error;
          }
        }
      }

      if (!pathOrUrl) {
        throw new Error("Document introuvable");
      }

      const session = loadSession();
      const isAbsolute = /^https?:\/\//i.test(pathOrUrl);
      const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const url = isAbsolute ? pathOrUrl : `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;

      if (isAbsolute) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session?.token || ""}` }
      });
      if (!res.ok) throw new Error("Fichier introuvable");

      const blob = await res.blob();
      triggerDownload(blob, `document-${Date.now()}.pdf`);
    } catch (error: any) {
      setStatus({ type: "error", msg: error?.message || "Impossible de telecharger le document." });
    }
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
      APPROVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      PENDING: "bg-amber-500/10 text-amber-500 border-amber-500/20",
      REJECTED: "bg-red-500/10 text-red-500 border-red-500/20",
      REIMBURSED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      DELIVERED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      USED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      PRESCRIBED: "bg-sky-500/10 text-sky-400 border-sky-500/20"
    };

    const normalized = String(status || "").toUpperCase();
    const displayed = normalized === "DELIVERED" ? "USED" : normalized;

    return (
      <span className={`px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${colors[displayed] || colors[normalized] || "bg-neutral-800 text-neutral-500"}`}>
        {displayed}
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
                   <p className="text-[11px] font-bold text-white truncate">
                     {medical?.profile?.primaryDoctorWallet
                       ? (getProfessionalName(medical.profile.primaryDoctorWallet) || medical.profile.primaryDoctorWallet)
                       : "AUCUN_MÉDECIN_LIÉ"}
                   </p>
                   {medical?.profile?.primaryDoctorWallet && (
                     <p className="text-[9px] text-emerald-400/80 uppercase tracking-wide font-black mt-1 truncate">
                       Cabinet: {getProfessionalCabinet(medical.profile.primaryDoctorWallet) || "NON RENSEIGNE"}
                     </p>
                   )}
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
          { id: "profile", label: "Mon Dossier", icon: UserCircle },
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
                        const doctorName = getProfessionalName(item.doctorWallet);
                        const doctorCabinet = getProfessionalCabinet(item.doctorWallet);
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
                            <p className="text-[10px] text-neutral-500 tracking-tighter italic">Docteur: {doctorName || item.doctorWallet.slice(0, 16) + "..."}</p>
                            <p className="text-[9px] text-emerald-500/70 mb-4 uppercase tracking-wide font-black">Cabinet: {doctorCabinet || "NON RENSEIGNE"}</p>
                            
                            <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
                              {(item.status === "DELIVERED" || item.status === "USED") && !claim && (
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
                           <QRCodeSVG
                             value={`msc:prescription:${selectedPresc.recordId}`}
                             size={192}
                             includeMargin
                             bgColor="#f5f5f5"
                             fgColor="#111111"
                           />
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
                       {selectedPrescDetails?.contentState === "ENCRYPTED_LOCKED" ? (
                         <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-3">
                           <p className="text-[9px] text-neutral-500 font-black uppercase tracking-[0.15em]">Dechiffrement</p>
                           <div className="flex gap-2">
                             <input
                               type="password"
                               value={prescriptionPassphrase}
                               onChange={(event) => setPrescriptionPassphrase(event.target.value)}
                               placeholder="Passphrase ordonnance"
                               className="flex-1 bg-white border border-neutral-300 p-2.5 rounded-xl text-[10px] text-neutral-900 outline-none focus:border-emerald-500/60 transition-all font-mono"
                             />
                             <button
                               onClick={() => loadSelectedPrescription(prescriptionPassphrase)}
                               disabled={loadingSelectedPresc || !prescriptionPassphrase.trim()}
                               className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider disabled:opacity-40"
                             >
                               Dechiffrer
                             </button>
                           </div>
                         </div>
                       ) : null}
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
                      const authorName = getProfessionalName(res.actorWallet) || `${res.actorWallet.slice(0, 14)}...`;
                      return (
                        <div onDoubleClick={() => setSelectedEventDetails({ type: "labResult", ...res, claim })} key={res.eventId} className="bg-black/30 p-8 rounded-[2rem] border border-neutral-800 hover:border-blue-500/30 transition-all flex flex-col h-full cursor-pointer select-none">
                          <div className="flex justify-between items-start mb-6">
                            <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20"><TestTube className="text-blue-500" size={28} /></div>
                            <div className="flex flex-col items-end gap-2">
                               <span className="text-[10px] text-neutral-500 font-black uppercase">{new Date(res.occurredAt).toLocaleDateString()}</span>
                               {claim && <StatusBadge status={`CLAIM_${claim.status}`} />}
                            </div>
                          </div>
                          <div className="flex-1">
                            <h3 className="text-blue-400 font-black text-sm uppercase tracking-widest mb-3">{res.data.testType}</h3>
                            <p className="text-[9px] text-emerald-400/70 font-black uppercase tracking-wider mb-3">Auteur: {authorName}</p>
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
                                <button onClick={() => downloadPdf(res.data.pdfPath || "", res.data.documentCid)} className="w-full py-3 bg-blue-600/10 border border-blue-500/30 text-blue-400 rounded-xl text-[10px] font-black hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2 uppercase tracking-tighter">
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
                        const authorName =
                          getProfessionalName(op.actorWallet) ||
                          String(op.data.department || "").trim() ||
                          "ETABLISSEMENT HOSPITALIER";
                       return (
                        <div
                          onDoubleClick={() => setSelectedEventDetails({ type: "operation", ...op, claim })}
                          key={op.eventId}
                          className="bg-black/30 p-8 rounded-[2rem] border border-neutral-800 hover:border-red-500/30 transition-all flex flex-col h-full cursor-pointer select-none"
                        >
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
                            <p className="text-[9px] text-emerald-400/70 font-black uppercase tracking-wider mb-3">Auteur: {authorName}</p>
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
                                <button onClick={() => downloadPdf(op.data.pdfPath || "", op.data.documentCid)} className="w-full py-3 bg-red-600/10 border border-red-500/30 text-red-400 rounded-xl text-[10px] font-black hover:bg-red-600 hover:text-white transition-all flex items-center justify-center gap-2 uppercase tracking-tighter">
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
                      const authorName = getProfessionalName(visit.actorWallet) || (visit.actorWallet ? `${visit.actorWallet.slice(0, 14)}...` : "INCONNU");
                      return (
                        <div
                          onDoubleClick={() => setSelectedEventDetails({ type: "visit", ...visit, actorWallet: visit.actorWallet, claim })}
                          key={visit.eventId}
                          className="flex gap-6 p-6 bg-black/40 rounded-[2rem] border border-neutral-800 hover:border-neutral-700 transition-all items-center group cursor-pointer select-none"
                        >
                          <div className="text-center min-w-[60px] bg-neutral-950 p-4 rounded-2xl border border-neutral-800 group-hover:bg-neutral-900 transition-colors">
                             <span className="text-2xl font-black text-white block leading-none">{new Date(visit.occurredAt).getDate()}</span>
                             <span className="text-[9px] text-neutral-500 uppercase font-black">{new Date(visit.occurredAt).toLocaleString('default', { month: 'short' })}</span>
                          </div>
                          <div className="flex-1 border-l border-neutral-800 pl-6">
                            <div className="flex items-center gap-4 mb-2">
                               <p className="text-xs font-black text-neutral-200 uppercase tracking-widest">{visit.data.diagnosis || "Synthèse Médicale"}</p>
                               {claim && <StatusBadge status={`CLAIM_${claim.status}`} />}
                            </div>
                            <p className="text-[9px] text-emerald-400/70 font-black uppercase tracking-wider mb-2">Auteur: {authorName}</p>
                            <p className="text-[10px] text-neutral-500 font-mono italic">"{visit.data.notes || "Dossier patient mis à jour via Node Sécurisé"}"</p>
                            <p className="text-[10px] text-amber-400/80 font-black uppercase tracking-wider mt-2">
                              Tarif: {Number(visit.data.amountClaim || 0) > 0 ? `${Number(visit.data.amountClaim || 0)} DH` : "Gratuit"}
                            </p>
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

                  {/* TAB: PROFILE */}
            {activeTab === "profile" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <section className="bg-neutral-900/50 rounded-[2.5rem] border border-neutral-800 p-8 shadow-xl">
                   <h2 className="text-xl font-black text-white flex items-center gap-3 mb-8 pb-4 border-b border-neutral-800">
                     <UserCircle className="text-indigo-500" /> DETAILS ABOUT ME (DOSSIER MÉDICAL)
                   </h2>
                   
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="bg-black/30 p-8 rounded-[2rem] border border-neutral-800">
                       <p className="text-[10px] text-neutral-500 font-black uppercase mb-4">Informations Biométriques</p>
                       <div className="space-y-4">
                         <div className="flex justify-between items-center border-b border-neutral-800 pb-2">
                           <span className="text-sm font-bold text-neutral-300">Groupe Sanguin</span>
                           <span className="text-lg font-black text-rose-500">{medical?.profile?.bloodType || "NON DÉFINI"}</span>
                         </div>
                         <div className="flex justify-between items-center border-b border-neutral-800 pb-2">
                           <span className="text-sm font-bold text-neutral-300">Âge Enregistré</span>
                           <span className="text-lg font-black text-white">{medical?.profile?.age ? `${medical?.profile.age} ans` : "NON DÉFINI"}</span>
                         </div>
                         <div className="flex justify-between items-center border-b border-neutral-800 pb-2">
                           <span className="text-sm font-bold text-neutral-300">Région Administrative</span>
                           <span className="text-lg font-black text-indigo-400">{medical?.profile?.region || "NON DÉFINI"}</span>
                         </div>
                       </div>
                     </div>

                     <div className="bg-black/30 p-8 rounded-[2rem] border border-neutral-800">
                       <p className="text-[10px] text-neutral-500 font-black uppercase mb-4">Historique des Pathologies</p>
                       {(!medical?.profile?.diseases || medical.profile.diseases.length === 0) ? (
                         <div className="text-center py-8 text-neutral-600 italic">Aucune pathologie chronique déclarée.</div>
                       ) : (
                         <ul className="space-y-3">
                           {medical.profile.diseases.map((d, i) => (
                             <li key={i} className="flex items-center gap-3">
                               <AlertCircle size={16} className="text-rose-500" />
                               <span className="font-bold text-neutral-200">{d}</span>
                             </li>
                           ))}
                         </ul>
                       )}
                     </div>
                   </div>

                   <h3 className="text-lg font-black text-white flex items-center gap-3 mt-12 mb-6 pb-2 border-b border-neutral-800">
                     <History className="text-blue-400" /> Consultations & Historique Global
                   </h3>
                   <div className="space-y-4">
                     {(medical?.visits?.length || 0) === 0 ? (
                       <div className="text-center p-8 bg-black/20 rounded-3xl border border-neutral-800 text-neutral-500 italic">
                         Aucune consultation enregistrée.
                       </div>
                     ) : (
                       medical?.visits.map((visit, i) => (
                         <div key={i} className="bg-black/30 p-4 lg:p-6 rounded-2xl border border-neutral-800 flex flex-col md:flex-row justify-between md:items-center gap-4">
                           <div className="flex items-center gap-4">
                             <div className="p-3 bg-blue-500/10 rounded-xl"><Stethoscope className="text-blue-500" size={24} /></div>
                             <div>
                               <p className="text-xs font-black text-neutral-400 mb-1">{new Date(visit.occurredAt).toLocaleDateString()}</p>
                               <p className="text-sm font-bold text-white">{visit.data?.diagnosis || "Consultation Générale"}</p>
                             </div>
                           </div>
                         </div>
                       ))
                     )}
                   </div>
                </section>
              </div>
            )}
          
      {/* MODAL FOR MEDICAL EVENT DOUBLE CLICK DETAILS */}
      {selectedEventDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 w-full max-w-2xl rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-neutral-800 flex justify-between items-center bg-black/40">
               <h2 className="text-xl font-black text-emerald-500 flex items-center gap-3">
                 <Info size={24} /> DÉTAILS DE L'ÉVÉNEMENT MÉDICAL
               </h2>
               <button onClick={() => setSelectedEventDetails(null)} className="p-2 hover:bg-neutral-800 rounded-full transition-colors text-neutral-500 hover:text-white">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
               </button>
            </div>
            
            <div className="p-8 overflow-y-auto space-y-6">
               <div className="grid grid-cols-2 gap-4">
                 <div className="bg-black/30 p-4 rounded-2xl border border-neutral-800">
                   <p className="text-[10px] uppercase font-black text-neutral-500 mb-1">Type d'Événement</p>
                   <p className="text-sm font-bold text-white">{selectedEventDetails.type === "labResult" ? "Résultat Laboratoire" : selectedEventDetails.type === "visit" ? "Visite Médicale" : "Intervention Hospitalière"}</p>
                 </div>
                 <div className="bg-black/30 p-4 rounded-2xl border border-neutral-800">
                   <p className="text-[10px] uppercase font-black text-neutral-500 mb-1">Date</p>
                   <p className="text-sm font-bold text-white">{new Date(selectedEventDetails.occurredAt).toLocaleString()}</p>
                 </div>
                 <div className="bg-black/30 p-4 rounded-2xl border border-neutral-800 col-span-2">
                   <p className="text-[10px] uppercase font-black text-neutral-500 mb-1">Identifiant Blockchain (EVENT ID)</p>
                   <p className="text-[11px] font-mono text-blue-400 break-all">{selectedEventDetails.eventId}</p>
                 </div>
                 <div className="bg-black/30 p-4 rounded-2xl border border-neutral-800 col-span-2">
                   <p className="text-[10px] uppercase font-black text-neutral-500 mb-1">Auteur (Professionnel/Établissement)</p>
                   <p className="text-[12px] font-bold text-emerald-400 break-all">
                     {getProfessionalName(selectedEventDetails.actorWallet) ||
                       String(selectedEventDetails?.data?.department || "").trim() ||
                       (selectedEventDetails.type === "operation" ? "ETABLISSEMENT HOSPITALIER" : selectedEventDetails.actorWallet) ||
                       "INCONNU"}
                   </p>
                   <p className="text-[10px] uppercase tracking-wider font-black text-emerald-300/70 mt-1">
                     Cabinet: {getProfessionalCabinet(selectedEventDetails.actorWallet) || "NON RENSEIGNE"}
                   </p>
                 </div>
               </div>

               <div className="bg-neutral-950 p-6 rounded-2xl border border-neutral-800 space-y-4">
                 <h3 className="text-xs font-black uppercase text-indigo-400 border-b border-neutral-800 pb-2 mb-4">Données Principales</h3>
                 {selectedEventDetails.data.testType && (
                   <div><span className="text-[11px] font-bold text-neutral-500">Test:</span> <span className="text-sm font-medium text-white">{selectedEventDetails.data.testType}</span></div>
                 )}
                 {selectedEventDetails.data.resultSummary && (
                   <div><span className="text-[11px] font-bold text-neutral-500">Résumé:</span> <span className="text-sm font-medium text-neutral-300">{selectedEventDetails.data.resultSummary}</span></div>
                 )}
                 {selectedEventDetails.data.operationName && (
                   <div><span className="text-[11px] font-bold text-neutral-500">Opération:</span> <span className="text-sm font-medium text-white">{selectedEventDetails.data.operationName}</span></div>
                 )}
                 {selectedEventDetails.data.details && (
                   <div><span className="text-[11px] font-bold text-neutral-500">Détails:</span> <span className="text-sm font-medium text-neutral-300">{selectedEventDetails.data.details}</span></div>
                 )}
                 {selectedEventDetails.data.department && (
                   <div><span className="text-[11px] font-bold text-neutral-500">Département:</span> <span className="text-sm font-medium text-white">{selectedEventDetails.data.department}</span></div>
                 )}
                 {selectedEventDetails.data.notes && (
                   <div><span className="text-[11px] font-bold text-neutral-500">Notes:</span> <span className="text-sm font-medium text-neutral-300">{selectedEventDetails.data.notes}</span></div>
                 )}
                 {selectedEventDetails.data.amountClaim !== undefined && (
                   <div>
                     <span className="text-[11px] font-bold text-neutral-500">Montant:</span>{" "}
                     <span className="text-sm font-medium text-amber-400">
                       {Number(selectedEventDetails.data.amountClaim || 0) > 0
                         ? `${Number(selectedEventDetails.data.amountClaim || 0)} DH`
                         : "Gratuit"}
                     </span>
                   </div>
                 )}
                 {selectedEventDetails.data.pdfPath && (
                   <div className="pt-4 mt-4 border-t border-neutral-800">
                     <p className="text-[11px] font-bold text-neutral-500 mb-2">Document Associé:</p>
                     <button onClick={() => downloadPdf(selectedEventDetails.data.pdfPath, selectedEventDetails.data.documentCid)} className="w-full py-2.5 bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded-xl text-xs font-black hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2">
                       <FileText size={16} /> VOIR / TÉLÉCHARGER IPFS PDF
                     </button>
                   </div>
                 )}
               </div>

               {!selectedEventDetails.claim && Number(selectedEventDetails?.data?.amountClaim || 0) > 0 && (
                 <div className="bg-emerald-900/10 p-6 rounded-2xl border border-emerald-500/20">
                   <h3 className="text-xs font-black uppercase text-emerald-400 border-b border-emerald-500/20 pb-2 mb-4 flex items-center gap-2"><Landmark size={14}/> Réclamation Assurance</h3>
                   <p className="text-[11px] text-neutral-400 mb-4">Montant remboursable detecte: <span className="text-white font-black">{Number(selectedEventDetails?.data?.amountClaim || 0)} DH</span></p>
                   <button
                     onClick={async () => {
                       await requestEventClaim(String(selectedEventDetails.eventId));
                       setSelectedEventDetails(null);
                     }}
                     disabled={busy}
                     className="w-full py-2.5 bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 rounded-xl text-xs font-black hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                   >
                     <Landmark size={14} /> RÉCLAMER A L'ASSURANCE
                   </button>
                 </div>
               )}

               {selectedEventDetails.claim && (
                 <div className="bg-amber-900/10 p-6 rounded-2xl border border-amber-500/20">
                   <h3 className="text-xs font-black uppercase text-amber-500 border-b border-amber-500/20 pb-2 mb-4 flex items-center gap-2"><Landmark size={14}/> Détails Réclamation Assurance</h3>
                   <div className="grid grid-cols-2 gap-4">
                     <div><span className="text-[10px] font-bold text-neutral-500">Claim ID:</span> <span className="text-[11px] font-mono text-neutral-300 block break-all">{selectedEventDetails.claim.claimId}</span></div>
                     <div><span className="text-[10px] font-bold text-neutral-500">Status:</span> <span className="text-[11px] font-mono text-amber-500 block font-bold block">{selectedEventDetails.claim.status}</span></div>
                     <div><span className="text-[10px] font-bold text-neutral-500">Montant Demandé:</span> <span className="text-sm font-bold text-white block">{selectedEventDetails.claim.amountRequested} DH</span></div>
                     {selectedEventDetails.claim.amountApproved !== undefined && (
                       <div><span className="text-[10px] font-bold text-neutral-500">Montant Approuvé:</span> <span className="text-sm font-bold text-emerald-400 block">{selectedEventDetails.claim.amountApproved} DH</span></div>
                     )}
                     {selectedEventDetails.claim.reason && (
                       <div className="col-span-2"><span className="text-[10px] font-bold text-neutral-500">Raison Réclamation:</span> <span className="text-sm text-neutral-300 block">{selectedEventDetails.claim.reason}</span></div>
                     )}
                   </div>
                 </div>
               )}
            </div>
          </div>
        </div>
      )}

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
