import { sealData } from "iron-session";
import { describe, expect, it } from "vitest";

import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  needsRefresh,
  newSession,
  openSession,
  REFRESH_INTERVAL_MS,
  sealSession,
  touch,
} from "@/lib/auth/session-token";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LOGIN_AT = Date.UTC(2030, 0, 1, 8, 0, 0);

const CONFIG = {
  username: "admin",
  passwordHashFingerprint: "fingerprint-of-hash-1",
  sessionSecret: "test-only-session-secret-0123456789",
};

async function sealedAt(now: number): Promise<string> {
  return sealSession(newSession(CONFIG, now), CONFIG.sessionSecret);
}

describe("session limits", () => {
  it("are 1 h idle, 12 h absolute and a 60 s refresh interval", () => {
    expect(IDLE_TIMEOUT_MS).toBe(HOUR);
    expect(ABSOLUTE_TIMEOUT_MS).toBe(12 * HOUR);
    expect(REFRESH_INTERVAL_MS).toBe(MINUTE);
  });
});

describe("newSession", () => {
  it("binds the session to the configured username and password hash", () => {
    expect(newSession(CONFIG, LOGIN_AT)).toEqual({
      v: 1,
      username: "admin",
      fingerprint: "fingerprint-of-hash-1",
      issuedAt: LOGIN_AT,
      lastActiveAt: LOGIN_AT,
    });
  });
});

describe("openSession", () => {
  it("round-trips a sealed session", async () => {
    const value = await sealedAt(LOGIN_AT);
    await expect(openSession(value, CONFIG, LOGIN_AT)).resolves.toEqual(newSession(CONFIG, LOGIN_AT));
  });

  it("is still valid after 59 min idle and expired at exactly 60 min", async () => {
    const value = await sealedAt(LOGIN_AT);
    await expect(openSession(value, CONFIG, LOGIN_AT + 59 * MINUTE)).resolves.not.toBeNull();
    await expect(openSession(value, CONFIG, LOGIN_AT + IDLE_TIMEOUT_MS - 1)).resolves.not.toBeNull();
    await expect(openSession(value, CONFIG, LOGIN_AT + 60 * MINUTE)).resolves.toBeNull();
  });

  it("expires at exactly 12 h even when refreshed every 30 min", async () => {
    let value = await sealedAt(LOGIN_AT);
    let now = LOGIN_AT;
    for (; now < LOGIN_AT + ABSOLUTE_TIMEOUT_MS; now += 30 * MINUTE) {
      const session = await openSession(value, CONFIG, now);
      expect(session, `session at ${(now - LOGIN_AT) / MINUTE} min`).not.toBeNull();
      if (session === null) {
        return;
      }
      value = await sealSession(touch(session, now), CONFIG.sessionSecret);
    }
    expect(now).toBe(LOGIN_AT + 12 * HOUR);
    await expect(openSession(value, CONFIG, now - 1)).resolves.not.toBeNull();
    await expect(openSession(value, CONFIG, now)).resolves.toBeNull();
  });

  it("rejects a session sealed with another secret", async () => {
    const value = await sealSession(
      newSession(CONFIG, LOGIN_AT),
      "another-test-only-session-secret-9876543210",
    );
    await expect(openSession(value, CONFIG, LOGIN_AT)).resolves.toBeNull();
  });

  it("rejects a session after the username changes", async () => {
    const value = await sealedAt(LOGIN_AT);
    await expect(
      openSession(value, { ...CONFIG, username: "admin2" }, LOGIN_AT),
    ).resolves.toBeNull();
  });

  it("rejects a session after the password hash changes", async () => {
    const value = await sealedAt(LOGIN_AT);
    await expect(
      openSession(value, { ...CONFIG, passwordHashFingerprint: "fingerprint-of-hash-2" }, LOGIN_AT),
    ).resolves.toBeNull();
  });

  it("rejects a session that carries a time later than now", async () => {
    const value = await sealedAt(LOGIN_AT);
    await expect(openSession(value, CONFIG, LOGIN_AT - 1)).resolves.toBeNull();

    const touchedLater = touch(newSession(CONFIG, LOGIN_AT), LOGIN_AT + 10 * MINUTE);
    const touchedValue = await sealSession(touchedLater, CONFIG.sessionSecret);
    await expect(openSession(touchedValue, CONFIG, LOGIN_AT + 5 * MINUTE)).resolves.toBeNull();
  });

  it("rejects garbage in the cookie", async () => {
    for (const value of ["", "garbage", "Fe26.2**garbage~2", "~", "a".repeat(4096)]) {
      await expect(openSession(value, CONFIG, LOGIN_AT)).resolves.toBeNull();
    }
  });

  it("rejects a correctly sealed payload of another version or shape", async () => {
    const payloads = [
      { ...newSession(CONFIG, LOGIN_AT), v: 2 },
      { ...newSession(CONFIG, LOGIN_AT), issuedAt: "yesterday" },
      { username: "admin" },
      "admin",
      null,
    ];
    for (const payload of payloads) {
      const value = await sealData(payload, { password: CONFIG.sessionSecret });
      await expect(openSession(value, CONFIG, LOGIN_AT)).resolves.toBeNull();
    }
  });
});

describe("needsRefresh", () => {
  it("is due once 60 s have passed since the last activity", () => {
    const session = newSession(CONFIG, LOGIN_AT);
    expect(needsRefresh(session, LOGIN_AT + REFRESH_INTERVAL_MS - 1)).toBe(false);
    expect(needsRefresh(session, LOGIN_AT + REFRESH_INTERVAL_MS)).toBe(true);
  });
});

describe("touch", () => {
  it("moves the last activity but not the login time", () => {
    const session = newSession(CONFIG, LOGIN_AT);
    const touched = touch(session, LOGIN_AT + 5 * MINUTE);
    expect(touched).toEqual({ ...session, lastActiveAt: LOGIN_AT + 5 * MINUTE });
    expect(touched.issuedAt).toBe(LOGIN_AT);
    expect(session.lastActiveAt).toBe(LOGIN_AT);
  });

  it("keeps a refreshed session alive past one idle period from login", async () => {
    const touched = touch(newSession(CONFIG, LOGIN_AT), LOGIN_AT + 50 * MINUTE);
    const value = await sealSession(touched, CONFIG.sessionSecret);
    const opened = await openSession(value, CONFIG, LOGIN_AT + 100 * MINUTE);
    expect(opened).toEqual(touched);
  });
});
