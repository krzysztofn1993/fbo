"use server";

// Sign-in and sign-out as Server Actions.
//
// Nothing from the password, the cookie or the secret is ever logged or sent
// back to the browser; a failed sign-in returns only the typed username.

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { readAuthConfig, sessionCookieOptions } from "@/lib/auth/config";
import type { AuthConfig, SessionCookieOptions } from "@/lib/auth/config";
import { getLoginThrottle } from "@/lib/auth/login-throttle";
import { PASSWORD_MAX_LENGTH, verifyPassword } from "@/lib/auth/password-hash";
import { newSession, sealSession } from "@/lib/auth/session-token";

export type LoginState = { error?: string; username?: string };

const CONFIG_ERROR_MESSAGE = "Logowanie jest chwilowo niedostępne (błąd konfiguracji serwera).";
const INVALID_CREDENTIALS_MESSAGE = "Nieprawidłowa nazwa użytkownika lub hasło.";

function throttledMessage(seconds: number): string {
  return `Zbyt wiele nieudanych prób. Spróbuj ponownie za ${seconds} s.`;
}

function logConfigProblems(problems: string[]): void {
  console.error(
    `Sign-in is unavailable: missing or invalid configuration variables: ${problems.join(", ")}.`,
  );
}

// A missing field, or a file upload in place of a text field, counts as an
// empty value.
const TextFieldSchema = z.string().catch("");

const LoginFormSchema = z.object({
  username: TextFieldSchema,
  password: TextFieldSchema,
});

function readLoginForm(formData: FormData): z.infer<typeof LoginFormSchema> {
  return LoginFormSchema.parse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
}

// Compares fixed-length digests, so the time taken does not depend on where
// the typed username first differs from the configured one, or on its length.
function sameUsername(typed: string, configured: string): boolean {
  const typedDigest = createHash("sha256").update(typed).digest();
  const configuredDigest = createHash("sha256").update(configured).digest();
  return timingSafeEqual(typedDigest, configuredDigest);
}

async function credentialsMatch(
  username: string,
  password: string,
  config: AuthConfig,
): Promise<boolean> {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }
  const usernameMatches = sameUsername(username, config.username);
  // The hash is checked even for a wrong username, so both failures take
  // the same time.
  const passwordMatches = await verifyPassword(password, config.passwordHash);
  return usernameMatches && passwordMatches;
}

// An expired cookie needs the same Path and Secure attributes as the one it
// replaces; a `__Host-` cookie is not accepted without them.
function expiredCookie(options: SessionCookieOptions) {
  return {
    name: options.name,
    path: options.path,
    secure: options.secure,
    httpOnly: options.httpOnly,
    sameSite: options.sameSite,
  };
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { username, password } = readLoginForm(formData);

  const result = readAuthConfig();
  if (!result.ok) {
    logConfigProblems(result.problems);
    return { error: CONFIG_ERROR_MESSAGE, username };
  }
  const { config } = result;

  // The attempt is reserved before the password is checked, so parallel
  // requests cannot get past a failure that is not recorded yet.
  const attempt = getLoginThrottle().begin(Date.now());
  if (!attempt.allowed) {
    return { error: throttledMessage(attempt.retryAfterSeconds), username };
  }

  let succeeded = false;
  try {
    succeeded = await credentialsMatch(username, password, config);
  } finally {
    attempt.finish(succeeded, Date.now());
  }

  if (!succeeded) {
    return { error: INVALID_CREDENTIALS_MESSAGE, username };
  }

  const value = await sealSession(newSession(config, Date.now()), config.sessionSecret);
  (await cookies()).set({ ...sessionCookieOptions(config), value });

  // Outside any try/catch: redirect() throws to end the action.
  redirect("/");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const result = readAuthConfig();
  if (result.ok) {
    cookieStore.delete(expiredCookie(sessionCookieOptions(result.config)));
  } else {
    // Without a valid configuration the cookie name is unknown; expire both.
    cookieStore.delete(expiredCookie(sessionCookieOptions({ cookieSecure: true })));
    cookieStore.delete(expiredCookie(sessionCookieOptions({ cookieSecure: false })));
  }

  redirect("/login");
}
