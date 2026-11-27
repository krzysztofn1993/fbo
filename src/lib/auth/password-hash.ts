// Password hashing with argon2id from node:crypto.
//
// The encoded form is `argon2id:v=19:m=<KiB>,t=<passes>,p=<lanes>:<salt>:<tag>`
// with salt and tag in base64url without padding. Unlike the PHC string
// (`$argon2id$...`) it contains no `$`, `#`, spaces or quotes, so it survives
// `.env` files and Docker Compose, both of which expand `$NAME` in values.
//
// This module is also run by plain `node` (type stripping) from the hash
// command, so it imports only packages and uses only erasable syntax.

import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 256;

/** A password the hash command accepts for a new hash. */
export const NewPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

const ALGORITHM = "argon2id";
const VERSION = 19;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

/** OWASP minimum for argon2id; hashes with weaker parameters are rejected. */
const MIN_MEMORY_KIB = 19456;
const MIN_PASSES = 2;
const MIN_PARALLELISM = 1;

const DEFAULT_PARAMS: PasswordHashParams = {
  memory: MIN_MEMORY_KIB,
  passes: MIN_PASSES,
  parallelism: MIN_PARALLELISM,
};

export type PasswordHashParams = {
  /** Memory cost in KiB. */
  memory: number;
  /** Number of passes (time cost). */
  passes: number;
  /** Degree of parallelism (lanes). */
  parallelism: number;
};

export type ParsedPasswordHash = PasswordHashParams & {
  salt: Buffer;
  tag: Buffer;
};

const ENCODED_PATTERN =
  /^argon2id:v=19:m=([1-9][0-9]{0,9}),t=([1-9][0-9]{0,9}),p=([1-9][0-9]{0,9}):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/;

// Decodes base64url and returns null unless the input is the canonical
// encoding of exactly `length` bytes, so one hash has one spelling.
function decodeExact(value: string, length: number): Buffer | null {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value) {
    return null;
  }
  return bytes;
}

/**
 * Parses an encoded hash. Returns null for anything malformed, for another
 * algorithm or version, and for parameters below m=19456, t=2, p=1.
 */
export function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  const match = ENCODED_PATTERN.exec(encoded);
  if (match === null) {
    return null;
  }

  const memory = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  if (memory < MIN_MEMORY_KIB || passes < MIN_PASSES || parallelism < MIN_PARALLELISM) {
    return null;
  }

  const salt = decodeExact(match[4], SALT_BYTES);
  const tag = decodeExact(match[5], TAG_BYTES);
  if (salt === null || tag === null) {
    return null;
  }

  return { memory, passes, parallelism, salt, tag };
}

function deriveTag(
  password: string,
  salt: Buffer,
  params: PasswordHashParams,
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      ALGORITHM,
      {
        message: password,
        nonce: salt,
        memory: params.memory,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength,
      },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
        } else {
          resolve(derivedKey);
        }
      },
    );
  });
}

/** Hashes a password with a fresh random salt and the default parameters. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await deriveTag(password, salt, DEFAULT_PARAMS, TAG_BYTES);
  const { memory, passes, parallelism } = DEFAULT_PARAMS;
  return [
    ALGORITHM,
    `v=${VERSION}`,
    `m=${memory},t=${passes},p=${parallelism}`,
    salt.toString("base64url"),
    tag.toString("base64url"),
  ].join(":");
}

/**
 * Checks a password against an encoded hash in constant time. A malformed or
 * too weak hash yields false rather than an error.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (parsed === null) {
    return false;
  }

  try {
    const candidate = await deriveTag(password, parsed.salt, parsed, parsed.tag.length);
    return timingSafeEqual(candidate, parsed.tag);
  } catch {
    return false;
  }
}
