// The session lives in an encrypted cookie; the server keeps no session state.
//
// Both time limits are stored in the sealed payload and checked on every read,
// so they are enforced by the server even though the cookie is stateless. The
// payload also binds the session to the configured username and password hash,
// so changing either signs every session out.

import { sealData, unsealData } from "iron-session";

import type { AuthConfig } from "@/lib/auth/config";

/** A session ends after this long without activity. */
export const IDLE_TIMEOUT_MS = 3_600_000;
/** A session ends this long after login, whatever the activity. */
export const ABSOLUTE_TIMEOUT_MS = 43_200_000;
/** Activity rewrites the cookie at most this often. */
export const REFRESH_INTERVAL_MS = 60_000;

const PAYLOAD_VERSION = 1;

export type SessionPayload = {
  v: typeof PAYLOAD_VERSION;
  username: string;
  fingerprint: string;
  /** Login time, in milliseconds since the epoch. */
  issuedAt: number;
  /** Last activity, in milliseconds since the epoch. */
  lastActiveAt: number;
};

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

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === PAYLOAD_VERSION &&
    typeof candidate.username === "string" &&
    typeof candidate.fingerprint === "string" &&
    isTimestamp(candidate.issuedAt) &&
    isTimestamp(candidate.lastActiveAt)
  );
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

  if (!isSessionPayload(data)) {
    return null;
  }
  if (data.username !== config.username || data.fingerprint !== config.passwordHashFingerprint) {
    return null;
  }
  if (data.issuedAt > now || data.lastActiveAt > now || data.lastActiveAt < data.issuedAt) {
    return null;
  }
  if (now - data.lastActiveAt >= IDLE_TIMEOUT_MS || now - data.issuedAt >= ABSOLUTE_TIMEOUT_MS) {
    return null;
  }

  return {
    v: PAYLOAD_VERSION,
    username: data.username,
    fingerprint: data.fingerprint,
    issuedAt: data.issuedAt,
    lastActiveAt: data.lastActiveAt,
  };
}

export function needsRefresh(payload: SessionPayload, now: number): boolean {
  return now - payload.lastActiveAt >= REFRESH_INTERVAL_MS;
}

/** Records activity at `now`; the login time stays as it was. */
export function touch(payload: SessionPayload, now: number): SessionPayload {
  return { ...payload, lastActiveAt: now };
}
