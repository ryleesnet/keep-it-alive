import { createHash, randomBytes } from "crypto";
import { connection, NextRequest, NextResponse } from "next/server";
import { safeReturnTo, writeOauth, xConfig, xRedirectUri } from "@/lib/x-session";

export async function GET(request: NextRequest) {
  await connection();
  const config = xConfig();
  if (!config.configured) {
    return NextResponse.redirect(new URL("/?x=error&reason=config", request.url));
  }

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("next"));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: xRedirectUri(request),
    scope: "tweet.write users.read offline.access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(
    `https://x.com/i/oauth2/authorize?${params.toString()}`
  );
  writeOauth(response, request, { state, verifier, returnTo });
  return response;
}
