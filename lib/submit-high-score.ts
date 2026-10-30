const PLAYER_ID = "kia-player-id";

export function currentPlayerId(): string | null {
  if (typeof window === "undefined") return null;
  const existing = localStorage.getItem(PLAYER_ID);
  return existing && /^[0-9a-f-]{36}$/i.test(existing) ? existing : null;
}

export function playerId(): string {
  const existing = localStorage.getItem(PLAYER_ID);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(PLAYER_ID, next);
  return next;
}

export async function submitHighScore(input: {
  seconds: number;
  near: number;
  username?: string;
  publicKey?: string;
}): Promise<void> {
  if (input.seconds <= 0) return;
  await fetch("/api/high-scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seconds: input.seconds,
      near: input.near,
      name: input.username,
      publicKey: input.publicKey,
      playerId: playerId(),
    }),
  });
}
