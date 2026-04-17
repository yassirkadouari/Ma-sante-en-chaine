import re

with open('/home/ramsis/Desktop/DOCUMENTATION/ma-sante-en-chaine/frontend/src/app/dashboard/hopital/page.tsx', 'r') as f:
    text = f.read()

target = """              <div>
                <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Détails de l'Acte</label>"""

replacement = """              {/* IPFS Network Config */}
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
                <label className="text-[10px] text-neutral-500 uppercase font-black mb-2 block tracking-widest">Détails de l'Acte</label>"""

text = text.replace(target, replacement)

with open('/home/ramsis/Desktop/DOCUMENTATION/ma-sante-en-chaine/frontend/src/app/dashboard/hopital/page.tsx', 'w') as f:
    f.write(text)

