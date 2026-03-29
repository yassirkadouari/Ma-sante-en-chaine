import { Activity, Users, Database, Fingerprint } from "lucide-react";

export default function HopitalDashboard() {
  return (
    <div className="space-y-6 font-mono">
      <div className="flex justify-between items-center bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <div>
          <h1 className="text-2xl font-bold text-white">NOEUD_HOPITAL</h1>
          <p className="text-red-500 text-sm">SYS: CHU Hassan II [WEB3_SYNC: TRUE]</p>
        </div>
        <div className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-500 font-bold rounded flex items-center gap-2 text-sm">
          <Activity size={18} />
          URGENCES: OPEN
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-neutral-900/50 p-5 rounded-xl border border-neutral-800 text-center">
          <p className="text-neutral-500 text-xs mb-1">PATIENTS_ADMIS</p>
          <p className="text-3xl font-extrabold text-red-500 glitch-text">42</p>
        </div>
        <div className="bg-neutral-900/50 p-5 rounded-xl border border-neutral-800 text-center">
          <p className="text-neutral-500 text-xs mb-1">LITS_DISPONIBLES</p>
          <p className="text-3xl font-extrabold text-white">15/200</p>
        </div>
        <div className="bg-neutral-950 p-5 rounded-xl border border-red-900 shadow-[0_0_10px_rgba(239,68,68,0.1)] text-center flex flex-col justify-center text-white">
          <Database size={24} className="mx-auto mb-2 text-red-500" />
          <p className="font-bold text-xs text-red-400">DOSSIERS_SYNCED</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
          <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
            <Users className="text-red-500" /> DEPARTEMENTS
          </h2>
          <div className="space-y-3 mt-4 text-sm">
            <div className="flex justify-between items-center p-3 bg-neutral-950 border border-neutral-800 rounded">
              <span className="text-neutral-300 font-bold">Réanimation</span>
              <span className="text-red-500">98% CAPACITÉ</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-neutral-950 border border-neutral-800 rounded">
              <span className="text-neutral-300 font-bold">Pédiatrie</span>
              <span className="text-green-500">45% CAPACITÉ</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-neutral-950 border border-neutral-800 rounded">
              <span className="text-neutral-300 font-bold">Chirurgie</span>
              <span className="text-amber-500">70% CAPACITÉ</span>
            </div>
          </div>
        </div>

        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
          <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
            <Fingerprint className="text-red-500" /> IDENTIFICATION UNIQUE
          </h2>
          <div className="bg-black p-4 rounded-lg border border-neutral-800 font-mono text-xs text-green-500 whitespace-pre overflow-x-auto">
{`> INITIALISATION SCANNER...
> EN ATTENTE D'EMPRUNTE DIGITALE...
[||||||||||||........] 60%
> PATIENT TROUVÉ: 0x44A...9B2
> DÉCRYPTAGE DU DOSSIER MÉDICAL...
> SUCCÈS.`}
          </div>
          <button className="w-full mt-4 py-3 bg-red-600/20 border border-red-600 text-red-500 hover:bg-red-600 hover:text-white transition rounded font-bold text-sm">
            AUTH_PATIENT()
          </button>
        </div>
      </div>
    </div>
  );
}
