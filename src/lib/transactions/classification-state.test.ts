import { describe, expect, it } from "vitest";

import {
  CLASSIFICATION_STATES,
  classificationState,
} from "@/lib/transactions/classification-state";

describe("classificationState", () => {
  it("lists the three states in order", () => {
    expect(CLASSIFICATION_STATES).toEqual(["unclassified", "needs_review", "approved"]);
  });

  it("is unclassified without parts", () => {
    expect(classificationState(-1250n, [])).toBe("unclassified");
    expect(classificationState(0n, [])).toBe("unclassified");
  });

  it("is approved when every part is approved and the parts sum to the amount", () => {
    expect(classificationState(-1250n, [{ amountMinor: -1250n, approved: true }])).toBe(
      "approved",
    );
    expect(
      classificationState(4000n, [
        { amountMinor: 2500n, approved: true },
        { amountMinor: 1500n, approved: true },
      ]),
    ).toBe("approved");
  });

  it("needs review when a single part is not approved", () => {
    expect(classificationState(-1250n, [{ amountMinor: -1250n, approved: false }])).toBe(
      "needs_review",
    );
  });

  it("needs review when the parts do not sum to the amount, even if all are approved", () => {
    expect(classificationState(-1250n, [{ amountMinor: -1249n, approved: true }])).toBe(
      "needs_review",
    );
    expect(
      classificationState(4000n, [
        { amountMinor: 2500n, approved: true },
        { amountMinor: 1600n, approved: true },
      ]),
    ).toBe("needs_review");
  });

  it("compares signs too: a negative amount is not matched by positive parts", () => {
    expect(classificationState(-1250n, [{ amountMinor: 1250n, approved: true }])).toBe(
      "needs_review",
    );
    expect(
      classificationState(-1250n, [
        { amountMinor: -1000n, approved: true },
        { amountMinor: -250n, approved: true },
      ]),
    ).toBe("approved");
  });

  it("needs review when one of several parts is not approved", () => {
    expect(
      classificationState(-3000n, [
        { amountMinor: -1000n, approved: true },
        { amountMinor: -1000n, approved: false },
        { amountMinor: -1000n, approved: true },
      ]),
    ).toBe("needs_review");
  });

  it("keeps amounts beyond the safe integer range exact", () => {
    const large = 2n ** 62n;
    expect(
      classificationState(large + 1n, [
        { amountMinor: large, approved: true },
        { amountMinor: 1n, approved: true },
      ]),
    ).toBe("approved");
    expect(
      classificationState(large, [
        { amountMinor: large, approved: true },
        { amountMinor: 1n, approved: true },
      ]),
    ).toBe("needs_review");
  });
});
