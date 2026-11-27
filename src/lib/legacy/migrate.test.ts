import { describe, expect, it } from "vitest";

import { isSameDatabase } from "@/lib/legacy/migrate";

describe("isSameDatabase", () => {
  it("is true for the same host, port and database", () => {
    expect(
      isSameDatabase("postgres://user1@db-host:5433/app", "postgres://user1@db-host:5433/app"),
    ).toBe(true);
  });

  it("ignores user, password and unrelated query parameters", () => {
    expect(
      isSameDatabase(
        "postgres://user1:password-1@db-host:5433/app",
        "postgres://user2:password-2@db-host:5433/app?application_name=legacy&sslmode=disable",
      ),
    ).toBe(true);
  });

  it("treats a missing port as 5432", () => {
    expect(isSameDatabase("postgres://db-host/app", "postgres://db-host:5432/app")).toBe(true);
    expect(isSameDatabase("postgres://db-host/app", "postgres://db-host:5433/app")).toBe(false);
  });

  it("treats localhost, 127.0.0.1 and ::1 as one host", () => {
    const urls = [
      "postgres://localhost:5433/app",
      "postgres://127.0.0.1:5433/app",
      "postgres://[::1]:5433/app",
      "postgres://LOCALHOST:5433/app",
    ];
    for (const first of urls) {
      for (const second of urls) {
        expect(isSameDatabase(first, second), `${first} vs ${second}`).toBe(true);
      }
    }
  });

  it("does not treat other hosts as loopback", () => {
    expect(isSameDatabase("postgres://127.0.0.1:5433/app", "postgres://127.0.0.2:5433/app")).toBe(
      false,
    );
    expect(isSameDatabase("postgres://localhost:5433/app", "postgres://db-host:5433/app")).toBe(
      false,
    );
  });

  it("compares host names regardless of case", () => {
    expect(isSameDatabase("postgres://DB-Host:5433/app", "postgres://db-host:5433/app")).toBe(true);
  });

  it("is false for a different port or database", () => {
    expect(isSameDatabase("postgres://db-host:5433/app", "postgres://db-host:5434/app")).toBe(false);
    expect(isSameDatabase("postgres://db-host:5433/app", "postgres://db-host:5433/app_old")).toBe(
      false,
    );
    expect(isSameDatabase("postgres://db-host:5433/app", "postgres://db-host:5433/APP")).toBe(false);
  });

  it("reads host and port from the query when the URL gives them there", () => {
    expect(
      isSameDatabase("postgres://other-host:5434/app?host=db-host&port=5433", "postgres://db-host:5433/app"),
    ).toBe(true);
    expect(
      isSameDatabase("postgres://db-host:5433/app?port=5434", "postgres://db-host:5433/app"),
    ).toBe(false);
  });

  it("uses the user name when the URL names no database", () => {
    expect(isSameDatabase("postgres://app@db-host:5433", "postgres://db-host:5433/app")).toBe(true);
    expect(isSameDatabase("postgres://user1@db-host:5433/", "postgres://db-host:5433/app")).toBe(
      false,
    );
  });

  it("decodes a percent-encoded database name", () => {
    expect(isSameDatabase("postgres://db-host:5433/app%5Fold", "postgres://db-host:5433/app_old")).toBe(
      true,
    );
  });
});
