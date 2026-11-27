// Reads a PostgreSQL connection URL from an environment variable.
//
// Nothing is read at import time: the build and the unit tests run without a
// database. Problems name the variable only, never its value, because the URL
// usually carries a password. Used by plain `node` scripts, so no `@/` imports.

import { z } from "zod";

import type { Env } from "../env.ts";

export type DatabaseUrlResult = { ok: true; url: string } | { ok: false; problem: string };

const PROTOCOLS = new Set(["postgres:", "postgresql:"]);

// Each message follows the variable name; the first failed rule stops the
// rest, so exactly one problem is reported.
const DatabaseUrlSchema = z
  .string({ error: "is not set." })
  .refine((value) => value.trim() !== "", { error: "is not set.", abort: true })
  .refine((value) => URL.canParse(value), { error: "is not a valid URL.", abort: true })
  .refine((value) => PROTOCOLS.has(new URL(value).protocol), {
    error: "must start with postgres:// or postgresql://.",
  });

export function readDatabaseUrl(name: string, env: Env = process.env): DatabaseUrlResult {
  const result = DatabaseUrlSchema.safeParse(env[name]);
  if (!result.success) {
    return { ok: false, problem: `${name} ${result.error.issues[0].message}` };
  }
  return { ok: true, url: result.data };
}
