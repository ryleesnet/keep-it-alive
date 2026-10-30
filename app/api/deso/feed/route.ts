import { connection, NextRequest, NextResponse } from "next/server";
import { APP_TAG } from "@/lib/constants";
import { desoNode, PUBLIC_KEY, USERNAME } from "@/lib/deso-node";
import type { SocialPost } from "@/lib/types";

const POST_LIMIT = 30;

export async function GET(request: NextRequest) {
  await connection();
  const reader = request.nextUrl.searchParams.get("reader")?.trim() || "";
  const readerKey = PUBLIC_KEY.test(reader) ? reader : "";

  try {
    const [searched, own] = await Promise.all([
      searchPosts(readerKey),
      readerKey ? loadPosts(readerKey, readerKey) : Promise.resolve([]),
    ]);
    if (!searched) {
      if (own.length === 0) {
        return NextResponse.json({ error: "Couldn't load the DeSo feed." }, { status: 502 });
      }
    }
    const seen = new Set<string>();
    const posts = [...(searched ?? []), ...own]
      .filter((post) => {
        if (seen.has(post.postHashHex)) return false;
        seen.add(post.postHashHex);
        return true;
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, POST_LIMIT);

    return NextResponse.json({ posts });
  } catch {
    return NextResponse.json({ error: "Couldn't load the DeSo feed." }, { status: 502 });
  }
}

async function searchPosts(readerKey: string): Promise<SocialPost[] | null> {
  try {
    const response = await fetch(`${desoNode()}/api/v0/get-posts-stateless`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        NumToFetch: 40,
        OrderBy: "newest",
        MediaRequired: false,
        PostContent: "#KeepItAlive",
        ReaderPublicKeyBase58Check: readerKey,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { PostsFound?: RawPost[] | null };
    return (data.PostsFound ?? []).map(toSocialPost).filter((post): post is SocialPost => post !== null);
  } catch {
    return null;
  }
}

async function loadPosts(publicKey: string, readerKey: string): Promise<SocialPost[]> {
  try {
    const response = await fetch(`${desoNode()}/api/v0/get-posts-for-public-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        PublicKeyBase58Check: publicKey,
        NumToFetch: 12,
        MediaRequired: false,
        ReaderPublicKeyBase58Check: readerKey || publicKey,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { Posts?: RawPost[] | null };
    return (data.Posts ?? []).map(toSocialPost).filter((post): post is SocialPost => post !== null);
  } catch {
    return [];
  }
}

type RawPost = {
  PostHashHex?: string;
  Body?: string;
  IsHidden?: boolean;
  TimestampNanos?: number | string;
  PosterPublicKeyBase58Check?: string;
  ParentStakeID?: string;
  LikeCount?: number;
  DiamondCount?: number;
  CommentCount?: number;
  ImageURLs?: string[] | null;
  PostExtraData?: Record<string, string> | null;
  ProfileEntryResponse?: { Username?: string } | null;
  PostEntryReaderState?: { LikedByReader?: boolean; DiamondLevelBestowed?: number } | null;
};

function toSocialPost(post: RawPost): SocialPost | null {
  if (post.IsHidden || !post.PostHashHex || !isTopLevel(post.ParentStakeID)) return null;
  const extra = post.PostExtraData;
  if (!extra || extra.App !== APP_TAG) return null;
  const publicKey = post.PosterPublicKeyBase58Check || "";
  if (!PUBLIC_KEY.test(publicKey)) return null;
  const scoreValue = Number(extra.ScoreSeconds);
  const score = Number.isFinite(scoreValue) && scoreValue >= 0 ? scoreValue : null;
  const near = Number(extra.NearMisses ?? 0);
  const level = Number(post.PostEntryReaderState?.DiamondLevelBestowed ?? 0);
  const images = (post.ImageURLs ?? []).map(safeImageUrl).filter((url): url is string => Boolean(url)).slice(0, 4);
  if (score === null && !(post.Body || "").trim() && images.length === 0) return null;
  return {
    postHashHex: post.PostHashHex,
    publicKey,
    username: cleanUsername(post.ProfileEntryResponse?.Username),
    score,
    near: Number.isFinite(near) ? Math.max(0, Math.round(near)) : 0,
    images,
    body: (post.Body || "").replace(/\s+\n/g, "\n").trim().slice(0, 600),
    createdAt: nanosToIso(post.TimestampNanos),
    likeCount: count(post.LikeCount),
    diamondCount: count(post.DiamondCount),
    commentCount: count(post.CommentCount),
    likedByReader: Boolean(post.PostEntryReaderState?.LikedByReader),
    diamondLevel: Number.isFinite(level) ? Math.max(0, Math.round(level)) : 0,
  };
}

function isTopLevel(parent: string | undefined): boolean {
  return !parent || /^0+$/.test(parent);
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function safeImageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanUsername(value: string | undefined): string | undefined {
  const name = value?.trim().replace(/^@/, "") || "";
  return USERNAME.test(name) ? name : undefined;
}

function nanosToIso(value: number | string | undefined): string | null {
  const nanos = typeof value === "string" ? Number(value) : value;
  if (typeof nanos !== "number" || !Number.isFinite(nanos) || nanos <= 0) return null;
  const date = new Date(nanos / 1e6);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
