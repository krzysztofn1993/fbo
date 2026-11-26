import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readAuthConfig, sessionCookieOptions } from "@/lib/auth/config";

// A well-formed hash of the minimum strength; its salt and tag are all zero
// bytes, so it matches no password and is test data only.
const PASSWORD_HASH =
  "argon2id:v=19:m=19456,t=2,p=1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SECRET = "test-only-session-secret-0123456789";

const VALID_ENV = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD_HASH: PASSWORD_HASH,
  SESSION_SECRET: SECRET,
};

function problemsOf(env: Record<string, string | undefined>): string[] {
  const result = readAuthConfig(env);
  return result.ok ? [] : result.problems;
}

describe("readAuthConfig", () => {
  it("returns the configuration for valid variables", () => {
    const result = readAuthConfig(VALID_ENV);
    expect(result).toEqual({
      ok: true,
      config: {
        username: "admin",
        passwordHash: PASSWORD_HASH,
        passwordHashFingerprint: createHash("sha256")
          .update(PASSWORD_HASH)
          .digest()
          .subarray(0, 16)
          .toString("base64url"),
        sessionSecret: SECRET,
        cookieSecure: true,
      },
    });
  });

  it("derives a 16-byte base64url fingerprint that changes with the hash", () => {
    const first = readAuthConfig(VALID_ENV);
    const second = readAuthConfig({
      ...VALID_ENV,
      ADMIN_PASSWORD_HASH: PASSWORD_HASH.replace(/A$/, "Q"),
    });
    if (!first.ok || !second.ok) {
      throw new Error("expected both configurations to be valid");
    }
    expect(first.config.passwordHashFingerprint).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second.config.passwordHashFingerprint).not.toBe(first.config.passwordHashFingerprint);
  });

  it("reports every variable when nothing is set", () => {
    expect(problemsOf({})).toEqual(["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "SESSION_SECRET"]);
  });

  it("reports a missing or empty ADMIN_USERNAME", () => {
    expect(problemsOf({ ...VALID_ENV, ADMIN_USERNAME: undefined })).toEqual(["ADMIN_USERNAME"]);
    expect(problemsOf({ ...VALID_ENV, ADMIN_USERNAME: "" })).toEqual(["ADMIN_USERNAME"]);
    expect(problemsOf({ ...VALID_ENV, ADMIN_USERNAME: "   " })).toEqual(["ADMIN_USERNAME"]);
  });

  it("reports a missing, malformed or too weak ADMIN_PASSWORD_HASH", () => {
    expect(problemsOf({ ...VALID_ENV, ADMIN_PASSWORD_HASH: undefined })).toEqual([
      "ADMIN_PASSWORD_HASH",
    ]);
    expect(problemsOf({ ...VALID_ENV, ADMIN_PASSWORD_HASH: "plain-text-password" })).toEqual([
      "ADMIN_PASSWORD_HASH",
    ]);
    expect(
      problemsOf({ ...VALID_ENV, ADMIN_PASSWORD_HASH: PASSWORD_HASH.replace("t=2", "t=1") }),
    ).toEqual(["ADMIN_PASSWORD_HASH"]);
  });

  it("reports a missing SESSION_SECRET or one shorter than 32 characters", () => {
    expect(problemsOf({ ...VALID_ENV, SESSION_SECRET: undefined })).toEqual(["SESSION_SECRET"]);
    expect(problemsOf({ ...VALID_ENV, SESSION_SECRET: "x".repeat(31) })).toEqual([
      "SESSION_SECRET",
    ]);
    expect(problemsOf({ ...VALID_ENV, SESSION_SECRET: "x".repeat(32) })).toEqual([]);
  });

  it("treats an absent or \"true\" SESSION_COOKIE_SECURE as secure", () => {
    for (const value of [undefined, "true"]) {
      const result = readAuthConfig({ ...VALID_ENV, SESSION_COOKIE_SECURE: value });
      expect(result.ok && result.config.cookieSecure).toBe(true);
    }
  });

  it("turns Secure off only for SESSION_COOKIE_SECURE=false", () => {
    const result = readAuthConfig({ ...VALID_ENV, SESSION_COOKIE_SECURE: "false" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.config.cookieSecure).toBe(false);
  });

  it("reports any other SESSION_COOKIE_SECURE value", () => {
    for (const value of ["", "0", "no", "FALSE", "True", "yes"]) {
      expect(problemsOf({ ...VALID_ENV, SESSION_COOKIE_SECURE: value })).toEqual([
        "SESSION_COOKIE_SECURE",
      ]);
    }
  });

  it("names the problem variables without their values", () => {
    const result = readAuthConfig({
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD_HASH: "secret-looking-value",
      SESSION_SECRET: "short-secret",
      SESSION_COOKIE_SECURE: "maybe",
    });
    expect(result).toEqual({
      ok: false,
      problems: ["ADMIN_PASSWORD_HASH", "SESSION_SECRET", "SESSION_COOKIE_SECURE"],
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("secret-looking-value");
    expect(text).not.toContain("short-secret");
    expect(text).not.toContain("maybe");
  });
});

describe("sessionCookieOptions", () => {
  it("uses the __Host- name with Secure by default", () => {
    expect(sessionCookieOptions({ cookieSecure: true })).toEqual({
      name: "__Host-fbo_session",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 3600,
    });
  });

  it("drops the prefix together with Secure", () => {
    expect(sessionCookieOptions({ cookieSecure: false })).toEqual({
      name: "fbo_session",
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
      maxAge: 3600,
    });
  });
});
