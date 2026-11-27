import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { verifySession } from "@/lib/auth/dal";
import { getDb } from "@/lib/db/client";
import { formatAmount } from "@/lib/money/format";
import { listTransactions, type PartCategory } from "@/lib/transactions/queries";
import { classificationStateNames } from "@/i18n/pl";

// `?page=` is a whole number from 1; anything else, or nothing, is page 1. A
// page beyond the last one is clamped by the query.
const PageParamSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1))
  .catch(1);

type SearchParams = PageProps<"/transactions">["searchParams"];

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <main className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <Link
          href="/"
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          ← Strona główna
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Transakcje
        </h1>
        {/* The session, the query string and the data are read at request time, inside this boundary. */}
        <Suspense fallback="Ładowanie…">
          <TransactionTable searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

/** One part: "root / subcategory" or the root name; several: "split (N)"; none: a dash. */
function categoryLabel(parts: readonly PartCategory[]): string {
  if (parts.length === 0) {
    return "—";
  }
  if (parts.length > 1) {
    return `Podzielona (${parts.length})`;
  }
  const [{ categoryName, parentCategoryName }] = parts;
  return parentCategoryName === null ? categoryName : `${parentCategoryName} / ${categoryName}`;
}

const pageLinkClassName =
  "flex h-10 items-center justify-center rounded-full border border-solid border-black/[.08] px-4 font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]";

const disabledPageLinkClassName =
  "flex h-10 items-center justify-center rounded-full border border-solid border-black/[.08] px-4 font-medium text-zinc-400 dark:border-white/[.145] dark:text-zinc-600";

async function TransactionTable({ searchParams }: { searchParams: SearchParams }) {
  await verifySession();

  const result = getDb();
  if (!result.ok) {
    return <p className="text-zinc-700 dark:text-zinc-300">Baza danych nie jest skonfigurowana.</p>;
  }

  const requested = PageParamSchema.parse((await searchParams).page);
  const { items, total, page, pageCount } = await listTransactions(result.db, requested);
  if (total === 0) {
    return (
      <p className="text-zinc-700 dark:text-zinc-300">
        Nie ma jeszcze żadnych transakcji. Przenieś je ze starej wersji poleceniem{" "}
        <code className="font-mono text-sm">npm run legacy:migrate</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Liczba transakcji: {total}</p>
      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-black/[.08] dark:bg-zinc-950 dark:ring-white/[.145]">
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-600 dark:text-zinc-400">
            <tr className="border-b border-black/[.08] dark:border-white/[.145]">
              <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Data</th>
              <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Opis</th>
              <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Konto</th>
              <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Kategoria</th>
              <th scope="col" className="px-1.5 py-2 text-right font-medium sm:px-4">Kwota</th>
              <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Stan</th>
            </tr>
          </thead>
          <tbody className="text-zinc-900 dark:text-zinc-100">
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b border-black/[.08] last:border-b-0 dark:border-white/[.145]"
              >
                <td className="whitespace-nowrap px-1.5 py-2 font-mono sm:px-4">{item.bookingDate}</td>
                <td className="min-w-48 px-1.5 py-2 sm:px-4">
                  <Link
                    href={`/transactions/${item.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {item.description ?? "Bez opisu"}
                  </Link>
                  {item.hasPossibleDuplicate && (
                    <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      możliwy duplikat
                    </span>
                  )}
                </td>
                <td className="px-1.5 py-2 sm:px-4">{item.accountName}</td>
                <td className="px-1.5 py-2 sm:px-4">{categoryLabel(item.parts)}</td>
                <td className="whitespace-nowrap px-1.5 py-2 text-right font-mono sm:px-4">
                  {formatAmount(item.amountMinor, item.currency)}
                </td>
                <td className="whitespace-nowrap px-1.5 py-2 sm:px-4">
                  {classificationStateNames[item.state]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Strony" className="flex flex-wrap items-center justify-between gap-3">
        {page > 1 ? (
          <Link href={`/transactions?page=${page - 1}`} className={pageLinkClassName}>
            Poprzednia
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledPageLinkClassName}>
            Poprzednia
          </span>
        )}
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Strona {page} z {pageCount}
        </p>
        {page < pageCount ? (
          <Link href={`/transactions?page=${page + 1}`} className={pageLinkClassName}>
            Następna
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledPageLinkClassName}>
            Następna
          </span>
        )}
      </nav>
    </div>
  );
}
