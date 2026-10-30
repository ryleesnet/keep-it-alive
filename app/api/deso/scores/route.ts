import { connection, NextRequest, NextResponse } from "next/server";
import { APP_TAG } from "@/lib/constants";
import { desoNode, PUBLIC_KEY } from "@/lib/deso-node";
import type { PostedScore } from "@/lib/types";

export async function GET(request: NextRequest) {
  await connection();
  const publicKey = request.nextUrl.searchParams.get("publicKey")?.trim() || "";
  if (!PUBLIC_KEY.test(publicKey)) {
    return NextResponse.json({ error: "A DeSo public key is required." }, { status: 400 });
  }

  try {
    const response = await fetch(`${desoNode()}/api/v0/get-posts-for-public-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        PublicKeyBase58Check: publicKey,
        NumToFetch: 40,
        MediaRequired: false,
        ReaderPublicKeyBase58Check: publicKey,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ error: "Couldn't load DeSo posts." }, { status: 502 });
    }
    const data = (await response.json()) as { Posts?: RawPost[] | null };
    const scores = (data.Posts ?? [])
      .map(toScore)
      .filter((score): score is PostedScore => score !== null)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, 15);
    return NextResponse.json({ scores });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the DeSo node." }, { status: 502 });
  }
}

type RawPost = {
  PostHashHex?: string;
  Body?: string;
  IsHidden?: boolean;
  TimestampNanos?: number | string;
  PostExtraData?: Record<string, string> | null;
};

function toScore(post: RawPost): PostedScore | null {
  if (post.IsHidden) return null;
  const extra = post.PostExtraData;
  if (!extra || extra.App !== APP_TAG || !post.PostHashHex) return null;
  const score = Number(extra.ScoreSeconds);
  if (!Number.isFinite(score) || score < 0) return null;
  const near = Number(extra.NearMisses ?? 0);
  const challenged = extra.ChallengedUsername?.trim().replace(/^@/, "");
  return {
    postHashHex: post.PostHashHex,
    score,
    near: Number.isFinite(near) ? Math.max(0, Math.round(near)) : 0,
    challengedUsername: challenged || undefined,
    createdAt: nanosToIso(post.TimestampNanos),
  };
}

function nanosToIso(value: number | string | undefined): string | null {
  const nanos = typeof value === "string" ? Number(value) : value;
  if (typeof nanos !== "number" || !Number.isFinite(nanos) || nanos <= 0) return null;
  const date = new Date(nanos / 1e6);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
