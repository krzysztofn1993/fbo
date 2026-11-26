// Data access layer: the session check every protected page and Server Action
// makes for itself, independent of Proxy.
//
// Call verifySession() behind a <Suspense> boundary in pages (it reads the
// request) and at the start of every Server Action that touches data. It only
// reads the cookie; refreshing it is the job of Proxy.

import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { readAuthConfig, sessionCookieOptions } from "@/lib/auth/config";
import { openSession } from "@/lib/auth/session-token";

export type VerifiedSession = { username: string };

export const verifySession = cache(async (): Promise<VerifiedSession> => {
  // The request is read first, so nothing below (the configuration, the
  // clock, a redirect) can end up in a prerendered result. connection() also
  // keeps it out of the runtime prerender, which may read cookies but not the
  // clock that the expiry checks need.
  const cookieStore = await cookies();
  await connection();

  const result = readAuthConfig();
  if (!result.ok) {
    redirect("/login");
  }
  const { config } = result;

  const cookie = cookieStore.get(sessionCookieOptions(config).name)?.value;
  const session = cookie === undefined ? null : await openSession(cookie, config, Date.now());
  if (session === null) {
    redirect("/login");
  }

  return { username: session.username };
});
