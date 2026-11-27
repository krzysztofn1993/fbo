// Reads a PostgreSQL connection URL from an environment variable.
//
// Nothing is read at import time: the build and the unit tests run without a
// database. Problems name the variable only, never its value, because the URL
// usually carries a password. Used by plain `node` scripts, so no `@/` imports.

export type DatabaseUrlResult = { ok: true; url: string } | { ok: false; problem: string };

type Env = Readonly<Record<string, string | undefined>>;

const PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export function readDatabaseUrl(name: string, env: Env = process.env): DatabaseUrlResult {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return { ok: false, problem: `${name} is not set.` };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, problem: `${name} is not a valid URL.` };
  }
  if (!PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, problem: `${name} must start with postgres:// or postgresql://.` };
  }

  return { ok: true, url: value };
}
