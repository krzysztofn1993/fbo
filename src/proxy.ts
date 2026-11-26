// Checks the session on every request before any route renders.
//
// The session needs no database, so this is the full check (the same rules
// as the data access layer), not only an optimistic one: a visitor without a
// valid session never gets past this point except to the public paths. It is
// also where activity refreshes the session cookie, because Server Components
// cannot set cookies. Server Actions are POST requests to the page that uses
// them, so they pass through here too and count as activity.
//
// This file must not import `server-only`: Proxy is not built with the
// `react-server` condition.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthConfig, sessionCookieOptions } from "@/lib/auth/config";
import type { AuthConfig, SessionCookieOptions } from "@/lib/auth/config";
import { needsRefresh, openSession, sealSession, touch } from "@/lib/auth/session-token";

/** Paths that need no session. */
const PUBLIC_PATHS: readonly string[] = ["/login"];

const LOGIN_PATH = "/login";
const HOME_PATH = "/";

// Kept on globalThis so the warning is printed once per process even if the
// bundler loads this module more than once.
const INSECURE_WARNING_KEY = "__fboInsecureCookieWarned";

type WarningHolder = { [INSECURE_WARNING_KEY]?: boolean };

function warnIfInsecure(config: AuthConfig): void {
  if (config.cookieSecure) {
    return;
  }
  const holder = globalThis as typeof globalThis & WarningHolder;
  if (holder[INSECURE_WARNING_KEY] === true) {
    return;
  }
  holder[INSECURE_WARNING_KEY] = true;
  console.warn(
    "SESSION_COOKIE_SECURE=false: the session cookie is sent without Secure and without the __Host- prefix. Use this only on a trusted network without HTTPS.",
  );
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 307);
}

// An expired cookie needs the same Path and Secure attributes as the one it
// replaces; a `__Host-` cookie is not accepted without them.
function expireCookie(response: NextResponse, options: SessionCookieOptions): NextResponse {
  response.cookies.delete({
    name: options.name,
    path: options.path,
    secure: options.secure,
    httpOnly: options.httpOnly,
    sameSite: options.sameSite,
  });
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const isPublic = PUBLIC_PATHS.includes(request.nextUrl.pathname);

  const result = readAuthConfig();
  if (!result.ok) {
    return isPublic ? NextResponse.next() : redirectTo(request, LOGIN_PATH);
  }
  const authConfig = result.config;
  warnIfInsecure(authConfig);

  const options = sessionCookieOptions(authConfig);
  const cookie = request.cookies.get(options.name)?.value;
  const now = Date.now();
  const session = cookie === undefined ? null : await openSession(cookie, authConfig, now);

  if (session === null) {
    const response = isPublic ? NextResponse.next() : redirectTo(request, LOGIN_PATH);
    return cookie === undefined ? response : expireCookie(response, options);
  }

  if (isPublic) {
    return redirectTo(request, HOME_PATH);
  }

  const response = NextResponse.next();
  if (needsRefresh(session, now)) {
    const value = await sealSession(touch(session, now), authConfig.sessionSecret);
    response.cookies.set({ ...options, value });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
