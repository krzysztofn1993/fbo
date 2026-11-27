import Link from "next/link";

// Shown for an unknown path and wherever a page calls notFound(), such as the
// details of a transaction that does not exist. Static, with no session or
// data: it is sent with every route.

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Nie znaleziono
        </h1>
        <p className="text-zinc-700 dark:text-zinc-300">
          Nie ma tu strony ani danych, których szukasz.
        </p>
        <Link
          href="/"
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          ← Strona główna
        </Link>
      </div>
    </main>
  );
}
