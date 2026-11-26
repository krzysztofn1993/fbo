import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

import { password, username } from "./fixtures/test-account";

// The scenarios run in order: the sign-in throttle is shared by the whole
// server, so the number of failed attempts before each success matters.
// Never add a third wrong attempt in a row: the throttle starts after three.
test.describe.configure({ mode: "serial" });

const SESSION_COOKIE = "__Host-fbo_session";
const INVALID_CREDENTIALS = "Nieprawidłowa nazwa użytkownika lub hasło.";

async function submitLogin(page: Page, user: string, secret: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Nazwa użytkownika").fill(user);
  await page.getByLabel("Hasło").fill(secret);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
}

async function signIn(page: Page): Promise<void> {
  await submitLogin(page, username, password);
  await expect(page).toHaveURL("/");
  await expect(page.getByText(`Zalogowano jako ${username}`)).toBeVisible();
}

async function sessionCookie(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies.find((cookie) => cookie.name === SESSION_COOKIE);
}

test("the browser stores the __Host- Secure session cookie on http://localhost", async ({
  page,
  context,
}) => {
  await signIn(page);

  const cookie = await sessionCookie(context);
  expect(cookie, `${SESSION_COOKIE} was not stored`).toBeDefined();
  expect(cookie?.secure).toBe(true);
});

test("a request without a session gets a redirect and no protected content", async ({
  request,
  baseURL,
}) => {
  const response = await request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  const location = response.headers()["location"];
  expect(location).toBeDefined();
  expect(new URL(location ?? "", baseURL).pathname).toBe("/login");
  expect(await response.text()).not.toContain("Zalogowano jako");
});

test("visiting any path without a session ends on /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/login");

  await page.goto("/nieistniejaca-sciezka");
  await expect(page).toHaveURL("/login");
});

test("a wrong username and a wrong password give the same message", async ({ page }) => {
  // Scoped to the form: Next.js renders its own route announcer with role="alert".
  const alert = page.locator("form").getByRole("alert");

  await submitLogin(page, "wrong-user", password);
  await expect(alert).toHaveText(INVALID_CREDENTIALS);
  await expect(page).toHaveURL("/login");

  await submitLogin(page, username, "wrong-password-0123");
  await expect(alert).toHaveText(INVALID_CREDENTIALS);
  await expect(page).toHaveURL("/login");
});

test("signing in opens the home page with a strict session cookie", async ({ page, context }) => {
  await signIn(page);

  const cookie = await sessionCookie(context);
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict" });
});

test("a signed-in user visiting /login lands on the home page", async ({ page }) => {
  await signIn(page);

  await page.goto("/login");
  await expect(page).toHaveURL("/");
  await expect(page.getByText(`Zalogowano jako ${username}`)).toBeVisible();
});

test("signing out removes the session", async ({ page, context }) => {
  await signIn(page);

  await page.getByRole("button", { name: "Wyloguj" }).click();
  await expect(page).toHaveURL("/login");
  expect(await sessionCookie(context)).toBeUndefined();

  await page.goto("/");
  await expect(page).toHaveURL("/login");
});
