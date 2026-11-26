"use client";

import { useActionState } from "react";

import { login } from "@/lib/auth/actions";
import type { LoginState } from "@/lib/auth/actions";

const initialState: LoginState = {};

const inputClassName =
  "h-11 w-full rounded-lg border border-black/[.15] bg-white px-3 text-base text-black outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-white/[.2] dark:bg-black dark:text-zinc-50 dark:focus:ring-zinc-700";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="username" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Nazwa użytkownika
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          defaultValue={state.username}
          className={inputClassName}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Hasło
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          className={inputClassName}
        />
      </div>
      {state.error !== undefined && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 flex h-11 items-center justify-center rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
      >
        Zaloguj się
      </button>
    </form>
  );
}
