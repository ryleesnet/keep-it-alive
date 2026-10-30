import { timingSafeEqual } from "crypto";
import { connection, NextRequest, NextResponse } from "next/server";
import {
  clearOauth,
  fetchXProfile,
  readOauth,
  writeSession,
  withXFlag,
  xConfig,
  xRedirectUri,
  xTokenRequest,
} from "@/lib/x-session";

export async function GET(request: NextRequest) {
  await connection();
  const pending = readOauth(request);
  const returnTo = pending?.returnTo || "/";
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(withXFlag(returnTo, "error", reason), request.url));
    clearOauth(response, request);
    return response;
  };

  const config = xConfig();
  if (!config.configured) return fail("config");

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) return fail(oauthError === "access_denied" ? "denied" : "oauth");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state || !pending || !safeEqual(state, pending.state)) return fail("state");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: xRedirectUri(request),
    code_verifier: pending.verifier,
    client_id: config.clientId,
  });
  const token = await xTokenRequest(body, config.clientId, config.clientSecret);
  if (!token.ok || !token.json?.access_token) {
    console.error("X token exchange failed", token.status, token.json?.error || "unknown");
    return fail("token");
  }

  try {
    const profile = await fetchXProfile(token.json.access_token);
    const response = NextResponse.redirect(new URL(withXFlag(returnTo, "connected"), request.url));
    writeSession(response, request, {
      accessToken: token.json.access_token,
      refreshToken: token.json.refresh_token,
      expiresAt: Date.now() + (token.json.expires_in ?? 7200) * 1000,
      userId: profile.id,
      username: profile.username,
      name: profile.name,
    });
    clearOauth(response, request);
    return response;
  } catch (error) {
    console.error("X profile lookup failed", error instanceof Error ? error.message : "unknown");
    return fail("profile");
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
