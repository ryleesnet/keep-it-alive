import type { DesoUser } from "@/lib/types";

const IDENTITY_USERS_KEY = "desoIdentityUsers";

type Sdk = typeof import("deso-protocol");

let sdkPromise: Promise<Sdk> | null = null;
let configured = false;

function loadSdk(): Promise<Sdk> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("DeSo login runs in the browser."));
  }
  if (!sdkPromise) sdkPromise = import("deso-protocol");
  return sdkPromise;
}

async function readySdk(): Promise<Sdk> {
  const sdk = await loadSdk();
  if (!configured) {
    sdk.configure({
      appName: "Keep It Alive",
      showSkip: true,
      nodeURI: process.env.NEXT_PUBLIC_DESO_NODE_URI || "https://node.deso.org",
      spendingLimitOptions: {
        GlobalDESOLimit: 20_000_000,
        TransactionCountLimitMap: {
          [sdk.TransactionType.AuthorizeDerivedKey]: 2,
          [sdk.TransactionType.SubmitPost]: 100,
        },
      },
    });
    configured = true;
  }
  return sdk;
}

export function readStoredUsername(publicKey: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(IDENTITY_USERS_KEY);
    if (!raw) return undefined;
    const users = JSON.parse(raw) as Record<string, { username?: string }>;
    const username = users[publicKey]?.username?.trim().replace(/^@/, "");
    return username || undefined;
  } catch {
    return undefined;
  }
}

export async function fetchDesoProfile(publicKey: string): Promise<DesoUser> {
  const response = await fetch(`/api/deso/profile?publicKey=${encodeURIComponent(publicKey)}`);
  if (!response.ok) return { publicKey };
  const data = (await response.json()) as { username?: string; publicKey?: string };
  return {
    publicKey: data.publicKey || publicKey,
    username: data.username?.replace(/^@/, "") || undefined,
  };
}

export async function loginWithDeSo(): Promise<DesoUser | null> {
  const { identity } = await readySdk();
  try {
    const payload = await identity.login();
    const publicKey = payload.publicKeyAdded || payload.publicKeyBase58Check;
    if (!publicKey) return null;
    const stored = readStoredUsername(publicKey);
    if (stored) return { publicKey, username: stored };
    return fetchDesoProfile(publicKey);
  } catch (error) {
    if (isIdentityCancelled(error)) return null;
    throw error;
  }
}

export async function logoutDeSo(): Promise<boolean> {
  const { identity } = await readySdk();
  try {
    await identity.logout();
    return true;
  } catch (error) {
    if (isIdentityCancelled(error)) return false;
    throw error;
  }
}

export async function watchDeSo(
  onUser: (user: DesoUser | null) => void
): Promise<() => void> {
  const { identity } = await readySdk();
  const handler = (state: { currentUser: { publicKey: string } | null }) => {
    const publicKey = state.currentUser?.publicKey;
    if (!publicKey) {
      onUser(null);
      return;
    }
    onUser({ publicKey, username: readStoredUsername(publicKey) });
  };
  await identity.subscribe(handler);
  return () => identity.unsubscribe(handler);
}

export async function publishScore(
  publicKey: string,
  body: string,
  extra: Record<string, string>
): Promise<string> {
  const { submitPost } = await readySdk();
  const result = await submitPost({
    UpdaterPublicKeyBase58Check: publicKey,
    BodyObj: { Body: body, ImageURLs: [], VideoURLs: [] },
    PostExtraData: extra,
    MinFeeRateNanosPerKB: 1000,
  });
  const submitted = result.submittedTransactionResponse?.PostEntryResponse?.PostHashHex;
  const constructed =
    result.constructedTransactionResponse &&
    "PostHashHex" in result.constructedTransactionResponse
      ? result.constructedTransactionResponse.PostHashHex
      : undefined;
  const postHashHex = submitted || constructed;
  if (!postHashHex || !result.submittedTransactionResponse) {
    throw new Error("DeSo didn't return a post. Approve the prompt and try again.");
  }
  return postHashHex;
}

export function desoErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Couldn't reach DeSo.";
  if (/sufficient|insufficient|balance|funds/i.test(message)) {
    return "Posting needs a small DESO balance for the network fee.";
  }
  if (/permission|spending limit|derived key/i.test(message)) {
    return "Approve the DeSo posting permission, then try again.";
  }
  if (isIdentityCancelled(error)) return "DeSo prompt closed.";
  return message.length > 180 ? "Couldn't complete that DeSo request." : message;
}

function isIdentityCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { type?: string; message?: string };
  return (
    value.type === "IDENTITY_WINDOW_CLOSED" ||
    (typeof value.message === "string" && value.message.includes("Identity window was closed"))
  );
}
