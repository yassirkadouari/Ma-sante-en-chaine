import Link from "next/link";
import { ShieldCheck, Database, Network, Activity } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-neutral-300 flex flex-col items-center justify-center p-8 relative overflow-hidden font-sans">
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-20 -z-10"></div>
      
      <main className="max-w-5xl w-full bg-neutral-900/50 backdrop-blur-md border border-neutral-800 shadow-2xl rounded-2xl p-10 text-center relative z-10">
        <div className="flex justify-center mb-6">
          <div className="p-4 bg-emerald-950/50 rounded-2xl border border-emerald-900/50 ring-1 ring-emerald-500/20">
            <ShieldCheck size={56} className="text-emerald-500 glitch-text" />
          </div>
        </div>
        <h1 className="text-5xl font-extrabold text-white mb-4 tracking-tight">
          MA SANTÉ EN CHAÎNE
        </h1>
        <p className="text-lg text-neutral-400 mb-10 max-w-2xl mx-auto font-mono text-sm">
          &gt; INITIALIZING SECURE BLOCKCHAIN HEALTHCARE NETWORK...
          <br/>
          Smart-contracts Rust for immutable prescriptions.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10 text-left">
          <div className="p-6 bg-neutral-950 border border-neutral-800 hover:border-emerald-500/50 rounded-xl flex flex-col justify-between transition-all group">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <Database className="text-blue-500" size={24} /> Patient Node
              </h2>
              <p className="text-neutral-400 mb-6 text-sm font-mono">Générez votre QR code unique et suivez vos remboursements via Oracle.</p>
            </div>
            <Link href="/login" className="text-center px-4 py-3 bg-blue-600/10 border border-blue-600/30 text-blue-400 font-mono font-bold rounded-lg hover:bg-blue-600 hover:text-white transition w-full">
              &gt; CONNECT_PATIENT
            </Link>        
          </div>

          <div className="p-6 bg-neutral-950 border border-neutral-800 hover:border-emerald-500/50 rounded-xl flex flex-col justify-between transition-all group">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <Network className="text-emerald-500" size={24} /> Doctor Node
              </h2>
              <p className="text-neutral-400 mb-6 text-sm font-mono">Émission de contrats intelligents Rust pour prescriptions scellées sur registre.</p>
            </div>
            <Link href="/login" className="text-center px-4 py-3 bg-emerald-600/10 border border-emerald-600/30 text-emerald-400 font-mono font-bold rounded-lg hover:bg-emerald-600 hover:text-white transition w-full">
              &gt; AUTH_MEDECIN
            </Link>
          </div>

          <div className="p-6 bg-neutral-950 border border-neutral-800 hover:border-emerald-500/50 rounded-xl flex flex-col justify-between transition-all group">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <Activity className="text-purple-500" size={24} /> Pharmacy Node
              </h2>
              <p className="text-neutral-400 mb-6 text-sm font-mono">Scan de validité Web3 et mutation d'état de l'ordonnance (Statut: DELIVERED).</p>
            </div>
            <Link href="/login" className="text-center px-4 py-3 bg-purple-600/10 border border-purple-600/30 text-purple-400 font-mono font-bold rounded-lg hover:bg-purple-600 hover:text-white transition w-full">
              &gt; TERMINAL_PHARMACIE
            </Link>     
          </div>

          <div className="p-6 bg-neutral-950 border border-neutral-800 hover:border-emerald-500/50 rounded-xl flex flex-col justify-between transition-all group">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Institution Nodes</h2>
              <p className="text-neutral-400 mb-6 text-sm font-mono">Réseau CHU (Hôpitaux) et vérification automatisée de liquidité (CNSS/Assurances).</p>
            </div>
            <div className="flex gap-3">
              <Link href="/login" className="text-center flex-1 px-4 py-3 bg-amber-600/10 border border-amber-600/30 text-amber-400 font-mono font-bold rounded-lg hover:bg-amber-600 hover:text-white transition">
                &gt; ASSURANCE
              </Link>
              <Link href="/login" className="text-center flex-1 px-4 py-3 bg-sky-600/10 border border-sky-600/30 text-sky-400 font-mono font-bold rounded-lg hover:bg-sky-600 hover:text-white transition">
                &gt; CHU / HOPITAL
              </Link>
            </div>
          </div>

          <div className="p-6 bg-neutral-950 border border-neutral-800 hover:border-red-500/50 rounded-xl flex flex-col justify-between transition-all group md:col-span-2">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Admin Node</h2>
              <p className="text-neutral-400 mb-6 text-sm font-mono">Gestion des roles wallet (ADMIN/PATIENT/MEDECIN/PHARMACIE/HOPITAL/LABO/ASSURANCE).</p>
            </div>
            <Link href="/login" className="text-center px-4 py-3 bg-red-600/10 border border-red-600/30 text-red-400 font-mono font-bold rounded-lg hover:bg-red-600 hover:text-white transition w-full">
              &gt; ADMIN_CONSOLE
            </Link>
          </div>
        </div>

        <div className="text-xs text-neutral-600 mt-8 border-t border-neutral-800 pt-8 flex flex-col md:flex-row justify-between items-center font-mono">
          <p>SYS_STATUS: <span className="text-emerald-500">ONLINE</span></p>
          <p className="mt-2 md:mt-0">DEV_TEAM: [ Yassir, Marouane, Ahmed, Matine ]</p>
        </div>
      </main>
    </div>
  );
}

