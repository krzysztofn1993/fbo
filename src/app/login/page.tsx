import { LoginForm } from "./login-form";

// Reads nothing from the request, so the whole page is part of the static
// shell; Proxy sends a signed-in visitor on to the start page.
export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[.08] dark:bg-zinc-950 dark:ring-white/[.145]">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Logowanie
        </h1>
        <LoginForm />
      </div>
    </main>
  );
}
