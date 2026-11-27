// Shared pieces for reading environment variables with Zod schemas.
//
// Problems are reported by variable name only: Zod issues carry no input
// values, and callers never put one into a message. Loaded by plain `node`
// scripts and test setups, so it imports only packages.

import { z } from "zod";

export type Env = Readonly<Record<string, string | undefined>>;

/** A set variable with something other than whitespace in it. */
export const NonBlankSchema = z.string().refine((value) => value.trim() !== "");

/** The value of `name` when it is set and not blank, otherwise `fallback`. */
export function nonBlankOr(env: Env, name: string, fallback: string): string {
  const result = NonBlankSchema.safeParse(env[name]);
  return result.success ? result.data : fallback;
}
