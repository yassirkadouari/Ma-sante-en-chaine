with open('/home/ramsis/Desktop/DOCUMENTATION/ma-sante-en-chaine/frontend/src/app/dashboard/labo/page.tsx', 'r') as f:
    text = f.read()

old_imports = """import { useState, useRef } from "react";
import { Microscope, Search, User, FileText, CheckCircle2, AlertCircle, Upload, Banknote, Activity } from "lucide-react";
import { apiRequest } from "../../../lib/api";"""

new_imports = """import { useState, useRef } from "react";
import { Microscope, Search, User, FileText, CheckCircle2, AlertCircle, Upload, Banknote, Activity, ShieldCheck } from "lucide-react";
import { apiRequest } from "../../../lib/api";
import { uploadJsonToIpfs } from "@/lib/ipfsClient";
import { encryptMedicalPayload } from "@/lib/medicalCrypto";"""

old_state = """  const [status, setStatus] = useState<{ type: "success" | "error", msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Archive Search State"""

new_state = """  const [status, setStatus] = useState<{ type: "success" | "error", msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [encryptionPassphrase, setEncryptionPassphrase] = useState("");
  const [enableIpfs, setEnableIpfs] = useState(true);

  // Archive Search State"""

old_submit = """        const formData = new FormData();
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
        });"""

new_submit = """        let documentCid: string | undefined;
        
        if (enableIpfs && file) {
          if (encryptionPassphrase.trim().length > 0 && encryptionPassphrase.trim().length < 8) {
            throw new Error("La passphrase de chiffrement IPFS doit contenir au moins 8 caractères.");
          }
          
          const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(f);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
          });
          
          const pdfBase64 = await toBase64(file);
          
          const documentPayload = {
            patientWallet,
            testType,
            resultSummary,
            amountClaim: amountClaim ? Number(amountClaim) : 0,
            documentData: pdfBase64,
            fileName: file.name
          };

          const encrypted = await encryptMedicalPayload(documentPayload, encryptionPassphrase);
          const uploaded = await uploadJsonToIpfs(encrypted, `labo-event-${Date.now()}.json`);
          documentCid = uploaded.cid;
        }

        const response = await apiRequest<{ eventId: string }>({
          method: "POST",
          path: "/labo/results",
          signed: true,
          body: {
            patientWallet,
            testType,
            resultSummary,
            amountClaim: amountClaim ? Number(amountClaim) : 0,
            documentCid: documentCid || `pending-file:${file.name}`
          }
        });

        setStatus({ 
          type: "success", 
          msg: `Résultat enregistré et ancré sur Blockchain. ID: ${response.eventId.slice(0, 8)}` 
        });"""


old_ui = """              <div>
                <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Observations ou Métadonnées</label>"""

new_ui = """              {/* IPFS Network Config */}
              <div className="bg-neutral-900/50 p-4 border border-neutral-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-500" />
                    <span className="text-[10px] text-blue-500 uppercase font-black tracking-widest">Ancrage IPFS Sécurisé</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={enableIpfs} onChange={e => setEnableIpfs(e.target.checked)} />
                    <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-300 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                {enableIpfs && (
                  <input
                    type="password"
                    placeholder="PASSPHRASE DE CHIFFREMENT HORS-LIGNE (OPTIONNEL)"
                    value={encryptionPassphrase}
                    onChange={(e) => setEncryptionPassphrase(e.target.value)}
                    className="w-full bg-black border border-neutral-800 p-3 rounded-lg text-[10px] text-white outline-none focus:border-blue-500/50 transition-all font-black uppercase tracking-widest placeholder:text-neutral-700"
                  />
                )}
              </div>

              <div>
                <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Observations ou Métadonnées</label>"""

text = text.replace(old_imports, new_imports)
text = text.replace(old_state, new_state)
text = text.replace(old_submit, new_submit)
text = text.replace(old_ui, new_ui)

import re
text = re.sub(r'import { loadSession } from "../../../lib/session";\n', '', text)
text = re.sub(r'const session = loadSession\(\);\n', '', text)

with open('/home/ramsis/Desktop/DOCUMENTATION/ma-sante-en-chaine/frontend/src/app/dashboard/labo/page.tsx', 'w') as f:
    f.write(text)

print("Patch applied to labo!")
