import { describe, expect, it } from "vitest";

import type { LegacyTransactionId } from "@/lib/ids";
import {
  type DuplicateCandidateRow,
  findPossibleDuplicates,
  type NewDuplicatePair,
  summarizeDuplicates,
} from "@/lib/legacy/duplicates";
import {
  ACCOUNT_BANK_1,
  ACCOUNT_BANK_2,
  DUP_BANK_CONTESTED,
  DUP_BANK_FOUR_DAYS,
  DUP_BANK_OPERATION_DATE,
  DUP_BANK_OTHER_ACCOUNT,
  DUP_BANK_SAME_DAY,
  DUP_BANK_SAME_SOURCE_1,
  DUP_BANK_SAME_SOURCE_2,
  DUP_BANK_THREE_DAYS,
  DUP_SHEET_CLOSER,
  DUP_SHEET_FARTHER,
  DUP_SHEET_FOUR_DAYS,
  DUP_SHEET_OPERATION_DATE,
  DUP_SHEET_OTHER_ACCOUNT,
  DUP_SHEET_SAME_DAY,
  DUP_SHEET_SAME_SOURCE_1,
  DUP_SHEET_SAME_SOURCE_2,
  DUP_SHEET_THREE_DAYS,
  LEGACY_DUPLICATE_TRANSACTIONS,
  type LegacyTransactionSeed,
  SECOND_KEY_BANK_BOTH,
  SECOND_KEY_BANK_ONE,
  SECOND_KEY_SHEET_EARLY,
  SECOND_KEY_SHEET_LATE,
} from "@/lib/legacy/legacy-fixture";
import type { LegacySourceKind } from "@/lib/legacy/transactions";

/**
 * A fixture row as the translation hands it to the pairing: the layout of the
 * fixture merges the two bank accounts into one new account, and every
 * spreadsheet row comes from the same file.
 */
function candidate(seed: LegacyTransactionSeed): DuplicateCandidateRow {
  if (seed.accountId === null) {
    throw new Error(`fixture transaction ${seed.id} has no account`);
  }
  return {
    legacyId: seed.id,
    accountKey: seed.accountId === ACCOUNT_BANK_1 ? ACCOUNT_BANK_2 : seed.accountId,
    bookingDate: seed.bookingDate,
    operationDate: seed.operationDate,
    amountMinor: seed.amountMinor,
    source: {
      sourceKind: seed.sourceKind as LegacySourceKind,
      sourceFileName: null,
      legacySourceFileId: null,
      sourceSheet: seed.sourceSheet,
      sourceRecordIndex: seed.sourceRecordIndex,
    },
  };
}

const ROWS = LEGACY_DUPLICATE_TRANSACTIONS.map(candidate);
const PAIRS = findPossibleDuplicates(ROWS);

function pairWith(id: LegacyTransactionId, pairs: readonly NewDuplicatePair[] = PAIRS) {
  return pairs.find((pair) => pair.bankLegacyId === id || pair.sheetLegacyId === id);
}

describe("findPossibleDuplicates", () => {
  it("pairs rows of the merged old accounts with the same booking date", () => {
    expect(pairWith(DUP_SHEET_SAME_DAY)).toEqual({
      bankLegacyId: DUP_BANK_SAME_DAY,
      sheetLegacyId: DUP_SHEET_SAME_DAY,
      bankBookingDate: "2024-05-06",
      dayDifference: 0,
      hasCompetitor: false,
    });
  });

  it("pairs by the operation date of the bank row when it is closer", () => {
    expect(pairWith(DUP_SHEET_OPERATION_DATE)).toEqual({
      bankLegacyId: DUP_BANK_OPERATION_DATE,
      sheetLegacyId: DUP_SHEET_OPERATION_DATE,
      bankBookingDate: "2024-05-13",
      dayDifference: 1,
      hasCompetitor: false,
    });
  });

  it("pairs a bank file row exactly three days away, without an operation date", () => {
    expect(pairWith(DUP_SHEET_THREE_DAYS)).toEqual({
      bankLegacyId: DUP_BANK_THREE_DAYS,
      sheetLegacyId: DUP_SHEET_THREE_DAYS,
      bankBookingDate: "2024-05-23",
      dayDifference: 3,
      hasCompetitor: false,
    });
  });

  it("does not pair rows four days away from both dates of the bank row", () => {
    expect(pairWith(DUP_SHEET_FOUR_DAYS)).toBeUndefined();
    expect(pairWith(DUP_BANK_FOUR_DAYS)).toBeUndefined();
  });

  it("gives a contested bank row the closer spreadsheet row and marks the competitor", () => {
    expect(pairWith(DUP_BANK_CONTESTED)).toEqual({
      bankLegacyId: DUP_BANK_CONTESTED,
      sheetLegacyId: DUP_SHEET_CLOSER,
      bankBookingDate: "2024-06-04",
      dayDifference: 0,
      hasCompetitor: true,
    });
    expect(pairWith(DUP_SHEET_FARTHER)).toBeUndefined();
  });

  it("takes the candidates with fewer competitors first among equal differences", () => {
    const pairs = [SECOND_KEY_BANK_BOTH, SECOND_KEY_BANK_ONE].map((id) => pairWith(id));
    expect(pairs).toEqual([
      {
        bankLegacyId: SECOND_KEY_BANK_BOTH,
        sheetLegacyId: SECOND_KEY_SHEET_LATE,
        bankBookingDate: "2024-06-12",
        dayDifference: 2,
        hasCompetitor: true,
      },
      {
        bankLegacyId: SECOND_KEY_BANK_ONE,
        sheetLegacyId: SECOND_KEY_SHEET_EARLY,
        bankBookingDate: "2024-06-20",
        dayDifference: 2,
        hasCompetitor: true,
      },
    ]);

    // Without the bank row that competes for the earlier spreadsheet row, the
    // counts tie and the position in the source gives it to the other bank row.
    const alone = findPossibleDuplicates(
      ROWS.filter((row) => row.legacyId !== SECOND_KEY_BANK_ONE),
    );
    expect(pairWith(SECOND_KEY_BANK_BOTH, alone)).toMatchObject({
      sheetLegacyId: SECOND_KEY_SHEET_EARLY,
      dayDifference: 2,
    });
    expect(pairWith(SECOND_KEY_SHEET_LATE, alone)).toBeUndefined();
  });

  it("does not pair rows within one source", () => {
    for (const id of [
      DUP_BANK_SAME_SOURCE_1,
      DUP_BANK_SAME_SOURCE_2,
      DUP_SHEET_SAME_SOURCE_1,
      DUP_SHEET_SAME_SOURCE_2,
    ]) {
      expect(pairWith(id)).toBeUndefined();
    }
  });

  it("does not pair rows on different new accounts", () => {
    expect(pairWith(DUP_SHEET_OTHER_ACCOUNT)).toBeUndefined();
    expect(pairWith(DUP_BANK_OTHER_ACCOUNT)).toBeUndefined();
  });

  it("ignores manual rows", () => {
    const manual = ROWS.map((row) =>
      row.legacyId === DUP_SHEET_SAME_DAY
        ? { ...row, source: { ...row.source, sourceKind: "manual" as const } }
        : row,
    );
    expect(pairWith(DUP_BANK_SAME_DAY, findPossibleDuplicates(manual))).toBeUndefined();
  });

  it("uses every row at most once", () => {
    const ids = PAIRS.flatMap((pair) => [pair.bankLegacyId, pair.sheetLegacyId]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PAIRS).toHaveLength(6);
  });

  it("gives the same pairs whatever the order of the input", () => {
    expect(findPossibleDuplicates([...ROWS].reverse())).toEqual(PAIRS);
    expect(findPossibleDuplicates([...ROWS.slice(7), ...ROWS.slice(0, 7)])).toEqual(PAIRS);
  });
});

describe("summarizeDuplicates", () => {
  it("counts the pairs in three disjoint buckets that add up to all pairs, and by month", () => {
    const report = summarizeDuplicates(PAIRS);
    expect(report).toEqual({
      pairs: 6,
      sameDayWithoutCompetitor: 1,
      nearDateWithoutCompetitor: 2,
      withCompetitor: 3,
      byMonth: { "2024-05": 3, "2024-06": 3 },
    });
    expect(
      report.sameDayWithoutCompetitor + report.nearDateWithoutCompetitor + report.withCompetitor,
    ).toBe(report.pairs);
    expect(Object.values(report.byMonth).reduce((sum, count) => sum + count, 0)).toBe(
      report.pairs,
    );
  });

  it("is empty without pairs", () => {
    expect(summarizeDuplicates([])).toEqual({
      pairs: 0,
      sameDayWithoutCompetitor: 0,
      nearDateWithoutCompetitor: 0,
      withCompetitor: 0,
      byMonth: {},
    });
  });
});
