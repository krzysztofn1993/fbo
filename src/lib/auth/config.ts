// Reads and validates the login configuration from environment variables.
//
// Nothing here runs at import time: the build and the test suite run without
// any of these variables, so they are read only when a request needs them.
// Problems are reported by variable name only, never with the value.

import { createHash } from "node:crypto";

import { z } from "zod";

import { parsePasswordHash } from "@/lib/auth/password-hash";
import { IDLE_TIMEOUT_MS } from "@/lib/auth/session-token";
import { type Env, NonBlankSchema } from "@/lib/env";

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

// Each variable is checked on its own, so every problem is reported at once.
const AuthEnvSchema = z.object({
  ADMIN_USERNAME: NonBlankSchema,
  ADMIN_PASSWORD_HASH: z.string().refine((value) => parsePasswordHash(value) !== null),
  SESSION_SECRET: z.string().min(SESSION_SECRET_MIN_LENGTH),
  // Secure by default; only an explicit "false" turns it off.
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
});

const AUTH_VARIABLES = Object.keys(AuthEnvSchema.shape);

function fingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest().subarray(0, 16).toString("base64url");
}

export function readAuthConfig(env: Env = process.env): AuthConfigResult {
  const result = AuthEnvSchema.safeParse(env);
  if (!result.success) {
    // Only the names of the variables, in a fixed order; never their values.
    const failed = new Set(result.error.issues.map((issue) => issue.path[0]));
    return { ok: false, problems: AUTH_VARIABLES.filter((name) => failed.has(name)) };
  }

  const vars = result.data;
  return {
    ok: true,
    config: {
      username: vars.ADMIN_USERNAME,
      passwordHash: vars.ADMIN_PASSWORD_HASH,
      passwordHashFingerprint: fingerprint(vars.ADMIN_PASSWORD_HASH),
      sessionSecret: vars.SESSION_SECRET,
      cookieSecure: vars.SESSION_COOKIE_SECURE !== "false",
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
