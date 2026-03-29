import { ShieldCheck, ArrowRightLeft, Database } from "lucide-react";

export default function AssuranceDashboard() {
  return (
    <div className="space-y-6 font-mono">
      <div className="flex justify-between items-center bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <div>
          <h1 className="text-2xl font-bold text-white">NOEUD_ASSURANCE</h1>
          <p className="text-amber-500 text-sm">SYS: Serveur Central CNSS [WEB3_SYNC: TRUE]</p>
        </div>
        <div className="px-4 py-2 bg-green-500/10 border border-green-500/30 text-green-400 font-bold rounded flex items-center gap-2 text-sm">
          <ShieldCheck size={18} />
          FRAUD_LEVEL: 0%
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-neutral-900/50 p-5 rounded-xl border border-neutral-800 text-center">
          <p className="text-neutral-500 text-xs mb-1">TX_PENDING</p>
          <p className="text-3xl font-extrabold text-amber-500 glitch-text">8</p>
        </div>
        <div className="bg-neutral-900/50 p-5 rounded-xl border border-neutral-800 text-center">
          <p className="text-neutral-500 text-xs mb-1">TOTAL_LIQUIDITY (24H)</p>
          <p className="text-3xl font-extrabold text-white">14,250 DH</p>
        </div>
        <div className="bg-neutral-950 p-5 rounded-xl border border-amber-900 shadow-[0_0_10px_rgba(245,158,11,0.1)] text-center flex flex-col justify-center text-white">
          <Database size={24} className="mx-auto mb-2 text-amber-500" />
          <p className="font-bold text-xs text-amber-400">CHAIN_SYNCHRONIZED</p>
        </div>
      </div>

      <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
        <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-white">
          <ArrowRightLeft className="text-amber-500" /> MEMPOOL: Preuves de Délivrance (Rust Events)
        </h2>
        
        <table className="w-full text-left border-collapse mt-4 text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-500">
              <th className="p-3">EVENT_HASH</th>
              <th className="p-3">VALIDATOR_NODE</th>
              <th className="p-3">AMOUNT_REQUIRED</th>
              <th className="p-3 text-right">EXECUTION</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-800/50 hover:bg-neutral-800/20">
              <td className="p-3 font-mono text-amber-500/80"><ScanProofIcon/> 0x992...FEA1</td>
              <td className="p-3 text-neutral-300">Pharmacie du Centre</td>
              <td className="p-3 font-bold text-amber-400">340 DH</td>
              <td className="p-3 text-right">
                <button className="px-3 py-1.5 bg-amber-600/20 border border-amber-600/50 text-amber-400 font-bold text-xs rounded hover:bg-amber-600 hover:text-white transition">TRANSFER_FUNDS()</button>
              </td>
            </tr>
            <tr className="border-b border-neutral-800/50 opacity-50">
              <td className="p-3 font-mono text-amber-500/80"><ScanProofIcon/> 0x114...BB89</td>
              <td className="p-3 text-neutral-300">Pharmacie Al Amal</td>
              <td className="p-3 font-bold text-amber-400">120 DH</td>
              <td className="p-3 text-right">
                <span className="px-3 py-1.5 text-neutral-500 border border-neutral-700 font-bold text-xs rounded bg-neutral-900">SETTLED</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScanProofIcon() {
  return <ShieldCheck size={14} className="inline text-green-500 mr-1" />;
}
