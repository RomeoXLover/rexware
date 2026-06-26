import process from "node:process";

// ---------------------------------------------------------------------------
// CryptAPI integration (server-only). Non-custodial: you provide your own
// LTC/BTC wallet address per coin via env vars, and CryptAPI generates a
// unique forwarding address (`address_in`) for each payment, forwarding funds
// straight to your wallet. It calls our callback URL on every confirmation.
//
// Required env:
//   CRYPTAPI_LTC_ADDRESS  - your Litecoin receiving address
//   CRYPTAPI_BTC_ADDRESS  - your Bitcoin receiving address
//   CRYPTAPI_CALLBACK_SECRET - random string used to authenticate callbacks
// Optional:
//   APP_BASE_URL - public origin for the callback (else derived per-request)
// ---------------------------------------------------------------------------

const CRYPTAPI_BASE = "https://api.cryptapi.io";

export type Coin = "ltc" | "btc";

export const SUPPORTED_COINS: { id: Coin; label: string; name: string }[] = [
  { id: "btc", label: "BTC", name: "Bitcoin" },
  { id: "ltc", label: "LTC", name: "Litecoin" },
];

export function isCoin(value: string): value is Coin {
  return value === "ltc" || value === "btc";
}

function getReceivingAddress(coin: Coin): string {
  const key = coin === "ltc" ? "CRYPTAPI_LTC_ADDRESS" : "CRYPTAPI_BTC_ADDRESS";
  const addr = process.env[key];
  if (!addr) {
    throw new Error(`Missing ${key} environment variable`);
  }
  return addr;
}

export function getCallbackSecret(): string {
  const secret = process.env.CRYPTAPI_CALLBACK_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CRYPTAPI_CALLBACK_SECRET must be set (>= 16 chars) to authenticate payment callbacks.",
    );
  }
  return secret;
}

interface CreateAddressResult {
  address_in: string;
  address_out: string;
  callback_url: string;
  status: string;
}

/** Create a unique payment address for a given coin. The callback URL embeds
 *  our internal payment id and a shared secret so we can authenticate the
 *  webhook later. */
export async function createPaymentAddress(input: {
  coin: Coin;
  paymentId: string;
  baseUrl: string;
}): Promise<string> {
  const { coin, paymentId, baseUrl } = input;
  const ownAddress = getReceivingAddress(coin);
  const secret = getCallbackSecret();

  const callbackUrl = `${baseUrl}/api/payments/callback?payment_id=${encodeURIComponent(
    paymentId,
  )}&secret=${encodeURIComponent(secret)}`;

  const params = new URLSearchParams({
    callback: callbackUrl,
    address: ownAddress,
    pending: "1", // also notify on 0-conf so we can show "confirming"
    post: "0",
    json: "1",
  });

  const url = `${CRYPTAPI_BASE}/${coin}/create/?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CryptAPI create failed: ${res.status}`);
  }
  const data = (await res.json()) as CreateAddressResult & { status: string };
  if (data.status !== "success" || !data.address_in) {
    throw new Error("CryptAPI create returned no address");
  }
  return data.address_in;
}

interface ConvertResult {
  value_coin: string;
  exchange_rate: string;
  status: string;
}

/** Convert a USD amount into the crypto amount using CryptAPI's live rate. */
export async function convertUsdToCrypto(
  coin: Coin,
  amountUsd: number,
): Promise<string> {
  const params = new URLSearchParams({
    value: amountUsd.toFixed(2),
    from: "usd",
  });
  const url = `${CRYPTAPI_BASE}/${coin}/convert/?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CryptAPI convert failed: ${res.status}`);
  }
  const data = (await res.json()) as ConvertResult;
  if (data.status !== "success" || !data.value_coin) {
    throw new Error("CryptAPI convert returned no value");
  }
  return data.value_coin;
}

/** Validate that an inbound callback carries the expected shared secret. */
export function verifyCallbackSecret(received: string | null): boolean {
  if (!received) return false;
  let expected: string;
  try {
    expected = getCallbackSecret();
  } catch {
    return false;
  }
  // Constant-time compare.
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
