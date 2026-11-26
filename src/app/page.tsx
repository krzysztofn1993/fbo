import { Suspense } from "react";

import { logout } from "@/lib/auth/actions";
import { verifySession } from "@/lib/auth/dal";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">FBO</h1>
        {/* Everything that depends on the session stays inside this boundary. */}
        <Suspense fallback="Ładowanie…">
          <SessionPanel />
        </Suspense>
      </div>
    </main>
  );
}

async function SessionPanel() {
  const { username } = await verifySession();

  return (
    <div className="flex flex-wrap items-center gap-4">
      <p className="text-zinc-700 dark:text-zinc-300">Zalogowano jako {username}</p>
      <form action={logout}>
        <button
          type="submit"
          className="flex h-10 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          Wyloguj
        </button>
      </form>
    </div>
  );
}
