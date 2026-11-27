import Link from "next/link";
import { Suspense } from "react";

import { verifySession } from "@/lib/auth/dal";
import { listAccounts } from "@/lib/catalog/queries";
import { getDb } from "@/lib/db/client";
import { accountTypeNames, reportingScopeNames } from "@/i18n/pl";

export default function AccountsPage() {
  return (
    <main className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <Link
          href="/"
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          ← Strona główna
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">Konta</h1>
        {/* The session and the data are read at request time, inside this boundary. */}
        <Suspense fallback="Ładowanie…">
          <AccountList />
        </Suspense>
      </div>
    </main>
  );
}

async function AccountList() {
  await verifySession();

  const result = getDb();
  if (!result.ok) {
    return <p className="text-zinc-700 dark:text-zinc-300">Baza danych nie jest skonfigurowana.</p>;
  }

  const accounts = await listAccounts(result.db);
  if (accounts.length === 0) {
    return (
      <p className="text-zinc-700 dark:text-zinc-300">
        Nie ma jeszcze żadnych kont. Przenieś je ze starej wersji poleceniem{" "}
        <code className="font-mono text-sm">npm run legacy:migrate</code>.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-black/[.08] dark:bg-zinc-950 dark:ring-white/[.145]">
      <table className="w-full text-left text-sm">
        <thead className="text-zinc-600 dark:text-zinc-400">
          <tr className="border-b border-black/[.08] dark:border-white/[.145]">
            <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Nazwa</th>
            <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Typ</th>
            <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Waluta</th>
            <th scope="col" className="px-1.5 py-2 font-medium sm:px-4">Zakres</th>
          </tr>
        </thead>
        <tbody className="text-zinc-900 dark:text-zinc-100">
          {accounts.map((account) => (
            <tr
              key={account.id}
              className="border-b border-black/[.08] last:border-b-0 dark:border-white/[.145]"
            >
              <td className="px-1.5 py-2 font-medium sm:px-4">{account.name}</td>
              <td className="px-1.5 py-2 sm:px-4">{accountTypeNames[account.type]}</td>
              <td className="px-1.5 py-2 font-mono sm:px-4">{account.currency}</td>
              <td className="px-1.5 py-2 sm:px-4">{reportingScopeNames[account.reportingScope]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
