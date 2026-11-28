// Finds the transactions that may record one money movement twice: once as a
// row of the old spreadsheet and once as a row from the bank, on the same new
// account (merged old accounts included) and with the same amount. The old
// version kept both sources for the months they overlap, so the migration
// moves both and only marks the pairs; resolving them is left to the user.
//
// A pure function over the translated transactions, independent of the order
// of its input: every tie is broken by the position of the rows in the source.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import type { LegacyAccountId, LegacyTransactionId } from "../ids.ts";
import { compareSourcePosition, type SourcePosition } from "./transactions.ts";

/** The most calendar days between the dates of the two rows of a pair. */
export const MAX_DAY_DIFFERENCE = 3;

const MS_PER_DAY = 86_400_000;

/** What the pairing reads from a translated transaction. */
export type DuplicateCandidateRow = SourcePosition & {
  /** Key of the new account; merged old accounts share one. */
  accountKey: LegacyAccountId;
  amountMinor: bigint;
};

/** A marked pair, in the shape of `possible_duplicates` with old IDs. */
export type NewDuplicatePair = {
  /** The row from the bank, stored as the first transaction of the pair. */
  bankLegacyId: LegacyTransactionId;
  /** The row from the spreadsheet, stored as the second transaction of the pair. */
  sheetLegacyId: LegacyTransactionId;
  /** Booking date of the row from the bank, `YYYY-MM-DD`. */
  bankBookingDate: string;
  /**
   * Calendar days between the booking date of the spreadsheet row and the
   * closer of the booking and operation dates of the bank row.
   */
  dayDifference: number;
  /** Either row was also a candidate for a pair with another row. */
  hasCompetitor: boolean;
};

/** The pairs in three disjoint buckets, and by month. */
export type DuplicateReport = {
  pairs: number;
  /** Zero days apart, and neither row had another candidate. */
  sameDayWithoutCompetitor: number;
  /** One to three days apart, and neither row had another candidate. */
  nearDateWithoutCompetitor: number;
  /** Either row had another candidate, whatever the difference. */
  withCompetitor: number;
  /** Pairs by the month (`YYYY-MM`) of the bank row's booking date, oldest first. */
  byMonth: Record<string, number>;
};

type Candidate = {
  bank: DuplicateCandidateRow;
  sheet: DuplicateCandidateRow;
  dayDifference: number;
};

/** Days since the epoch of a `YYYY-MM-DD` calendar date, without time zones. */
function dayNumber(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function sideOf(row: DuplicateCandidateRow): "bank" | "sheet" | null {
  switch (row.source.sourceKind) {
    case "bank_api":
    case "bank_file":
      return "bank";
    case "legacy_excel":
      return "sheet";
    case "manual":
      return null;
  }
}

/**
 * Pairs rows from the bank with rows from the spreadsheet, each row in at most
 * one pair. A candidate is a bank row and a spreadsheet row on the same new
 * account with the same amount, where the booking date of the spreadsheet row
 * is at most three days from the booking or the operation date of the bank
 * row. The candidates are walked in ascending order of (1) the day difference,
 * (2) the number of candidates of the bank row plus that of the spreadsheet
 * row, so a row with a single candidate is not taken by a row with others,
 * (3) the booking date of the bank row, and (4) the position in the source of
 * the bank row, then of the spreadsheet row; a candidate becomes a pair when
 * neither of its rows is in a pair yet. The pairs come in the order taken.
 */
export function findPossibleDuplicates(rows: readonly DuplicateCandidateRow[]): NewDuplicatePair[] {
  // Rows that can pair: same account and amount, one list per source side.
  type Group = { bank: DuplicateCandidateRow[]; sheet: DuplicateCandidateRow[] };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const side = sideOf(row);
    if (side === null) {
      continue;
    }
    const key = `${row.accountKey} ${row.amountMinor}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { bank: [], sheet: [] };
      groups.set(key, group);
    }
    group[side].push(row);
  }

  const candidates: Candidate[] = [];
  const candidateCount = new Map<LegacyTransactionId, number>();
  const countOf = (id: LegacyTransactionId) => candidateCount.get(id) ?? 0;
  for (const group of groups.values()) {
    for (const bank of group.bank) {
      const bookingDay = dayNumber(bank.bookingDate);
      const operationDay =
        bank.operationDate === null ? bookingDay : dayNumber(bank.operationDate);
      for (const sheet of group.sheet) {
        const sheetDay = dayNumber(sheet.bookingDate);
        const dayDifference = Math.min(
          Math.abs(sheetDay - bookingDay),
          Math.abs(sheetDay - operationDay),
        );
        if (dayDifference <= MAX_DAY_DIFFERENCE) {
          candidates.push({ bank, sheet, dayDifference });
          candidateCount.set(bank.legacyId, countOf(bank.legacyId) + 1);
          candidateCount.set(sheet.legacyId, countOf(sheet.legacyId) + 1);
        }
      }
    }
  }

  const contention = (candidate: Candidate) =>
    countOf(candidate.bank.legacyId) + countOf(candidate.sheet.legacyId);
  // The position in the source starts with the booking date, so comparing the
  // bank rows by it covers both the booking date and the position.
  candidates.sort(
    (a, b) =>
      a.dayDifference - b.dayDifference ||
      contention(a) - contention(b) ||
      compareSourcePosition(a.bank, b.bank) ||
      compareSourcePosition(a.sheet, b.sheet),
  );

  const paired = new Set<LegacyTransactionId>();
  const pairs: NewDuplicatePair[] = [];
  for (const { bank, sheet, dayDifference } of candidates) {
    if (paired.has(bank.legacyId) || paired.has(sheet.legacyId)) {
      continue;
    }
    paired.add(bank.legacyId);
    paired.add(sheet.legacyId);
    pairs.push({
      bankLegacyId: bank.legacyId,
      sheetLegacyId: sheet.legacyId,
      bankBookingDate: bank.bookingDate,
      dayDifference,
      hasCompetitor: countOf(bank.legacyId) > 1 || countOf(sheet.legacyId) > 1,
    });
  }
  return pairs;
}

/** Counts the pairs in the three disjoint buckets and by month. */
export function summarizeDuplicates(pairs: readonly NewDuplicatePair[]): DuplicateReport {
  const report: DuplicateReport = {
    pairs: pairs.length,
    sameDayWithoutCompetitor: 0,
    nearDateWithoutCompetitor: 0,
    withCompetitor: 0,
    byMonth: {},
  };
  const byMonth = new Map<string, number>();
  for (const pair of pairs) {
    if (pair.hasCompetitor) {
      report.withCompetitor += 1;
    } else if (pair.dayDifference === 0) {
      report.sameDayWithoutCompetitor += 1;
    } else {
      report.nearDateWithoutCompetitor += 1;
    }
    const month = pair.bankBookingDate.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }
  for (const month of [...byMonth.keys()].sort()) {
    report.byMonth[month] = byMonth.get(month) ?? 0;
  }
  return report;
}
