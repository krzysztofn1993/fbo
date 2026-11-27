import { describe, expect, it } from "vitest";

import { disposableDatabaseName } from "@/lib/db/test-database";

const BASE = "postgres://user1:password-1@127.0.0.1:5433";

describe("disposableDatabaseName", () => {
  it("accepts names that end in a test suffix", () => {
    expect(disposableDatabaseName(`${BASE}/app_test`)).toBe("app_test");
    expect(disposableDatabaseName(`${BASE}/app_test_legacy`)).toBe("app_test_legacy");
    expect(disposableDatabaseName(`${BASE}/app_e2e`)).toBe("app_e2e");
  });

  it("refuses names that only resemble a test database", () => {
    for (const name of [
      "app",
      "app_testing",
      "app_test_",
      "app_tests",
      "app-test",
      "apptest",
      "app_test_legacy_copy",
      "app_e2e2",
      "app_E2E",
      "app_TEST",
      "test_app",
    ]) {
      expect(() => disposableDatabaseName(`${BASE}/${name}`), name).toThrow(
        `Refusing to prepare database "${name}"`,
      );
    }
  });

  it("refuses a bare suffix and a URL without a database", () => {
    for (const name of ["_test", "_test_legacy", "_e2e"]) {
      expect(() => disposableDatabaseName(`${BASE}/${name}`), name).toThrow("Refusing");
    }
    expect(() => disposableDatabaseName(BASE)).toThrow('Refusing to prepare database ""');
    expect(() => disposableDatabaseName(`${BASE}/`)).toThrow('Refusing to prepare database ""');
  });

  it("takes the name from the path, never from the query", () => {
    expect(disposableDatabaseName(`${BASE}/app_test?sslmode=disable`)).toBe("app_test");
    expect(() => disposableDatabaseName(`${BASE}/app?database=app_test`)).toThrow(
      'Refusing to prepare database "app"',
    );
    expect(() => disposableDatabaseName(`${BASE}/app_test/extra`)).toThrow(
      'Refusing to prepare database "app_test/extra"',
    );
  });

  it("decodes a percent-encoded name before checking it", () => {
    expect(disposableDatabaseName(`${BASE}/app%5Ftest`)).toBe("app_test");
    expect(() => disposableDatabaseName(`${BASE}/app_test%00x`)).toThrow("Refusing");
  });

  it("refuses an invalid URL or invalid percent-encoding without echoing it", () => {
    expect(() => disposableDatabaseName("not a url")).toThrow(
      "The test database URL is not a valid URL.",
    );
    expect(() => disposableDatabaseName(`${BASE}/app_test%E0%A4%A`)).toThrow(
      "The test database URL is not a valid URL.",
    );
  });

  it("does not put the password in the message", () => {
    expect(() => disposableDatabaseName(`${BASE}/app`)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("password-1") }),
    );
  });
});
