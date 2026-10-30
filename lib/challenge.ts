import type { Challenge } from "@/lib/types";

const USERNAME = /^[A-Za-z0-9_]{1,25}$/;
const PUBLIC_KEY = /^BC[1-9A-HJ-NP-Za-km-z]{40,64}$/;

type Packed = {
  s: number;
  n: number;
  u?: string;
  p?: string;
};

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeChallenge(challenge: Challenge): string {
  const packed: Packed = {
    s: Number(formatScore(challenge.score)),
    n: clampNear(challenge.near),
  };
  if (challenge.username && USERNAME.test(challenge.username)) {
    packed.u = challenge.username;
  }
  if (challenge.publicKey && PUBLIC_KEY.test(challenge.publicKey)) {
    packed.p = challenge.publicKey;
  }
  return toBase64Url(JSON.stringify(packed));
}

export function decodeChallenge(raw: string | null | undefined): Challenge | null {
  if (!raw || raw.length > 400) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(raw));
    if (!parsed || typeof parsed !== "object") return null;
    const data = parsed as Partial<Packed>;
    const score = typeof data.s === "number" ? data.s : Number.NaN;
    if (!Number.isFinite(score) || score < 0 || score > 86400) return null;
    return {
      score: Number(formatScore(score)),
      near: clampNear(data.n),
      username: typeof data.u === "string" && USERNAME.test(data.u) ? data.u : undefined,
      publicKey: typeof data.p === "string" && PUBLIC_KEY.test(data.p) ? data.p : undefined,
    };
  } catch {
    return null;
  }
}

export function challengeLink(origin: string, challenge: Challenge): string {
  const url = new URL("/", origin);
  url.searchParams.set("c", encodeChallenge(challenge));
  return url.toString();
}

function formatScore(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function clampNear(value: unknown): number {
  const near = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(near)) return 0;
  return Math.max(0, Math.min(99999, Math.round(near)));
}
