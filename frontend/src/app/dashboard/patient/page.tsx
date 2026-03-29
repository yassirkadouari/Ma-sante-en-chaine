import { QrCode, FileText, CheckCircle, Fingerprint } from "lucide-react";

export default function PatientDashboard() {
  return (
    <div className="space-y-6 font-mono">
      <h1 className="text-3xl font-bold text-white tracking-tight">PORTAIL_PATIENT</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800 flex flex-col justify-center items-center text-center relative overflow-hidden group">
          <div className="absolute -inset-10 bg-blue-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition duration-500 z-0"></div>
          <Fingerprint size={100} className="text-blue-500 mb-4 z-10 relative glitch-text" />
          <h2 className="font-bold text-lg text-white z-10 relative">IDENTITÉ_BLOCKCHAIN</h2>
          <p className="text-neutral-500 text-xs mt-2 z-10 relative">HASH: 0x9B42...F1A8</p>
          <div className="mt-4 w-full">
            <button className="w-full px-3 py-2 bg-blue-600/10 border border-blue-600/30 text-blue-400 font-mono font-bold rounded-lg hover:bg-blue-600 hover:text-white transition">
              GENERATE_QR_PATIENT
            </button>
            <p className="text-[10px] text-neutral-600 mt-2">POC: QR code a generer depuis patientId.</p>
          </div>
        </div>

        <div className="md:col-span-2 space-y-6">
          <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white"><FileText className="text-blue-500" /> Ordonnances récentes</h2>
            <ul className="space-y-3">
              <li className="flex justify-between items-center p-3 bg-neutral-950 border border-neutral-800 rounded-lg">
                <div>
                  <p className="font-semibold text-neutral-300">Dr. Alaoui (Généraliste)</p>
                  <p className="text-xs text-neutral-500">TIMESTAMP: 17112026</p>
                </div>
                <span className="px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-bold rounded">STATUS: DELIVERED</span>
              </li>
              <li className="flex justify-between items-center p-3 bg-neutral-950 border border-neutral-800 rounded-lg">
                <div>
                  <p className="font-semibold text-neutral-300">Dr. Bennis (Cardiologue)</p>
                  <p className="text-xs text-neutral-500">TIMESTAMP: 17122026</p>
                </div>
                <span className="px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-bold rounded">STATUS: ACTIVE</span>
              </li>
            </ul>
          </div>

          <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white"><CheckCircle className="text-green-500" /> Remboursements Auto</h2>
            <div className="p-4 border-l-2 border-blue-500 bg-blue-950/20 rounded flex justify-between">
              <div>
                <p className="font-bold text-neutral-300">TX_CNSS: #RX-8902</p>
                <p className="text-xs text-neutral-500">Pharmacie du Centre</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-green-400">+ 340 DH</p>
                <p className="text-[10px] text-green-600/50">TRANSFER_COMPLETE</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
