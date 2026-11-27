import Link from "next/link";
import { Suspense } from "react";

import { verifySession } from "@/lib/auth/dal";
import { listCategoryTree } from "@/lib/catalog/queries";
import { getDb } from "@/lib/db/client";
import { categoryKindNames, categoryTypeNames } from "@/i18n/pl";

export default function CategoriesPage() {
  return (
    <main className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <Link
          href="/"
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          ← Strona główna
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Kategorie
        </h1>
        {/* The session and the data are read at request time, inside this boundary. */}
        <Suspense fallback="Ładowanie…">
          <CategoryTree />
        </Suspense>
      </div>
    </main>
  );
}

async function CategoryTree() {
  await verifySession();

  const result = getDb();
  if (!result.ok) {
    return <p className="text-zinc-700 dark:text-zinc-300">Baza danych nie jest skonfigurowana.</p>;
  }

  const tree = await listCategoryTree(result.db);
  if (tree.length === 0) {
    return (
      <p className="text-zinc-700 dark:text-zinc-300">
        Nie ma jeszcze żadnych kategorii. Przenieś je ze starej wersji poleceniem{" "}
        <code className="font-mono text-sm">npm run legacy:migrate</code>.
      </p>
    );
  }

  // Kept in the order of the database: roots, then the subcategories of each.
  return (
    <ul aria-label="Drzewo kategorii" className="flex flex-col gap-4">
      {tree.map((root) => (
        <li
          key={root.id}
          className="rounded-2xl bg-white p-4 ring-1 ring-black/[.08] dark:bg-zinc-950 dark:ring-white/[.145]"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-black dark:text-zinc-50">{root.name}</h2>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {categoryKindNames[root.kind]}
            </span>
            {root.type === "labeled" && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {categoryTypeNames.labeled}
              </span>
            )}
          </div>
          {root.children.length > 0 && (
            <ul className="mt-3 divide-y divide-black/[.08] border-t border-black/[.08] dark:divide-white/[.145] dark:border-white/[.145]">
              {root.children.map((child) => (
                <li key={child.id} className="flex flex-wrap justify-between gap-x-3 py-2 text-sm">
                  <span className="text-zinc-900 dark:text-zinc-100">{child.name}</span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {categoryKindNames[child.kind]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
