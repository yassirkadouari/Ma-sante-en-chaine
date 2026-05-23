import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';

const WALLETS = [
  "5GnfLbWVRGGdYXC8MntaisxDMtwUXQPTqwQwhZePWRKM9guJ", // assurance
  "5EPAz4Mm9DQA5rULuWZzKLjt7Am15DKNduMQTa8ie5ys5wwb", // hopital
  "5FtDukpWk447WuDKujMQpiMYaJmXrbJc2Lxm9F2NgVVDmQJs", // labo
  "5CV8VpeutBJpGjUvDvzExG8xpZTHxUFTGQmd9coKQEwHQDTe", // marouane
  "5DqZQrwj1MSyRRudyXcTgBpUJiDXmw8i5262ubu5dFTowxi3", // medecin
  "5DA9kjhvMMVVWhBzeWcDtXx1meFJpUQc6VGE28vcZ7oLAm5C", // patient
  "5G1fFbDsoKTiGh3627suZK9gkQ7QfEB8aisTojQuXG76NLzS", // pharmacie
  "5H9bY2pgmMq6ZJRckUScqfVXEvwJ5qnh1x8hMnY3qHC8VFaG", // yassir
];

const AMOUNT = BigInt(1000) * BigInt(10) ** BigInt(12);

async function main() {
  console.log("Connecting to local node...");
  const wsProvider = new WsProvider('ws://127.0.0.1:9944');
  const api = await ApiPromise.create({ provider: wsProvider });
  
  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');
  
  console.log(`Funding wallets from Alice (${alice.address})...`);
  
  for (const wallet of WALLETS) {
    console.log(`Transferring to ${wallet}...`);
    try {
      const txHash = await api.tx.balances
        .transferKeepAlive(wallet, AMOUNT)
        .signAndSend(alice);
      console.log(`✅ ${wallet}`);
    } catch (e) {
      console.error(`❌ ${wallet}:`, e);
    }
  }
  
  console.log("Done. Disconnecting...");
  await api.disconnect();
}

main().catch(console.error);
