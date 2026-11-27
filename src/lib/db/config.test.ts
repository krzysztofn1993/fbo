import { describe, expect, it } from "vitest";

import { readDatabaseUrl } from "@/lib/db/config";

const URL_WITH_PASSWORD = "postgres://user1:secret-password-1@127.0.0.1:5433/app_1";

describe("readDatabaseUrl", () => {
  it("returns the URL of the named variable", () => {
    expect(readDatabaseUrl("DATABASE_URL", { DATABASE_URL: URL_WITH_PASSWORD })).toEqual({
      ok: true,
      url: URL_WITH_PASSWORD,
    });
    expect(
      readDatabaseUrl("OTHER_URL", { OTHER_URL: "postgresql://127.0.0.1/app_1" }),
    ).toEqual({ ok: true, url: "postgresql://127.0.0.1/app_1" });
  });

  it("reads only the named variable", () => {
    const result = readDatabaseUrl("DATABASE_URL", { OTHER_URL: URL_WITH_PASSWORD });
    expect(result).toEqual({ ok: false, problem: "DATABASE_URL is not set." });
  });

  it("reports a missing variable", () => {
    expect(readDatabaseUrl("DATABASE_URL", {})).toEqual({
      ok: false,
      problem: "DATABASE_URL is not set.",
    });
  });

  it("reports an empty or blank value as not set", () => {
    for (const value of ["", "   "]) {
      expect(readDatabaseUrl("DATABASE_URL", { DATABASE_URL: value })).toEqual({
        ok: false,
        problem: "DATABASE_URL is not set.",
      });
    }
  });

  it("reports a value that is not a PostgreSQL URL without the value", () => {
    const values = [
      "not a url secret-password-1",
      "mysql://user1:secret-password-1@127.0.0.1/app_1",
      "127.0.0.1:5433/secret-password-1",
    ];
    for (const value of values) {
      const result = readDatabaseUrl("DATABASE_URL", { DATABASE_URL: value });
      expect(result.ok).toBe(false);
      const text = JSON.stringify(result);
      expect(text).toContain("DATABASE_URL");
      expect(text).not.toContain("secret-password-1");
    }
  });
});
