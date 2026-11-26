// Reads and validates the login configuration from environment variables.
//
// Nothing here runs at import time: the build and the test suite run without
// any of these variables, so they are read only when a request needs them.
// Problems are reported by variable name only, never with the value.

import { createHash } from "node:crypto";

import { parsePasswordHash } from "@/lib/auth/password-hash";
import { IDLE_TIMEOUT_MS } from "@/lib/auth/session-token";

/** iron-session refuses shorter secrets. */
export const SESSION_SECRET_MIN_LENGTH = 32;

export type AuthConfig = {
  username: string;
  passwordHash: string;
  /**
   * First 16 bytes of the SHA-256 of the password hash, in base64url. Stored in
   * the session so that a new password signs every session out.
   */
  passwordHashFingerprint: string;
  sessionSecret: string;
  cookieSecure: boolean;
};

export type AuthConfigResult =
  | { ok: true; config: AuthConfig }
  | { ok: false; problems: string[] };

export type SessionCookieOptions = {
  name: "__Host-fbo_session" | "fbo_session";
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  maxAge: number;
};

type Env = Readonly<Record<string, string | undefined>>;

function fingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest().subarray(0, 16).toString("base64url");
}

export function readAuthConfig(env: Env = process.env): AuthConfigResult {
  const problems: string[] = [];

  const username = env.ADMIN_USERNAME;
  if (username === undefined || username.trim() === "") {
    problems.push("ADMIN_USERNAME");
  }

  const passwordHash = env.ADMIN_PASSWORD_HASH;
  if (passwordHash === undefined || parsePasswordHash(passwordHash) === null) {
    problems.push("ADMIN_PASSWORD_HASH");
  }

  const sessionSecret = env.SESSION_SECRET;
  if (sessionSecret === undefined || sessionSecret.length < SESSION_SECRET_MIN_LENGTH) {
    problems.push("SESSION_SECRET");
  }

  // Secure by default; only an explicit "false" turns it off.
  const secureValue = env.SESSION_COOKIE_SECURE;
  let cookieSecure = true;
  if (secureValue === "false") {
    cookieSecure = false;
  } else if (secureValue !== undefined && secureValue !== "true") {
    problems.push("SESSION_COOKIE_SECURE");
  }

  if (
    problems.length > 0 ||
    username === undefined ||
    passwordHash === undefined ||
    sessionSecret === undefined
  ) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    config: {
      username,
      passwordHash,
      passwordHashFingerprint: fingerprint(passwordHash),
      sessionSecret,
      cookieSecure,
    },
  };
}

/**
 * Cookie attributes for the session. The `__Host-` prefix requires `Secure`,
 * so the insecure variant (plain HTTP on a home network) uses a plain name.
 */
export function sessionCookieOptions(config: Pick<AuthConfig, "cookieSecure">): SessionCookieOptions {
  return {
    name: config.cookieSecure ? "__Host-fbo_session" : "fbo_session",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/",
    maxAge: IDLE_TIMEOUT_MS / 1000,
  };
}
