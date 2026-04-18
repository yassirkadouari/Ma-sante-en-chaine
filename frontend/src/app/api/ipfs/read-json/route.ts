import { NextResponse } from "next/server";

const DEFAULT_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs",
  "https://ipfs.io/ipfs",
];
const READ_RATE_LIMIT_MAX_RETRIES = 2;
const READ_RATE_LIMIT_BASE_DELAY_MS = 900;

type ReadRequestBody = {
  cid?: string;
};

function normalizeGatewayBase(base: string): string {
  const trimmed = String(base || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/ipfs")) return trimmed;
  return `${trimmed}/ipfs`;
}

function configuredGateways(): string[] {
  const envCandidates = [
    process.env.IPFS_GATEWAY_URL,
    process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL,
  ];

  const merged = [...envCandidates, ...DEFAULT_GATEWAYS]
    .map((item) => normalizeGatewayBase(String(item || "")))
    .filter(Boolean);

  return Array.from(new Set(merged));
}

function isRateLimitMessage(input: string): boolean {
  const message = String(input || "").toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429")
  );
}

function isRateLimitStatus(status: number): boolean {
  return status === 429;
}

async function wait(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchJsonWithRetry(url: string): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= READ_RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const rateLimited = isRateLimitStatus(response.status) || isRateLimitMessage(bodyText);

        if (rateLimited && attempt < READ_RATE_LIMIT_MAX_RETRIES) {
          const delay = READ_RATE_LIMIT_BASE_DELAY_MS * (attempt + 1);
          await wait(delay);
          continue;
        }

        throw new Error(`Gateway read failed (${response.status}) ${bodyText}`.trim());
      }

      return await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "unknown error");
      const rateLimited = isRateLimitMessage(message);

      if (rateLimited && attempt < READ_RATE_LIMIT_MAX_RETRIES) {
        const delay = READ_RATE_LIMIT_BASE_DELAY_MS * (attempt + 1);
        await wait(delay);
        continue;
      }

      lastError = error instanceof Error ? error : new Error(message);
      break;
    }
  }

  throw lastError || new Error("Unknown IPFS read error");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReadRequestBody;
    const cid = String(body.cid || "").trim();

    if (!cid) {
      return NextResponse.json({ error: "cid is required" }, { status: 400 });
    }

    const gateways = configuredGateways();
    const failures: string[] = [];

    for (const gateway of gateways) {
      const url = `${gateway}/${cid}`;
      try {
        const payload = await fetchJsonWithRetry(url);
        return NextResponse.json({ payload });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "unknown error");
        failures.push(`${gateway}: ${message}`);
      }
    }

    return NextResponse.json(
      {
        error: `IPFS read failed for ${cid}. Tried gateways: ${failures.join(" | ")}`,
      },
      { status: 502 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "IPFS read proxy error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
