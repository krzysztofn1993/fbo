import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { verifySession } from "@/lib/auth/dal";
import { getDb } from "@/lib/db/client";
import { TransactionIdSchema } from "@/lib/ids";
import { formatAmount } from "@/lib/money/format";
import { getTransaction, type PartCategory } from "@/lib/transactions/queries";
import {
  classificationStateNames,
  legacySourceKindNames,
  reportingClassNames,
  reportingScopeNames,
} from "@/i18n/pl";

// No generateStaticParams: the IDs are known only at request time, and with
// Cache Components an empty list fails the build.

type Params = PageProps<"/transactions/[id]">["params"];

export default function TransactionPage({ params }: PageProps<"/transactions/[id]">) {
  return (
    <main className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <Link
          href="/transactions"
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          ← Transakcje
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Transakcja
        </h1>
        {/* The session, the ID and the data are read at request time, inside this boundary. */}
        <Suspense fallback="Ładowanie…">
          <TransactionDetails params={params} />
        </Suspense>
      </div>
    </main>
  );
}

function categoryPath({ categoryName, parentCategoryName }: PartCategory): string {
  return parentCategoryName === null ? categoryName : `${parentCategoryName} / ${categoryName}`;
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-zinc-600 sm:w-44 sm:shrink-0 dark:text-zinc-400">{name}</dt>
      <dd className="text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  );
}

async function TransactionDetails({ params }: { params: Params }) {
  await verifySession();

  const result = getDb();
  if (!result.ok) {
    return <p className="text-zinc-700 dark:text-zinc-300">Baza danych nie jest skonfigurowana.</p>;
  }

  const id = TransactionIdSchema.safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  const transaction = await getTransaction(result.db, id.data);
  if (transaction === null) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-8">
      <dl className="flex flex-col gap-3 rounded-2xl bg-white p-4 text-sm ring-1 ring-black/[.08] dark:bg-zinc-950 dark:ring-white/[.145]">
        <Field name="Kwota">
          <span className="font-mono">{formatAmount(transaction.amountMinor, transaction.currency)}</span>
        </Field>
        <Field name="Data księgowania">
          <span className="font-mono">{transaction.bookingDate}</span>
        </Field>
        <Field name="Data operacji">
          <span className="font-mono">{transaction.operationDate ?? "—"}</span>
        </Field>
        <Field name="Konto">
          {transaction.accountName} ({reportingScopeNames[transaction.accountReportingScope]})
        </Field>
        {transaction.reportingScopeOverride !== null && (
          <Field name="Zakres transakcji">
            {reportingScopeNames[transaction.reportingScopeOverride]}
          </Field>
        )}
        <Field name="Źródło">
          {transaction.sourceKind === null ? "—" : legacySourceKindNames[transaction.sourceKind]}
        </Field>
        <Field name="Opis">{transaction.description ?? "Bez opisu"}</Field>
        <Field name="Stan">{classificationStateNames[transaction.state]}</Field>
      </dl>

      <section aria-labelledby="parts-heading" className="flex flex-col gap-3">
        <h2 id="parts-heading" className="text-lg font-semibold text-black dark:text-zinc-50">
          Części
        </h2>
        {transaction.parts.length === 0 ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">Transakcja nie ma części.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-black/[.08] dark:bg-zinc-950 dark:ring-white/[.145]">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-600 dark:text-zinc-400">
                <tr className="border-b border-black/[.08] dark:border-white/[.145]">
                  <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Kategoria</th>
                  <th scope="col" className="px-1.5 py-2 text-right font-medium sm:px-4">Kwota</th>
                  <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Etykieta</th>
                  <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Klasa</th>
                  <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Zatwierdzona</th>
                </tr>
              </thead>
              <tbody className="text-zinc-900 dark:text-zinc-100">
                {transaction.parts.map((part) => (
                  <tr
                    key={part.id}
                    className="border-b border-black/[.08] last:border-b-0 dark:border-white/[.145]"
                  >
                    <td className="px-1.5 py-2 sm:px-4">{categoryPath(part)}</td>
                    <td className="whitespace-nowrap px-1.5 py-2 text-right font-mono sm:px-4">
                      {formatAmount(part.amountMinor, transaction.currency)}
                    </td>
                    <td className="px-1.5 py-2 sm:px-4">{part.label ?? "—"}</td>
                    <td className="px-1.5 py-2 sm:px-4">{reportingClassNames[part.reportingClass]}</td>
                    <td className="px-1.5 py-2 sm:px-4">{part.approved ? "tak" : "nie"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {transaction.possibleDuplicates.length > 0 && (
        <section aria-labelledby="duplicates-heading" className="flex flex-col gap-3">
          <h2 id="duplicates-heading" className="text-lg font-semibold text-black dark:text-zinc-50">
            Możliwy duplikat
          </h2>
          <ul className="flex flex-col gap-3">
            {transaction.possibleDuplicates.map((other) => (
              <li
                key={other.id}
                className="flex flex-col gap-1 rounded-2xl bg-white p-4 text-sm ring-1 ring-black/[.08] dark:bg-zinc-950 dark:ring-white/[.145]"
              >
                <Link
                  href={`/transactions/${other.id}`}
                  className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
                >
                  {other.description ?? "Bez opisu"}
                </Link>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-700 dark:text-zinc-300">
                  <span className="font-mono">{other.bookingDate}</span>
                  <span className="font-mono">{formatAmount(other.amountMinor, other.currency)}</span>
                  <span>
                    {other.sourceKind === null ? "—" : legacySourceKindNames[other.sourceKind]}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
