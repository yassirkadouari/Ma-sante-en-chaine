"use client";

import { useState } from "react";
import { QrCode, ClipboardCheck, ShieldAlert, CheckCircle2, PlusCircle, Trash2 } from "lucide-react";

export default function PharmacieDashboard() {
  const [itemName, setItemName] = useState("");
  const [itemPerDay, setItemPerDay] = useState("1");
  const [items, setItems] = useState<Array<{ name: string; perDay: string }>>([]);

  const addItem = () => {
    if (!itemName.trim()) {
      return;
    }

    setItems((prev) => [
      ...prev,
      { name: itemName.trim(), perDay: itemPerDay.trim() || "1" }
    ]);
    setItemName("");
    setItemPerDay("1");
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  return (
    <div className="space-y-6 font-mono">
      <div className="flex justify-between items-center bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <div>
          <h1 className="text-2xl font-bold text-white">NOEUD_PHARMACIE</h1>
          <p className="text-purple-500 text-sm">SYS: Pharmacie du Centre [WEB3_SYNC: TRUE]</p>
        </div>
        <div className="px-4 py-2 bg-purple-500/10 border border-purple-500/30 text-purple-400 font-bold rounded flex items-center gap-2 text-sm">
          <QrCode size={18} />
          SCANNER_PRET
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
          <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
            <QrCode className="text-purple-500" /> SCAN_PATIENT
          </h2>
          <div className="flex gap-2 mb-4">
            <input type="text" placeholder=">> SCAN..." className="flex-1 bg-neutral-950 p-3 border border-neutral-700 text-purple-400 rounded text-center focus:border-purple-500 outline-none" />
            <button className="bg-purple-600/20 border border-purple-600 text-purple-400 px-4 py-3 rounded hover:bg-purple-600 hover:text-white transition font-bold">
              EXECUTE
            </button>
          </div>
          <div className="border-4 border-dashed border-neutral-700 h-48 rounded-lg flex items-center justify-center text-neutral-500 bg-neutral-950">
            [ POINT_CAMERA_HERE ]
          </div>
        </div>

        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 flex flex-col justify-between">
          <div>
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
              <ClipboardCheck className="text-emerald-500" /> VALIDATION_SMART_CONTRACT
            </h2>
            <div className="bg-neutral-950 p-4 border border-emerald-900/50 rounded-lg mb-4 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-neutral-500">HASH: 0x8F4...2A9C</span>
                <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded font-bold">STATUT: ACTIVE</span>
              </div>
              <p className="text-emerald-400 mb-6 flex items-center gap-1 text-xs"><CheckCircle2 size={14} /> AUTHENTIC (Dr. Bennis)</p>
              
              <div className="bg-black p-3 rounded border border-neutral-800">
                <p className="text-xs text-neutral-500 mb-2 border-b border-neutral-800 pb-2">DECRYPTED_PAYLOAD:</p>
                <ul className="list-none text-sm space-y-2 text-neutral-300">
                  <li>&gt; Doliprane 1000mg x 1</li>
                  <li>&gt; Amoxicilline x 2</li>
                </ul>
              </div>
            </div>
          </div>
          <button className="w-full bg-emerald-600/20 border border-emerald-600 text-emerald-500 font-bold py-3 rounded hover:bg-emerald-600 hover:text-white transition text-sm flex justify-center items-center gap-2">
            <ShieldAlert size={18} />
            [ MUTATE_STATE: DELIVERED ] -&gt; NOTIFY_ASSURANCE
          </button>
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
          <ClipboardCheck className="text-purple-400" /> CREER_ORDONNANCE (PHARMACIE)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <input
            type="text"
            placeholder="MEDICAMENT"
            value={itemName}
            onChange={(event) => setItemName(event.target.value)}
            className="bg-neutral-950 p-3 border border-neutral-700 text-neutral-300 rounded focus:border-purple-500 outline-none"
          />
          <input
            type="text"
            placeholder="CONSOMMATION/JOUR"
            value={itemPerDay}
            onChange={(event) => setItemPerDay(event.target.value)}
            className="bg-neutral-950 p-3 border border-neutral-700 text-neutral-300 rounded focus:border-purple-500 outline-none"
          />
          <button
            type="button"
            onClick={addItem}
            className="px-4 py-2 bg-purple-600/20 border border-purple-600 text-purple-400 font-bold rounded hover:bg-purple-600 hover:text-white transition flex items-center justify-center gap-2"
          >
            <PlusCircle size={18} /> ADD_ITEM
          </button>
        </div>
        <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-4">
          {items.length === 0 ? (
            <p className="text-xs text-neutral-500">Aucun medicament ajoute.</p>
          ) : (
            <ul className="space-y-2 text-sm text-neutral-300">
              {items.map((item, index) => (
                <li key={`${item.name}-${index}`} className="flex items-center justify-between border border-neutral-800 rounded px-3 py-2">
                  <span>
                    {item.name} x {item.perDay} / jour
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="px-4 py-2 bg-emerald-600/20 border border-emerald-600 text-emerald-500 font-bold rounded hover:bg-emerald-600 hover:text-white transition"
          >
            CREATE_ORDONNANCE
          </button>
          <p className="text-xs text-neutral-600 flex items-center">
            POC: creation locale seulement, pas encore liee au backend.
          </p>
        </div>
      </div>
    </div>
  );
}
