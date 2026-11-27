// Made-up transactions that the E2E global setup writes to the `_e2e` database,
// on the accounts and categories of `catalog.ts`. Not taken from any instance.
//
// There are more than fit on one page of the list. The global setup inserts
// them one by one in the order of this array on one connection, so their
// UUIDv7 IDs grow in that order, which is the order within a booking date. The
// fillers come first, with booking dates out of insertion order, so only an
// order by date gives the expected list.

export type FixturePart = {
  /** "Root" or "Root / Subcategory", as in `catalog.ts`. */
  category: string;
  amountMinor: bigint;
  label?: string;
  reportingClass?: "standard" | "business_tax" | "business_expense" | "savings_investment";
  approved: boolean;
};

export type FixtureTransaction = {
  /** Unique among the fixtures, so tests can find each one; null for none. */
  description: string | null;
  /** The name of an account in `catalog.ts`. */
  account: string;
  bookingDate: string;
  operationDate?: string;
  amountMinor: bigint;
  reportingScopeOverride?: "personal" | "business" | "excluded";
  sourceKind?: "legacy_excel" | "bank_file" | "bank_api" | "manual";
  parts: FixturePart[];
};

export type FixtureDuplicatePair = {
  /** Descriptions of the two transactions. */
  first: string;
  second: string;
  dayDifference: number;
};

const FILLER_COUNT = 45;

function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

// 17 and 45 have no common divisor, so the fillers get 45 different dates
// from 2026-01-01 to 2026-02-14, in an order unrelated to their numbers.
const fillers: FixtureTransaction[] = Array.from({ length: FILLER_COUNT }, (_, index) => {
  const n = index + 1;
  const amountMinor = -BigInt(1000 + n * 10);
  return {
    description: `Zakupy ${n}`,
    account: n % 2 === 0 ? "Dom" : "bank 1",
    bookingDate: addDays("2026-01-01", (n * 17) % FILLER_COUNT),
    amountMinor,
    parts: [{ category: "Kategoria B / Podkategoria 2", amountMinor, approved: true }],
  };
});

// All booked in March 2026, after every filler, so they are on the first page.
const cases: FixtureTransaction[] = [
  {
    description: "Wypłata z etykietą",
    account: "bank 1",
    bookingDate: "2026-03-10",
    amountMinor: -123456n,
    sourceKind: "legacy_excel",
    parts: [{ category: "Kategoria A", amountMinor: -123456n, label: "etykieta 1", approved: true }],
  },
  {
    description: "Faktura firmowa",
    account: "bank 1",
    bookingDate: "2026-03-08",
    operationDate: "2026-03-07",
    amountMinor: -50000n,
    sourceKind: "bank_api",
    parts: [
      {
        category: "Kategoria B / Podkategoria 1",
        amountMinor: -50000n,
        reportingClass: "business_expense",
        approved: true,
      },
    ],
  },
  {
    description: "Do sprawdzenia",
    account: "Dom",
    bookingDate: "2026-03-06",
    amountMinor: 250000n,
    sourceKind: "manual",
    parts: [{ category: "Kategoria C / Podkategoria 3", amountMinor: 250000n, approved: false }],
  },
  {
    description: null,
    account: "Cyfrowe konto",
    bookingDate: "2026-03-12",
    amountMinor: -999n,
    parts: [],
  },
  {
    description: "Wydatek w euro",
    account: "Ćwiczebne konto",
    bookingDate: "2026-03-05",
    amountMinor: -4200n,
    reportingScopeOverride: "personal",
    parts: [{ category: "Kategoria B / Podkategoria 2", amountMinor: -4200n, approved: true }],
  },
  {
    description: "Duplikat z banku",
    account: "bank 1",
    bookingDate: "2026-03-03",
    amountMinor: -7700n,
    sourceKind: "bank_api",
    parts: [{ category: "Kategoria B / Podkategoria 1", amountMinor: -7700n, approved: true }],
  },
  {
    description: "Duplikat z arkusza",
    account: "bank 1",
    bookingDate: "2026-03-02",
    amountMinor: -7700n,
    sourceKind: "legacy_excel",
    parts: [{ category: "Kategoria B / Podkategoria 1", amountMinor: -7700n, approved: true }],
  },
  // Same booking date: the one inserted later is later in the source and is
  // listed first.
  {
    description: "Ten sam dzień, wcześniej w źródle",
    account: "Dom",
    bookingDate: "2026-03-15",
    amountMinor: -1500n,
    parts: [{ category: "Kategoria B / Podkategoria 2", amountMinor: -1500n, approved: true }],
  },
  {
    description: "Ten sam dzień, później w źródle",
    account: "Dom",
    bookingDate: "2026-03-15",
    amountMinor: -2500n,
    parts: [{ category: "Kategoria B / Podkategoria 2", amountMinor: -2500n, approved: true }],
  },
  {
    description: "Zakupy podzielone",
    account: "bank 1",
    bookingDate: "2026-03-01",
    amountMinor: -5000n,
    parts: [
      { category: "Kategoria B / Podkategoria 1", amountMinor: -3000n, approved: true },
      { category: "Kategoria B / Podkategoria 2", amountMinor: -2000n, approved: true },
    ],
  },
];

export const fixtureTransactions: FixtureTransaction[] = [...fillers, ...cases];

export const fixtureDuplicatePairs: FixtureDuplicatePair[] = [
  { first: "Duplikat z banku", second: "Duplikat z arkusza", dayDifference: 1 },
];
