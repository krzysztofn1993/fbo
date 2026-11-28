import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { password, username } from "./fixtures/test-account";
import { fixtureTransactions } from "./fixtures/transactions";

// The data comes from e2e/fixtures/catalog.ts and e2e/fixtures/transactions.ts,
// written by the global setup. Only correct sign-ins here: the sign-in
// throttle is shared by the server.

const PAGE_SIZE = 50;

// Polish amounts group digits and separate the currency with a no-break space.
const NBSP = " ";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Nazwa użytkownika").fill(username);
  await page.getByLabel("Hasło").fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL("/");
}

// Newest booking date first; within a date, the one inserted later (later in
// the source, with the greater UUIDv7) first.
const expectedOrder = fixtureTransactions
  .map((transaction, index) => ({ transaction, index }))
  .sort(
    (a, b) =>
      b.transaction.bookingDate.localeCompare(a.transaction.bookingDate) || b.index - a.index,
  )
  .map(({ transaction }) => transaction);

function descriptions(list: typeof fixtureTransactions): string[] {
  return list.map((transaction) => transaction.description ?? "Bez opisu");
}

function bodyRows(page: Page): Locator {
  return page.getByRole("table").locator("tbody tr");
}

function rowOf(page: Page, description: string): Locator {
  return bodyRows(page).filter({
    has: page.getByRole("link", { name: description, exact: true }),
  });
}

/**
 * The value of a field in the details list, found by its exact name. Only the
 * visible list: Next keeps a page left by client navigation hidden in the DOM.
 */
function field(page: Page, name: string): Locator {
  return page
    .locator("dl > div")
    .filter({ visible: true })
    .filter({ has: page.locator("dt").getByText(name, { exact: true }) })
    .locator("dd");
}

test("the transaction list and details need a session", async ({ page }) => {
  for (const path of ["/transactions", "/transactions/01900000-0000-7000-8000-000000000000"]) {
    await page.goto(path);
    await expect(page).toHaveURL("/login");
  }
});

test("the first page lists 50 transactions, newest first, with Polish states and amounts", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/transactions");

  await expect(page.getByRole("heading", { level: 1, name: "Transakcje" })).toBeVisible();
  await expect(page.getByRole("table").getByRole("columnheader")).toHaveText([
    "Data",
    "Opis",
    "Konto",
    "Kategoria",
    "Kwota",
    "Stan",
  ]);
  await expect(page.getByText(`Liczba transakcji: ${fixtureTransactions.length}`)).toBeVisible();
  await expect(page.getByText("Strona 1 z 2")).toBeVisible();

  const firstPage = expectedOrder.slice(0, PAGE_SIZE);
  await expect(bodyRows(page)).toHaveCount(PAGE_SIZE);
  await expect(bodyRows(page).getByRole("link")).toHaveText(descriptions(firstPage));
  await expect(bodyRows(page).locator("td:first-child")).toHaveText(
    firstPage.map((transaction) => transaction.bookingDate),
  );

  await expect(rowOf(page, "Wypłata z etykietą").getByRole("cell")).toHaveText([
    "2026-03-10",
    "Wypłata z etykietą",
    "bank 1",
    "Kategoria A",
    `-1${NBSP}234,56${NBSP}zł`,
    "Zatwierdzona",
  ]);
  await expect(rowOf(page, "Do sprawdzenia").getByRole("cell")).toHaveText([
    "2026-03-06",
    "Do sprawdzenia",
    "Dom",
    "Kategoria C / Podkategoria 3",
    `2${NBSP}500,00${NBSP}zł`,
    "Do przeglądu",
  ]);
  await expect(rowOf(page, "Bez opisu").getByRole("cell")).toHaveText([
    "2026-03-12",
    "Bez opisu",
    "Cyfrowe konto",
    "—",
    `-9,99${NBSP}zł`,
    "Niesklasyfikowana",
  ]);
  await expect(rowOf(page, "Wydatek w euro").getByRole("cell")).toHaveText([
    "2026-03-05",
    "Wydatek w euro",
    "Ćwiczebne konto",
    "Kategoria B / Podkategoria 2",
    `-42,00${NBSP}€`,
    "Zatwierdzona",
  ]);
  await expect(rowOf(page, "Zakupy podzielone").getByRole("cell").nth(3)).toHaveText(
    "Podzielona (2)",
  );

  // Two transactions booked on one day keep the order of the source.
  const sameDay = bodyRows(page).filter({ hasText: "Ten sam dzień" }).getByRole("link");
  await expect(sameDay).toHaveText([
    "Ten sam dzień, później w źródle",
    "Ten sam dzień, wcześniej w źródle",
  ]);
});

test("the next page shows the remaining transactions and the previous one goes back", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/transactions");

  await page.getByRole("link", { name: "Następna" }).click();
  await expect(page).toHaveURL("/transactions?page=2");
  await expect(page.getByText("Strona 2 z 2")).toBeVisible();
  const secondPage = expectedOrder.slice(PAGE_SIZE);
  expect(secondPage).toHaveLength(5);
  await expect(bodyRows(page)).toHaveCount(secondPage.length);
  await expect(bodyRows(page).getByRole("link")).toHaveText(descriptions(secondPage));
  await expect(page.getByRole("link", { name: "Następna" })).toHaveCount(0);

  await page.getByRole("link", { name: "Poprzednia" }).click();
  await expect(page).toHaveURL("/transactions?page=1");
  await expect(page.getByText("Strona 1 z 2")).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(PAGE_SIZE);
});

test("a page parameter that is not a page number shows the first page", async ({ page }) => {
  await signIn(page);
  await page.goto("/transactions?page=abc");

  await expect(page.getByText("Strona 1 z 2")).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(PAGE_SIZE);
  await expect(bodyRows(page).first().getByRole("link")).toHaveText(
    descriptions(expectedOrder.slice(0, 1)),
  );
});

test("the details show the fields and the parts of a transaction", async ({ page }) => {
  await signIn(page);
  await page.goto("/transactions");

  await page.getByRole("link", { name: "Faktura firmowa", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Transakcja" })).toBeVisible();
  await expect(field(page, "Kwota")).toHaveText(`-500,00${NBSP}zł`);
  await expect(field(page, "Data księgowania")).toHaveText("2026-03-08");
  await expect(field(page, "Data operacji")).toHaveText("2026-03-07");
  await expect(field(page, "Konto")).toHaveText("bank 1 (Prywatne)");
  await expect(field(page, "Zakres transakcji")).toHaveCount(0);
  await expect(field(page, "Źródło")).toHaveText("Połączenie z bankiem");
  await expect(field(page, "Opis")).toHaveText("Faktura firmowa");
  await expect(field(page, "Stan")).toHaveText("Zatwierdzona");

  const parts = page.getByRole("table");
  await expect(parts.getByRole("columnheader")).toHaveText([
    "Kategoria",
    "Kwota",
    "Etykieta",
    "Klasa",
    "Zatwierdzona",
  ]);
  await expect(parts.locator("tbody tr")).toHaveCount(1);
  await expect(parts.locator("tbody tr").getByRole("cell")).toHaveText([
    "Kategoria B / Podkategoria 1",
    `-500,00${NBSP}zł`,
    "—",
    "Koszt firmowy",
    "tak",
  ]);
  await expect(page.getByRole("heading", { name: "Możliwy duplikat" })).toHaveCount(0);

  await page.getByRole("link", { name: "← Transakcje" }).click();
  await expect(page).toHaveURL("/transactions");

  await page.getByRole("link", { name: "Wypłata z etykietą", exact: true }).click();
  await expect(field(page, "Źródło")).toHaveText("Arkusz");
  await expect(page.getByRole("table").locator("tbody tr").getByRole("cell")).toHaveText([
    "Kategoria A",
    `-1${NBSP}234,56${NBSP}zł`,
    "etykieta 1",
    "Zwykła",
    "tak",
  ]);

  await page.goto("/transactions");
  await page.getByRole("link", { name: "Wydatek w euro", exact: true }).click();
  await expect(field(page, "Kwota")).toHaveText(`-42,00${NBSP}€`);
  await expect(field(page, "Data operacji")).toHaveText("—");
  await expect(field(page, "Konto")).toHaveText("Ćwiczebne konto (Firmowe)");
  await expect(field(page, "Zakres transakcji")).toHaveText("Prywatne");
  await expect(field(page, "Źródło")).toHaveText("—");

  await page.goto("/transactions");
  await page.getByRole("link", { name: "Do sprawdzenia", exact: true }).click();
  await expect(field(page, "Stan")).toHaveText("Do przeglądu");
  await expect(page.getByRole("table").locator("tbody tr").getByRole("cell").last()).toHaveText(
    "nie",
  );

  await page.goto("/transactions");
  await page.getByRole("link", { name: "Bez opisu", exact: true }).click();
  await expect(field(page, "Opis")).toHaveText("Bez opisu");
  await expect(field(page, "Stan")).toHaveText("Niesklasyfikowana");
  await expect(page.getByText("Transakcja nie ma części.")).toBeVisible();
});

test("a possible duplicate is marked on the list and links to the other transaction", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/transactions");

  for (const description of ["Duplikat z banku", "Duplikat z arkusza"]) {
    await expect(rowOf(page, description).getByText("możliwy duplikat")).toBeVisible();
  }
  await expect(page.getByRole("table").getByText("możliwy duplikat")).toHaveCount(2);

  await page.getByRole("link", { name: "Duplikat z banku", exact: true }).click();
  const fromBank = page.getByRole("region", { name: "Możliwy duplikat" });
  await expect(fromBank.getByRole("listitem")).toHaveCount(1);
  await expect(fromBank.getByRole("listitem")).toContainText("2026-03-02");
  await expect(fromBank.getByRole("listitem")).toContainText(`-77,00${NBSP}zł`);
  await expect(fromBank.getByRole("listitem")).toContainText("Arkusz");
  const bankUrl = page.url();

  await fromBank.getByRole("link", { name: "Duplikat z arkusza" }).click();
  await expect(field(page, "Opis")).toHaveText("Duplikat z arkusza");
  expect(page.url()).not.toBe(bankUrl);
  const fromSheet = page.getByRole("region", { name: "Możliwy duplikat" });
  await expect(fromSheet.getByRole("listitem")).toContainText("Połączenie z bankiem");
  await fromSheet.getByRole("link", { name: "Duplikat z banku" }).click();
  await expect(page).toHaveURL(bankUrl);
});

test("an unknown or malformed transaction ID shows the Polish not-found screen", async ({
  page,
}) => {
  await signIn(page);

  for (const id of ["01900000-0000-7000-8000-000000000000", "abc"]) {
    await page.goto(`/transactions/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Nie znaleziono" })).toBeVisible();
    await page.getByRole("link", { name: "← Strona główna" }).click();
    await expect(page).toHaveURL("/");
  }
});

test("the home page links to the transactions", async ({ page }) => {
  await signIn(page);

  await page.getByRole("link", { name: "Transakcje" }).click();
  await expect(page).toHaveURL("/transactions");
  await expect(page.getByRole("heading", { level: 1, name: "Transakcje" })).toBeVisible();
});
