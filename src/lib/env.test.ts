import { describe, expect, it } from "vitest";

import { nonBlankOr, NonBlankSchema } from "@/lib/env";

describe("NonBlankSchema", () => {
  it("accepts a value with something other than whitespace and keeps it as it is", () => {
    expect(NonBlankSchema.parse(" value ")).toBe(" value ");
  });

  it("rejects a missing, empty or blank value", () => {
    for (const value of [undefined, "", " \t\n"]) {
      expect(NonBlankSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("nonBlankOr", () => {
  it("returns the value of the variable when it is set", () => {
    expect(nonBlankOr({ NAME: "value" }, "NAME", "fallback")).toBe("value");
  });

  it("returns the fallback when the variable is unset or blank", () => {
    expect(nonBlankOr({}, "NAME", "fallback")).toBe("fallback");
    expect(nonBlankOr({ NAME: "  " }, "NAME", "fallback")).toBe("fallback");
    expect(nonBlankOr({ OTHER: "value" }, "NAME", "fallback")).toBe("fallback");
  });
});
