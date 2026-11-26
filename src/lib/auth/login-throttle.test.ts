import { describe, expect, it } from "vitest";

import {
  createLoginThrottle,
  getLoginThrottle,
  type LoginThrottle,
} from "@/lib/auth/login-throttle";

const SECOND = 1000;
const START = Date.UTC(2030, 0, 1, 8, 0, 0);

// Makes one attempt at `now` that must be allowed and records its outcome.
function attempt(throttle: LoginThrottle, now: number, succeeded: boolean): void {
  const result = throttle.begin(now);
  if (!result.allowed) {
    throw new Error(`attempt at +${now - START} ms was refused`);
  }
  result.finish(succeeded, now);
}

// Fails `count` attempts, each as early as the throttle allows, and returns
// the time of the last one.
function failRepeatedly(throttle: LoginThrottle, count: number): number {
  let now = START;
  for (let i = 0; i < count; i += 1) {
    const result = throttle.begin(now);
    if (!result.allowed) {
      now += result.retryAfterSeconds * SECOND;
      i -= 1;
      continue;
    }
    result.finish(false, now);
  }
  return now;
}

describe("createLoginThrottle", () => {
  it("lets the first three attempts through without delay", () => {
    const throttle = createLoginThrottle();
    attempt(throttle, START, false);
    attempt(throttle, START, false);
    attempt(throttle, START, false);
    expect(throttle.begin(START)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("waits 1, 2, 4... s after each further failure, at most 60 s", () => {
    const throttle = createLoginThrottle();
    let now = START;
    attempt(throttle, now, false);
    attempt(throttle, now, false);

    const delays: number[] = [];
    for (let failure = 3; failure <= 11; failure += 1) {
      attempt(throttle, now, false);
      const refused = throttle.begin(now);
      if (refused.allowed) {
        throw new Error(`failure ${failure} set no delay`);
      }
      delays.push(refused.retryAfterSeconds);

      const delay = refused.retryAfterSeconds * SECOND;
      expect(throttle.begin(now + delay - 1).allowed).toBe(false);
      now += delay;
    }

    expect(delays).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  it("rounds the remaining wait up to whole seconds", () => {
    const throttle = createLoginThrottle();
    const last = failRepeatedly(throttle, 5); // next attempt 4 s after the last
    expect(throttle.begin(last + 1)).toEqual({ allowed: false, retryAfterSeconds: 4 });
    expect(throttle.begin(last + 3 * SECOND)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(throttle.begin(last + 3 * SECOND + 999)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("does not count an attempt refused for being too early", () => {
    const throttle = createLoginThrottle();
    const last = failRepeatedly(throttle, 4); // next attempt 2 s after the last

    for (let i = 0; i < 10; i += 1) {
      expect(throttle.begin(last + SECOND).allowed).toBe(false);
    }

    // The fifth failure, not the fifteenth, sets the next delay.
    attempt(throttle, last + 2 * SECOND, false);
    expect(throttle.begin(last + 2 * SECOND)).toEqual({ allowed: false, retryAfterSeconds: 4 });
  });

  it("refuses a parallel attempt while another one is being checked", () => {
    const throttle = createLoginThrottle();
    const first = throttle.begin(START);
    expect(first.allowed).toBe(true);
    expect(throttle.begin(START)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    if (!first.allowed) {
      return;
    }

    first.finish(false, START);
    // The refused attempt was not counted: two more failures are free.
    attempt(throttle, START, false);
    attempt(throttle, START, false);
    expect(throttle.begin(START).allowed).toBe(false);
  });

  it("ignores a second finish on the same attempt", () => {
    const throttle = createLoginThrottle();
    const result = throttle.begin(START);
    if (!result.allowed) {
      throw new Error("expected the first attempt to be allowed");
    }
    result.finish(false, START);
    result.finish(false, START);
    result.finish(false, START);

    attempt(throttle, START, false);
    attempt(throttle, START, false);
    expect(throttle.begin(START)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("resets the counter after a successful login", () => {
    const throttle = createLoginThrottle();
    const last = failRepeatedly(throttle, 6); // next attempt 8 s after the last
    const now = last + 8 * SECOND;
    attempt(throttle, now, true);

    attempt(throttle, now, false);
    attempt(throttle, now, false);
    attempt(throttle, now, false);
    expect(throttle.begin(now)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });
});

describe("getLoginThrottle", () => {
  it("returns the same instance every time", () => {
    expect(getLoginThrottle()).toBe(getLoginThrottle());
  });
});
