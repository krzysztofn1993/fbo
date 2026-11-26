import { timingSafeEqual } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  hashPassword,
  parsePasswordHash,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "@/lib/auth/password-hash";

// Wraps timingSafeEqual in a spy that still does the real comparison, so the
// tests can check that verification goes through it.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const PASSWORD = "correct horse battery staple";

// Base64url of 16 and 32 zero bytes, for hand-built hashes.
const SALT = "AAAAAAAAAAAAAAAAAAAAAA";
const TAG = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function encoded(params: string, salt = SALT, tag = TAG): string {
  return `argon2id:v=19:${params}:${salt}:${tag}`;
}

// Flips one character of the tag so it still decodes to 32 bytes.
function tamperTag(hash: string): string {
  const parts = hash.split(":");
  const tag = parts[4];
  parts[4] = (tag[0] === "A" ? "B" : "A") + tag.slice(1);
  return parts.join(":");
}

describe("password length limits", () => {
  it("are 15 and 256 characters", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(15);
    expect(PASSWORD_MAX_LENGTH).toBe(256);
  });
});

describe("hashPassword", () => {
  it("encodes argon2id with the OWASP parameters, a 16-byte salt and a 32-byte tag", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^argon2id:v=19:m=19456,t=2,p=1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/);

    const parsed = parsePasswordHash(hash);
    expect(parsed).not.toBeNull();
    expect(parsed?.salt.length).toBe(16);
    expect(parsed?.tag.length).toBe(32);
  });

  it("produces nothing that .env files or Docker Compose would mangle", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain("$");
    expect(hash).not.toMatch(/[#\s"']/);
  });

  it("uses a fresh salt every time", async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);
    expect(first).not.toBe(second);
  });
});

describe("verifyPassword", () => {
  it("accepts the password a hash was made from", async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
  });

  it("verifies the same after the hash is parsed and encoded again", async () => {
    const hash = await hashPassword(PASSWORD);
    const parsed = parsePasswordHash(hash);
    if (parsed === null) {
      throw new Error("expected the hash to parse");
    }
    const reencoded = encoded(
      `m=${parsed.memory},t=${parsed.passes},p=${parsed.parallelism}`,
      parsed.salt.toString("base64url"),
      parsed.tag.toString("base64url"),
    );
    expect(reencoded).toBe(hash);
    await expect(verifyPassword(PASSWORD, reencoded)).resolves.toBe(true);
  });

  it("compares the tags with timingSafeEqual", async () => {
    const hash = await hashPassword(PASSWORD);
    vi.mocked(timingSafeEqual).mockClear();
    await verifyPassword(`${PASSWORD}!`, hash);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword(`${PASSWORD}!`, hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("rejects the right password against a tampered tag", async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword(PASSWORD, tamperTag(hash))).resolves.toBe(false);
  });

  it("rejects the right password when the stored parameters were changed", async () => {
    const hash = await hashPassword(PASSWORD);
    const raised = hash.replace("t=2", "t=3");
    await expect(verifyPassword(PASSWORD, raised)).resolves.toBe(false);
  });

  it("returns false instead of throwing for a malformed or too weak hash", async () => {
    await expect(verifyPassword(PASSWORD, "")).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD, "not a hash")).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD, encoded("m=4096,t=2,p=1"))).resolves.toBe(false);
  });
});

describe("parsePasswordHash", () => {
  it("accepts the minimum parameters and stronger ones", () => {
    expect(parsePasswordHash(encoded("m=19456,t=2,p=1"))).toMatchObject({
      memory: 19456,
      passes: 2,
      parallelism: 1,
    });
    expect(parsePasswordHash(encoded("m=65536,t=3,p=4"))).toMatchObject({
      memory: 65536,
      passes: 3,
      parallelism: 4,
    });
  });

  it("rejects parameters below m=19456, t=2, p=1", () => {
    expect(parsePasswordHash(encoded("m=19455,t=2,p=1"))).toBeNull();
    expect(parsePasswordHash(encoded("m=19456,t=1,p=1"))).toBeNull();
    expect(parsePasswordHash(encoded("m=19456,t=2,p=0"))).toBeNull();
  });

  it("rejects another algorithm, version or layout", () => {
    expect(parsePasswordHash(`argon2i:v=19:m=19456,t=2,p=1:${SALT}:${TAG}`)).toBeNull();
    expect(parsePasswordHash(`argon2id:v=16:m=19456,t=2,p=1:${SALT}:${TAG}`)).toBeNull();
    expect(parsePasswordHash(`$argon2id$v=19$m=19456,t=2,p=1$${SALT}$${TAG}`)).toBeNull();
    expect(parsePasswordHash(encoded("t=2,m=19456,p=1"))).toBeNull();
    expect(parsePasswordHash(`${encoded("m=19456,t=2,p=1")}:extra`)).toBeNull();
    expect(parsePasswordHash(` ${encoded("m=19456,t=2,p=1")}`)).toBeNull();
  });

  it("rejects a salt or tag of the wrong size or with padding", () => {
    expect(parsePasswordHash(encoded("m=19456,t=2,p=1", "AAAAAAAAAAAAAAAAAAAA"))).toBeNull();
    expect(parsePasswordHash(encoded("m=19456,t=2,p=1", SALT, TAG.slice(0, -4)))).toBeNull();
    expect(parsePasswordHash(encoded("m=19456,t=2,p=1", `${SALT}==`))).toBeNull();
    expect(parsePasswordHash(encoded("m=19456,t=2,p=1", SALT, `${TAG}=`))).toBeNull();
  });
});
