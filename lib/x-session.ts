import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import type { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "kia_x_session";
const OAUTH_COOKIE = "kia_x_oauth";

export type XSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  userId: string;
  username: string;
  name?: string;
};

export type OauthPending = {
  state: string;
  verifier: string;
  returnTo: string;
};

export type XAppConfig = {
  clientId: string;
  clientSecret: string;
  configured: boolean;
};

export function xConfig(): XAppConfig {
  const clientId = process.env.X_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.X_CLIENT_SECRET?.trim() || "";
  const tokenSecret = process.env.X_TOKEN_SECRET?.trim() || "";
  return {
    clientId,
    clientSecret,
    configured: Boolean(clientId && tokenSecret.length >= 16),
  };
}

export function xRedirectUri(request: NextRequest): string {
  const fromEnv = process.env.X_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  return `${request.nextUrl.origin}/api/x/callback`;
}

export function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  if (raw.length > 300 || raw.includes("://")) return "/";
  return raw;
}

export function withXFlag(path: string, flag: "connected" | "error", reason?: string): string {
  const url = new URL(path, "http://keep-it-alive.local");
  url.searchParams.set("x", flag);
  if (reason) url.searchParams.set("reason", reason);
  else url.searchParams.delete("reason");
  return `${url.pathname}${url.search}`;
}

function secretKey(): Buffer {
  const secret = process.env.X_TOKEN_SECRET?.trim() || "";
  if (secret.length < 16) {
    throw new Error("X_TOKEN_SECRET must be at least 16 characters.");
  }
  return scryptSync(secret, "keep-it-alive-x-v1", 32);
}

export function sealJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

export function openJson<T>(raw: string): T | null {
  try {
    const buf = Buffer.from(raw, "base64url");
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function cookieOptions(maxAge: number, secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function isSecure(request: NextRequest): boolean {
  return request.nextUrl.protocol === "https:";
}

export function readSession(request: NextRequest): XSession | null {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = openJson<XSession>(raw);
  if (!session?.accessToken || !session.username || !session.expiresAt) return null;
  return session;
}

export function writeSession(response: NextResponse, request: NextRequest, session: XSession) {
  response.cookies.set(
    SESSION_COOKIE,
    sealJson(session),
    cookieOptions(60 * 60 * 24 * 180, isSecure(request))
  );
}

export function clearSession(response: NextResponse, request: NextRequest) {
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0, isSecure(request)));
}

export function readOauth(request: NextRequest): OauthPending | null {
  const raw = request.cookies.get(OAUTH_COOKIE)?.value;
  if (!raw) return null;
  const pending = openJson<OauthPending>(raw);
  if (!pending?.state || !pending.verifier) return null;
  return pending;
}

export function writeOauth(response: NextResponse, request: NextRequest, pending: OauthPending) {
  response.cookies.set(
    OAUTH_COOKIE,
    sealJson(pending),
    cookieOptions(60 * 10, isSecure(request))
  );
}

export function clearOauth(response: NextResponse, request: NextRequest) {
  response.cookies.set(OAUTH_COOKIE, "", cookieOptions(0, isSecure(request)));
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export async function xTokenRequest(
  body: URLSearchParams,
  clientId: string,
  clientSecret: string
): Promise<{ ok: boolean; status: number; json: TokenResponse | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as TokenResponse | null;
  return { ok: response.ok, status: response.status, json };
}

export async function ensureFreshSession(
  session: XSession,
  config: XAppConfig
): Promise<XSession> {
  if (session.expiresAt > Date.now() + 60_000) return session;
  if (!session.refreshToken) {
    throw new Error("X session expired. Connect again.");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: config.clientId,
  });
  const { ok, json } = await xTokenRequest(body, config.clientId, config.clientSecret);
  if (!ok || !json?.access_token) {
    throw new Error(json?.error_description || "X session expired. Connect again.");
  }
  return {
    ...session,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || session.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000,
  };
}

export async function fetchXProfile(accessToken: string): Promise<{
  id: string;
  username: string;
  name?: string;
}> {
  const response = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as {
    data?: { id?: string; username?: string; name?: string };
    detail?: string;
    title?: string;
  } | null;
  if (!response.ok || !json?.data?.id || !json.data.username) {
    throw new Error(json?.detail || json?.title || "Couldn't read the X profile.");
  }
  return { id: json.data.id, username: json.data.username, name: json.data.name };
}
