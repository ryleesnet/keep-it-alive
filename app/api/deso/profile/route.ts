import { connection, NextRequest, NextResponse } from "next/server";
import { desoNode, PUBLIC_KEY, USERNAME } from "@/lib/deso-node";

export async function GET(request: NextRequest) {
  await connection();
  const username = request.nextUrl.searchParams.get("username")?.trim().replace(/^@/, "") || "";
  const publicKey = request.nextUrl.searchParams.get("publicKey")?.trim() || "";
  if (!username && !publicKey) {
    return NextResponse.json({ error: "Provide a DeSo username or public key." }, { status: 400 });
  }
  if (username && !USERNAME.test(username)) {
    return NextResponse.json({ error: "That username doesn't look like a DeSo name." }, { status: 400 });
  }
  if (publicKey && !PUBLIC_KEY.test(publicKey)) {
    return NextResponse.json({ error: "That public key doesn't look like a DeSo key." }, { status: 400 });
  }

  const payload = username ? { Username: username } : { PublicKeyBase58Check: publicKey };
  try {
    const response = await fetch(`${desoNode()}/api/v0/get-single-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ error: "DeSo profile lookup failed." }, { status: 502 });
    }
    const data = (await response.json()) as {
      Profile?: {
        Username?: string;
        PublicKeyBase58Check?: string;
        Description?: string;
      } | null;
    };
    const profile = data.Profile;
    if (!profile?.PublicKeyBase58Check) {
      return NextResponse.json({ error: "No DeSo profile by that name." }, { status: 404 });
    }
    const cleanName = profile.Username?.trim().replace(/^@/, "");
    return NextResponse.json({
      username: cleanName && USERNAME.test(cleanName) ? cleanName : undefined,
      publicKey: profile.PublicKeyBase58Check,
      description: profile.Description?.replace(/\s+/g, " ").trim().slice(0, 140) || undefined,
    });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the DeSo node." }, { status: 502 });
  }
}
