import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { PUBLIC_KEY, USERNAME } from "@/lib/deso-node";
import { shortKey } from "@/lib/format";

export type HighScoreRow = {
  id: string;
  name: string;
  seconds: number;
  near: number;
  updatedAt: string;
};

const FILE = path.join(process.cwd(), "data", "high-scores.json");
const PLAYER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function listHighScores(): Promise<HighScoreRow[]> {
  return enqueue(async () => sortScores(await readRows()));
}

export function saveHighScore(input: {
  seconds: number;
  near: number;
  name?: string;
  publicKey?: string;
  playerId?: string;
}): Promise<HighScoreRow> {
  return enqueue(async () => {
    const seconds = roundSeconds(input.seconds);
    const near = clampNear(input.near);
    if (seconds === null || near === null) {
      throw new Error("That score can't be saved.");
    }

    const publicKey = input.publicKey?.trim() || "";
    const playerId = input.playerId?.trim() || "";
    const desoId = PUBLIC_KEY.test(publicKey) ? `deso:${publicKey}` : "";
    const guestId = PLAYER_ID.test(playerId) ? `guest:${playerId}` : "";
    if (!desoId && !guestId) throw new Error("A player id is required.");

    let rows = await readRows();
    let bestSeconds = seconds;
    let bestNear = near;
    if (desoId && guestId) {
      const guest = rows.find((row) => row.id === guestId);
      if (guest && isBetter(guest.seconds, guest.near, bestSeconds, bestNear)) {
        bestSeconds = guest.seconds;
        bestNear = guest.near;
      }
      rows = rows.filter((row) => row.id !== guestId);
    }

    const id = desoId || guestId;
    const name = displayName(input.name, publicKey);
    const existing = rows.find((row) => row.id === id);
    const next = existing
      ? mergeRow(existing, name, bestSeconds, bestNear)
      : {
          id,
          name,
          seconds: bestSeconds,
          near: bestNear,
          updatedAt: new Date().toISOString(),
        };
    const without = rows.filter((row) => row.id !== id);
    without.push(next);
    await writeRows(without);
    return next;
  });
}

function mergeRow(row: HighScoreRow, name: string, seconds: number, near: number): HighScoreRow {
  const better = isBetter(seconds, near, row.seconds, row.near);
  const named = name !== "Guest" && name !== row.name;
  if (!better && !named) return row;
  return {
    ...row,
    name: name === "Guest" ? row.name : name,
    seconds: better ? seconds : row.seconds,
    near: better ? near : row.near,
    updatedAt: better ? new Date().toISOString() : row.updatedAt,
  };
}

function isBetter(seconds: number, near: number, otherSeconds: number, otherNear: number): boolean {
  return seconds > otherSeconds || (seconds === otherSeconds && near > otherNear);
}

function sortScores(rows: HighScoreRow[]): HighScoreRow[] {
  return [...rows].sort(
    (a, b) => b.seconds - a.seconds || a.updatedAt.localeCompare(b.updatedAt)
  );
}

function displayName(name: string | undefined, publicKey: string): string {
  const username = name?.trim().replace(/^@/, "") || "";
  if (USERNAME.test(username)) return `@${username}`;
  if (PUBLIC_KEY.test(publicKey)) return shortKey(publicKey);
  return "Guest";
}

function roundSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > 86400) return null;
  return Math.round(value * 10) / 10;
}

function clampNear(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > 99999) return null;
  return Math.round(value);
}

async function readRows(): Promise<HighScoreRow[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRow);
  } catch {
    return [];
  }
}

async function writeRows(rows: HighScoreRow[]): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.tmp`;
  await writeFile(temp, JSON.stringify(sortScores(rows)), "utf8");
  await rename(temp, FILE);
}

function isRow(value: unknown): value is HighScoreRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<HighScoreRow>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    typeof row.seconds === "number" &&
    typeof row.near === "number" &&
    typeof row.updatedAt === "string"
  );
}
