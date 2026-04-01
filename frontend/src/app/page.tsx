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

        <div className="flex flex-col items-center gap-6 mb-10">
          <div className="p-8 bg-neutral-950 border border-neutral-800 hover:border-emerald-500/50 rounded-2xl transition-all group max-w-lg w-full">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center justify-center gap-2 font-mono">
              <Network className="text-emerald-500" size={28} /> ACCÈS RÉSEAU UNIFIÉ
            </h2>
            <p className="text-neutral-400 mb-8 text-sm font-mono text-center">
              Connectez votre wallet pour accéder à votre espace santé (Patient, Médecin, Pharmacie, Assurance, Admin).
            </p>
            <Link href="/login" className="text-center block px-8 py-4 bg-emerald-600 border border-emerald-500 text-white font-mono font-bold rounded-xl hover:bg-emerald-500 hover:scale-105 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)]">
              &gt; CONNECTER_MON_WALLET
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

