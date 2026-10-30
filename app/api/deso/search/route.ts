import { connection, NextRequest, NextResponse } from "next/server";
import { desoNode, USERNAME } from "@/lib/deso-node";

const LIMIT = 8;

type RawProfile = {
  Username?: string;
  PublicKeyBase58Check?: string;
  Description?: string;
  IsHidden?: boolean;
};

export async function GET(request: NextRequest) {
  await connection();
  const q = request.nextUrl.searchParams.get("q")?.trim().replace(/^@/, "") || "";
  if (!USERNAME.test(q)) {
    return NextResponse.json({ profiles: [] });
  }

  try {
    const response = await fetch(`${desoNode()}/api/v0/get-profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        UsernamePrefix: q,
        NumToFetch: LIMIT,
        OrderBy: "influencer_coin_price",
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ error: "DeSo search failed." }, { status: 502 });
    }
    const data = (await response.json()) as { ProfilesFound?: RawProfile[] | null };
    const needle = q.toLowerCase();
    const profiles = (data.ProfilesFound ?? [])
      .map(toProfile)
      .filter((profile): profile is SearchProfile => profile !== null)
      .sort((a, b) => {
        const aExact = a.username.toLowerCase() === needle ? 0 : 1;
        const bExact = b.username.toLowerCase() === needle ? 0 : 1;
        return aExact - bExact;
      });
    return NextResponse.json({ profiles });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the DeSo node." }, { status: 502 });
  }
}

type SearchProfile = {
  username: string;
  publicKey: string;
  description?: string;
};

function toProfile(profile: RawProfile): SearchProfile | null {
  const username = profile.Username?.trim().replace(/^@/, "") || "";
  const publicKey = profile.PublicKeyBase58Check?.trim() || "";
  if (profile.IsHidden || !USERNAME.test(username) || !publicKey) return null;
  return {
    username,
    publicKey,
    description: cleanDescription(profile.Description),
  };
}

function cleanDescription(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/&#x20;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 80) : undefined;
}
