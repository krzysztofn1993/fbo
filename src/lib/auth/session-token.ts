// The session lives in an encrypted cookie; the server keeps no session state.
//
// Both time limits are stored in the sealed payload and checked on every read,
// so they are enforced by the server even though the cookie is stateless. The
// payload also binds the session to the configured username and password hash,
// so changing either signs every session out.

import { sealData, unsealData } from "iron-session";
import { z } from "zod";

import type { AuthConfig } from "@/lib/auth/config";

/** A session ends after this long without activity. */
export const IDLE_TIMEOUT_MS = 3_600_000;
/** A session ends this long after login, whatever the activity. */
export const ABSOLUTE_TIMEOUT_MS = 43_200_000;
/** Activity rewrites the cookie at most this often. */
export const REFRESH_INTERVAL_MS = 60_000;

const PAYLOAD_VERSION = 1;

/** Milliseconds since the epoch. */
const TimestampSchema = z.int().nonnegative();

/** The sealed cookie contents; unknown fields are dropped when it is read. */
const SessionPayloadSchema = z.object({
  v: z.literal(PAYLOAD_VERSION),
  username: z.string(),
  fingerprint: z.string(),
  /** Login time. */
  issuedAt: TimestampSchema,
  /** Last activity. */
  lastActiveAt: TimestampSchema,
});

export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

type SessionIdentity = Pick<AuthConfig, "username" | "passwordHashFingerprint">;
type SessionConfig = SessionIdentity & Pick<AuthConfig, "sessionSecret">;

// iron-session takes the ttl in seconds.
const SEAL_TTL_SECONDS = ABSOLUTE_TIMEOUT_MS / 1000;

export function newSession(config: SessionIdentity, now: number): SessionPayload {
  return {
    v: PAYLOAD_VERSION,
    username: config.username,
    fingerprint: config.passwordHashFingerprint,
    issuedAt: now,
    lastActiveAt: now,
  };
}

export function sealSession(payload: SessionPayload, secret: string): Promise<string> {
  return sealData(payload, { password: secret, ttl: SEAL_TTL_SECONDS });
}

/**
 * Returns the session in `value`, or null when it cannot be decrypted with the
 * configured secret, has another shape or version, belongs to another username
 * or password hash, is idle for IDLE_TIMEOUT_MS or more, is ABSOLUTE_TIMEOUT_MS
 * or more old, or carries a time later than `now`.
 */
export async function openSession(
  value: string,
  config: SessionConfig,
  now: number,
): Promise<SessionPayload | null> {
  let data: unknown;
  try {
    data = await unsealData<unknown>(value, {
      password: config.sessionSecret,
      ttl: SEAL_TTL_SECONDS,
    });
  } catch {
    return null;
  }

  const parsed = SessionPayloadSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const session = parsed.data;
  if (
    session.username !== config.username ||
    session.fingerprint !== config.passwordHashFingerprint
  ) {
    return null;
  }
  if (
    session.issuedAt > now ||
    session.lastActiveAt > now ||
    session.lastActiveAt < session.issuedAt
  ) {
    return null;
  }
  if (now - session.lastActiveAt >= IDLE_TIMEOUT_MS || now - session.issuedAt >= ABSOLUTE_TIMEOUT_MS) {
    return null;
  }

  return session;
}

export function needsRefresh(payload: SessionPayload, now: number): boolean {
  return now - payload.lastActiveAt >= REFRESH_INTERVAL_MS;
}

/** Records activity at `now`; the login time stays as it was. */
export function touch(payload: SessionPayload, now: number): SessionPayload {
  return { ...payload, lastActiveAt: now };
}
