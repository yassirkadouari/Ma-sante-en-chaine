import { Stethoscope, UserSearch, FilePlus2 } from "lucide-react";

export default function MedecinDashboard() {
  return (
    <div className="space-y-6 font-mono">
      <div className="flex justify-between items-center bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <div>
          <h1 className="text-2xl font-bold text-white">PORTAIL_MÉDECIN</h1>
          <p className="text-emerald-500 text-sm">NODE_AUTHORIZATION: Dr. Hassan Bennis [GRANT_LEVEL: HIGH]</p>
        </div>
        <button className="px-4 py-2 bg-emerald-600/10 border border-emerald-600/50 text-emerald-400 font-bold rounded flex items-center gap-2 hover:bg-emerald-600 hover:text-white transition">
          <FilePlus2 size={20} />
          [ INIT_PRESCRIPTION ]
        </button>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
          <UserSearch size={22} className="text-emerald-500" /> Identification Patient (QR)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 border border-dashed border-emerald-700/60 rounded-lg p-6 bg-neutral-950">
            <p className="text-neutral-400 text-sm font-mono mb-4">
              SCAN QR PATIENT -&gt; extraire patientId
            </p>
            <div className="flex flex-wrap gap-3">
              <button className="px-4 py-2 bg-emerald-600/10 border border-emerald-600/50 text-emerald-400 font-bold rounded hover:bg-emerald-600 hover:text-white transition">
                [ START_CAMERA ]
              </button>
              <button className="px-4 py-2 bg-neutral-800 border border-neutral-700 text-white font-bold rounded hover:bg-neutral-700 transition">
                [ UPLOAD_QR_IMAGE ]
              </button>
            </div>
            <p className="text-xs text-neutral-600 mt-3">
              POC: integration camera a faire (mediaDevices + decode QR).
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <label className="text-xs font-mono text-neutral-400">PATIENT_ID (fallback)</label>
            <input type="text" placeholder=">> PATIENT_ID" className="p-3 bg-neutral-950 border border-neutral-700 text-neutral-300 rounded focus:border-emerald-500 focus:outline-none" />
            <button className="px-4 py-2 bg-neutral-800 border border-neutral-700 text-white font-bold rounded hover:bg-neutral-700 transition">
              VALIDATE_PATIENT
            </button>
          </div>
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
          <Stethoscope size={22} className="text-neutral-500" /> Ledger d'Émission (Smart Contracts)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500">
                <th className="p-3">TX_HASH</th>
                <th className="p-3">PATIENT_ID</th>
                <th className="p-3">TIMESTAMP</th>
                <th className="p-3 text-right">CHAIN_STATUS</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-800/50 hover:bg-neutral-800/20">
                <td className="p-3 font-mono text-emerald-500">0x7F2...9A3C</td>
                <td className="p-3 text-neutral-300">Yassir M.</td>
                <td className="p-3 text-neutral-500">BLOCK: 849302</td>
                <td className="p-3 text-right"><span className="px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-xs">ACTIVE</span></td>
              </tr>
              <tr className="border-b border-neutral-800/50 hover:bg-neutral-800/20">
                <td className="p-3 font-mono text-emerald-500">0x3B1...4F0E</td>
                <td className="p-3 text-neutral-300">Fatima Z.</td>
                <td className="p-3 text-neutral-500">BLOCK: 849201</td>
                <td className="p-3 text-right"><span className="px-2 py-1 bg-neutral-800 text-neutral-400 border border-neutral-700 rounded text-xs">DELIVERED</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
