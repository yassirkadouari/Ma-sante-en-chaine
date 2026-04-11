"use client";

import { useEffect, useState } from "react";
import { FilePlus2, ShieldCheck, FileText, UserSearch, ClipboardList, Activity, CheckCircle2, AlertCircle } from "lucide-react";
import { uploadJsonToIpfs } from "@/lib/ipfsClient";
import { encryptMedicalPayload, sha256HexFromObject } from "@/lib/medicalCrypto";
import { connectWallet } from "@/lib/wallet";

type PrescriptionSummary = {
  recordId: string;
  patientWallet: string;
  pharmacyWallet: string | null;
  ipfsCid?: string | null;
  version: number;
  status: string;
  blockchainHash?: string;
};

type AnchorApiItem = {
  recordId: string;
  hash: string;
  cid: string;
  ownerWallet: string;
  doctorWallet: string;
  pharmacyWallet?: string | null;
  status: string;
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
  const blockchainApiBase = (process.env.NEXT_PUBLIC_BLOCKCHAIN_API_URL || "http://localhost:4600").replace(/\/$/, "");
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
  
  const [prescData, setPrescData] = useState({
    ordonnanceText: "",
    medications: "Ex: Paracétamol 1g (3x/j)",
    instructions: "Repos complet 3 jours."
  });
  const [enableIpfs, setEnableIpfs] = useState(true);
  const [encryptionPassphrase, setEncryptionPassphrase] = useState("");

  const refresh = async () => {
    try {
      const response = await fetch(`${blockchainApiBase}/anchors`);
      if (!response.ok) {
        throw new Error(`Blockchain API error (${response.status})`);
      }

      const payload = (await response.json()) as { items?: AnchorApiItem[] };
      const mapped: PrescriptionSummary[] = (payload.items || []).map((item) => ({
        recordId: item.recordId,
        patientWallet: item.ownerWallet,
        pharmacyWallet: item.pharmacyWallet || null,
        ipfsCid: item.cid || null,
        version: 1,
        status: item.status || "PRESCRIBED",
        blockchainHash: item.hash,
      }));

      setItems(mapped);
    } catch (err) {
      console.error("Fetch failed", err);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const createTextPrescription = async () => {
    try {
      setBusy(true);
      setStatus(null);

      if (!patientWallet) throw new Error("L'adresse wallet du patient est obligatoire.");
      if (!prescData.ordonnanceText.trim()) throw new Error("Le contenu texte de l'ordonnance est obligatoire.");

      let ipfsMetadata: { cid: string; payloadHash: string; encryptionVersion?: string } | undefined;
      if (enableIpfs) {
        if (encryptionPassphrase.trim().length < 8) {
          throw new Error("La passphrase de chiffrement IPFS doit contenir au moins 8 caractères.");
        }

        const encryptedPayload = await encryptMedicalPayload(prescData, encryptionPassphrase);
        const payloadHash = await sha256HexFromObject(encryptedPayload);
        const uploaded = await uploadJsonToIpfs(encryptedPayload, `ordonnance-${Date.now()}.json`);

        ipfsMetadata = {
          cid: uploaded.cid,
          payloadHash,
          encryptionVersion: encryptedPayload.version
        };
      }

      const { walletAddress } = await connectWallet();
      const recordId = crypto.randomUUID();
      const anchorHash = ipfsMetadata?.payloadHash || (await sha256HexFromObject(prescData));

      const response = await fetch(`${blockchainApiBase}/anchors/store`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          recordId,
          hash: anchorHash,
          cid: ipfsMetadata?.cid || `pending:${recordId}`,
          ownerWallet: patientWallet,
          doctorWallet: walletAddress,
          pharmacyWallet: pharmacyWallet || undefined,
          authorizedWallets: [walletAddress, pharmacyWallet || ""].filter(Boolean),
          timestamp: Math.floor(Date.now() / 1000)
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Anchor store failed (${response.status})`);
      }

      const resBody = (await response.json()) as { anchor?: { hash?: string; cid?: string } };

      const responseHash = resBody.anchor?.hash || anchorHash;
      const responseCid = resBody.anchor?.cid || ipfsMetadata?.cid || null;
      const ipfsLabel = responseCid ? ` CID: ${responseCid.slice(0, 24)}...` : "";
      setStatus({ type: "success", msg: `Ordonnance émise & ancrée! Hash: ${responseHash.slice(0, 16)}...${ipfsLabel}` });
      setPatientWallet("");
      setPharmacyWallet("");
      setEncryptionPassphrase("");
      setPrescData({
        ordonnanceText: "",
        medications: "Ex: Paracétamol 1g (3x/j)",
        instructions: "Repos complet 3 jours."
      });
      refresh();
    } catch (error: any) {
      setStatus({ type: "error", msg: error.message });
    } finally {
      setBusy(false);
    }
  };

  const registerMedicalEvent = async () => {
    setStatus({ type: "info", msg: "Flux dossier médical non migré en mode 100% décentralisé (Node.js supprimé)." });
  };

  const fetchArchive = async () => {
    if (!searchWallet) return;
    setArchive(null);
    setStatus({ type: "info", msg: "Recherche archives non migrée sans backend. Utilise le registre blockchain pour le test." });
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
              <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Contenu texte de l'Ordonnance</label>
              <textarea
                value={prescData.ordonnanceText}
                onChange={(event) => setPrescData((prev) => ({ ...prev, ordonnanceText: event.target.value }))}
                placeholder="Ex: Patient X - Traitement: Paracétamol 1g matin/soir pendant 5 jours..."
                className="w-full min-h-[120px] p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 outline-none focus:border-emerald-500/50 transition-all text-sm"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Médicaments</label>
                <textarea
                  value={prescData.medications}
                  onChange={(event) => setPrescData((prev) => ({ ...prev, medications: event.target.value }))}
                  className="w-full min-h-[100px] p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 outline-none focus:border-emerald-500/50 transition-all text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase font-bold mb-1 block">Instructions</label>
                <textarea
                  value={prescData.instructions}
                  onChange={(event) => setPrescData((prev) => ({ ...prev, instructions: event.target.value }))}
                  className="w-full min-h-[100px] p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-200 outline-none focus:border-emerald-500/50 transition-all text-sm"
                />
              </div>
            </div>

            <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-3">
              <label className="flex items-center justify-between gap-3 text-[10px] text-neutral-400 uppercase font-bold tracking-widest">
                <span>Upload IPFS chiffré</span>
                <input
                  type="checkbox"
                  checked={enableIpfs}
                  onChange={(event) => setEnableIpfs(event.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>
              {enableIpfs ? (
                <input
                  type="password"
                  value={encryptionPassphrase}
                  onChange={(event) => setEncryptionPassphrase(event.target.value)}
                  placeholder="Passphrase de chiffrement (8+ caractères)"
                  className="w-full p-3 bg-black border border-neutral-800 rounded-xl text-neutral-200 outline-none focus:border-emerald-500/50 transition-all text-sm"
                />
              ) : null}
            </div>

            <button 
              disabled={busy || !patientWallet || (enableIpfs && encryptionPassphrase.trim().length < 8)} 
              onClick={createTextPrescription} 
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
                <th className="p-4">CID_IPFS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/40">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-neutral-600 italic">Aucune transaction ordonnance détectée.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.recordId} className="hover:bg-emerald-500/5 transition-colors">
                    <td className="p-4 font-mono text-emerald-400/80">{item.recordId.slice(0, 16)}...</td>
                    <td className="p-4 text-neutral-400 font-mono tracking-tighter">{item.patientWallet}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                        item.status === "PRESCRIBED" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                        (item.status === "DELIVERED" || item.status === "USED") ? "bg-neutral-800 text-neutral-500" :
                        "bg-red-500/10 text-red-500"
                      }`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="p-4 text-neutral-600 font-mono text-[10px]">{item.blockchainHash || "N/A"}</td>
                    <td className="p-4 text-neutral-600 font-mono text-[10px]">{item.ipfsCid || "N/A"}</td>
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
