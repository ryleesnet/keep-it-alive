import type { RunResult } from "@/lib/types";

const BEST = "kia-best";
const BEST_NEAR = "kia-best-near";
const LAST_RUN = "kia-last-run";
const PENDING_SHARE = "kia-pending-share";

export type BestRecord = { seconds: number; near: number };

const serverBest: BestRecord = { seconds: 0, near: 0 };
let bestSnapshot: BestRecord = serverBest;
let bestLoaded = false;
const bestListeners = new Set<() => void>();

export function subscribeBest(listener: () => void): () => void {
  bestListeners.add(listener);
  return () => bestListeners.delete(listener);
}

export function getBestSnapshot(): BestRecord {
  if (!bestLoaded && typeof window !== "undefined") {
    bestLoaded = true;
    const saved = readBest();
    if (saved.seconds > 0 || saved.near > 0) bestSnapshot = saved;
  }
  return bestSnapshot;
}

export function getBestServerSnapshot(): BestRecord {
  return serverBest;
}

export function publishBest(seconds: number, near: number): void {
  bestSnapshot = { seconds, near: Math.max(0, Math.round(near)) };
  bestLoaded = true;
  writeBest(seconds, near);
  bestListeners.forEach((listener) => listener());
}

let pendingSnapshot: RunResult | null | undefined;
const pendingListeners = new Set<() => void>();

export function subscribePending(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

export function getPendingSnapshot(): RunResult | null {
  if (pendingSnapshot !== undefined) return pendingSnapshot;
  if (typeof window === "undefined" || sessionStorage.getItem(PENDING_SHARE) !== "1") {
    pendingSnapshot = null;
    return null;
  }
  pendingSnapshot = readLastRun();
  return pendingSnapshot;
}

export function getPendingServerSnapshot(): RunResult | null {
  return null;
}

export function clearPendingShare(): void {
  sessionStorage.removeItem(PENDING_SHARE);
  pendingSnapshot = null;
  pendingListeners.forEach((listener) => listener());
}

export function readBest(): { seconds: number; near: number } {
  if (typeof window === "undefined") return { seconds: 0, near: 0 };
  const seconds = Number(localStorage.getItem(BEST) || 0);
  const near = Number(localStorage.getItem(BEST_NEAR) || 0);
  return {
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    near: Number.isFinite(near) && near > 0 ? near : 0,
  };
}

export function writeBest(seconds: number, near: number): void {
  localStorage.setItem(BEST, seconds.toFixed(1));
  localStorage.setItem(BEST_NEAR, String(Math.max(0, Math.round(near))));
}

export function writeLastRun(result: RunResult): void {
  sessionStorage.setItem(LAST_RUN, JSON.stringify(result));
}

export function readLastRun(): RunResult | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(LAST_RUN);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<RunResult>;
    if (typeof data.seconds !== "number" || !Number.isFinite(data.seconds)) return null;
    return {
      seconds: data.seconds,
      nearMisses: typeof data.nearMisses === "number" ? data.nearMisses : 0,
      best: typeof data.best === "number" ? data.best : data.seconds,
      isBest: Boolean(data.isBest),
    };
  } catch {
    return null;
  }
}

export function markPendingShare(): void {
  sessionStorage.setItem(PENDING_SHARE, "1");
  pendingSnapshot = undefined;
}
