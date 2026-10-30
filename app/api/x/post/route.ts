import { connection, NextRequest, NextResponse } from "next/server";
import {
  ensureFreshSession,
  readSession,
  writeSession,
  xConfig,
} from "@/lib/x-session";

export async function POST(request: NextRequest) {
  await connection();
  const config = xConfig();
  if (!config.configured) {
    return NextResponse.json({ error: "X posting is not configured." }, { status: 400 });
  }
  const session = readSession(request);
  if (!session) {
    return NextResponse.json({ error: "Connect X before posting." }, { status: 401 });
  }

  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return NextResponse.json({ error: "Post text is required." }, { status: 400 });
  }
  if (!text || text.length > 280) {
    return NextResponse.json({ error: "X posts have to be 280 characters or fewer." }, { status: 400 });
  }

  let fresh = session;
  try {
    fresh = await ensureFreshSession(session, config);
  } catch (error) {
    const response = NextResponse.json(
      { error: error instanceof Error ? error.message : "Reconnect X and try again." },
      { status: 401 }
    );
    response.cookies.set("kia_x_session", "", {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const posted = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fresh.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    cache: "no-store",
  });
  const json = (await posted.json().catch(() => null)) as {
    data?: { id?: string };
    detail?: string;
    title?: string;
    errors?: Array<{ message?: string }>;
  } | null;

  if (!posted.ok || !json?.data?.id) {
    const message =
      json?.errors?.[0]?.message || json?.detail || json?.title || "X rejected the post.";
    return NextResponse.json({ error: message }, { status: posted.status || 502 });
  }

  const response = NextResponse.json({
    id: json.data.id,
    url: `https://x.com/${fresh.username}/status/${json.data.id}`,
  });
  if (fresh !== session) writeSession(response, request, fresh);
  return response;
}
