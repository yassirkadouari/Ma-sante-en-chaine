type InjectedExtension = {
  enable: (originName: string) => Promise<{
    accounts: {
      get: () => Promise<Array<{ address: string }>>;
    };
    signer?: {
      signRaw?: (payload: { address: string; data: string; type: "bytes" }) => Promise<{ signature: string }>;
    };
  }>;
};

declare global {
  interface Window {
    injectedWeb3?: Record<string, InjectedExtension>;
  }
}

const APP_NAME = "Ma Sante en Chaine";

function toHex(value: string) {
  const bytes = new TextEncoder().encode(value);
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function getExtension() {
  const injected = window.injectedWeb3?.["polkadot-js"] || Object.values(window.injectedWeb3 || {})[0];
  if (!injected) {
    throw new Error("Polkadot wallet extension not found.");
  }

  return injected.enable(APP_NAME);
}

export async function connectWallet() {
  const extension = await getExtension();
  const accounts = await extension.accounts.get();

  if (!accounts.length) {
    throw new Error("No wallet account available in Polkadot extension");
  }

  return { walletAddress: accounts[0].address };
}

export async function signMessage(walletAddress: string, message: string) {
  const extension = await getExtension();
  const signRaw = extension.signer?.signRaw;

  if (!signRaw) {
    throw new Error("Polkadot extension signer is unavailable");
  }

  const response = await signRaw({
    address: walletAddress,
    data: toHex(message),
    type: "bytes"
  });

  return response.signature;
}
