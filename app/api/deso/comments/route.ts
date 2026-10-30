import { connection, NextRequest, NextResponse } from "next/server";
import { desoNode, PUBLIC_KEY, USERNAME } from "@/lib/deso-node";
import type { SocialComment } from "@/lib/types";

const POST_HASH = /^[0-9a-f]{64}$/i;

export async function GET(request: NextRequest) {
  await connection();
  const postHashHex = request.nextUrl.searchParams.get("post")?.trim() || "";
  if (!POST_HASH.test(postHashHex)) {
    return NextResponse.json({ error: "A DeSo post is required." }, { status: 400 });
  }

  try {
    const response = await fetch(`${desoNode()}/api/v0/get-single-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        PostHashHex: postHashHex,
        FetchParents: false,
        CommentOffset: 0,
        CommentLimit: 40,
        ThreadLevelLimit: 2,
        ThreadLeafLimit: 1,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "Couldn't load that chat." }, { status: 502 });
    }
    const data = (await response.json()) as { PostFound?: { Comments?: RawComment[] | null } | null };
    const comments = (data.PostFound?.Comments ?? [])
      .map(toComment)
      .filter((comment): comment is SocialComment => comment !== null)
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    return NextResponse.json({ comments });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the DeSo node." }, { status: 502 });
  }
}

type RawComment = {
  PostHashHex?: string;
  Body?: string;
  IsHidden?: boolean;
  TimestampNanos?: number | string;
  PosterPublicKeyBase58Check?: string;
  ProfileEntryResponse?: { Username?: string } | null;
};

function toComment(post: RawComment): SocialComment | null {
  if (post.IsHidden || !post.PostHashHex) return null;
  const publicKey = post.PosterPublicKeyBase58Check || "";
  if (!PUBLIC_KEY.test(publicKey)) return null;
  const body = (post.Body || "").trim().slice(0, 600);
  if (!body) return null;
  const username = post.ProfileEntryResponse?.Username?.trim().replace(/^@/, "") || "";
  return {
    postHashHex: post.PostHashHex,
    publicKey,
    username: USERNAME.test(username) ? username : undefined,
    body,
    createdAt: nanosToIso(post.TimestampNanos),
  };
}

function nanosToIso(value: number | string | undefined): string | null {
  const nanos = typeof value === "string" ? Number(value) : value;
  if (typeof nanos !== "number" || !Number.isFinite(nanos) || nanos <= 0) return null;
  const date = new Date(nanos / 1e6);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
