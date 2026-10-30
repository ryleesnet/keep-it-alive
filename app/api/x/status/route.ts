import { connection, NextRequest, NextResponse } from "next/server";
import { readSession, xConfig } from "@/lib/x-session";

export async function GET(request: NextRequest) {
  await connection();
  const config = xConfig();
  if (!config.configured) {
    return NextResponse.json({ configured: false, connected: false });
  }
  const session = readSession(request);
  if (!session) return NextResponse.json({ configured: true, connected: false });
  return NextResponse.json({
    configured: true,
    connected: true,
    username: session.username,
    name: session.name,
  });
}
