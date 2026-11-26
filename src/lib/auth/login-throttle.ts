// Growing delay after failed logins, shared by the whole instance.
//
// There is a single account and no password recovery, so a hard lockout would
// let anyone lock the administrator out. Instead, from the third consecutive
// failure on, the next attempt must wait 1 s, then 2, 4, 8... s, at most 60 s.
// An attempt is reserved before the password is checked, so at most one check
// runs at a time and parallel requests cannot slip past an unrecorded failure.
// The state lives in process memory; a restart resets it.

const FREE_FAILURES = 3;
const MAX_DELAY_SECONDS = 60;
/** Suggested wait when another attempt is still being checked. */
const BUSY_RETRY_SECONDS = 1;

export type LoginAttempt =
  | {
      allowed: true;
      /** Records the outcome and releases the reservation; later calls are ignored. */
      finish(succeeded: boolean, now: number): void;
    }
  | { allowed: false; retryAfterSeconds: number };

export type LoginThrottle = {
  /** Reserves an attempt at `now` (milliseconds since the epoch), or refuses it. */
  begin(now: number): LoginAttempt;
};

function delaySeconds(failures: number): number {
  return Math.min(2 ** (failures - FREE_FAILURES), MAX_DELAY_SECONDS);
}

export function createLoginThrottle(): LoginThrottle {
  let failures = 0;
  let nextAllowedAt = 0;
  let inFlight = false;

  return {
    begin(now) {
      if (inFlight) {
        return { allowed: false, retryAfterSeconds: BUSY_RETRY_SECONDS };
      }
      if (now < nextAllowedAt) {
        return { allowed: false, retryAfterSeconds: Math.ceil((nextAllowedAt - now) / 1000) };
      }

      inFlight = true;
      let finished = false;
      return {
        allowed: true,
        finish(succeeded, finishedAt) {
          if (finished) {
            return;
          }
          finished = true;
          inFlight = false;

          if (succeeded) {
            failures = 0;
            nextAllowedAt = 0;
            return;
          }
          failures += 1;
          if (failures >= FREE_FAILURES) {
            nextAllowedAt = finishedAt + delaySeconds(failures) * 1000;
          }
        },
      };
    },
  };
}

// Kept on globalThis so that every copy of this module shares one counter: the
// bundler may load the same module more than once in one server process.
const GLOBAL_KEY = "__fboLoginThrottle";

type ThrottleHolder = { [GLOBAL_KEY]?: LoginThrottle };

export function getLoginThrottle(): LoginThrottle {
  const holder = globalThis as typeof globalThis & ThrottleHolder;
  let throttle = holder[GLOBAL_KEY];
  if (throttle === undefined) {
    throttle = createLoginThrottle();
    holder[GLOBAL_KEY] = throttle;
  }
  return throttle;
}
