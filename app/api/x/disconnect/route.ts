import { connection, NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/x-session";

export async function POST(request: NextRequest) {
  await connection();
  const response = NextResponse.json({ ok: true });
  clearSession(response, request);
  return response;
}
