import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { password, username } from "./fixtures/test-account";

// The data comes from e2e/fixtures/catalog.ts, written by the global setup.
// Only correct sign-ins here: the sign-in throttle is shared by the server.

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Nazwa użytkownika").fill(username);
  await page.getByLabel("Hasło").fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL("/");
}

test("the accounts and categories pages need a session", async ({ page }) => {
  for (const path of ["/accounts", "/categories"]) {
    await page.goto(path);
    await expect(page).toHaveURL("/login");
  }
});

test("the accounts page lists the accounts by name with Polish type and scope names", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/accounts");

  await expect(page.getByRole("heading", { level: 1, name: "Konta" })).toBeVisible();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.first().getByRole("columnheader")).toHaveText([
    "Nazwa",
    "Typ",
    "Waluta",
    "Zakres",
  ]);

  const expected = [
    ["bank 1", "Konto bankowe", "PLN", "Prywatne"],
    ["Cyfrowe konto", "Zobowiązanie", "PLN", "Wyłączone"],
    ["Ćwiczebne konto", "Inwestycje", "EUR", "Firmowe"],
    ["Dom", "Gotówka", "PLN", "Prywatne"],
  ];
  await expect(rows).toHaveCount(expected.length + 1);
  for (const [index, cells] of expected.entries()) {
    await expect(rows.nth(index + 1).getByRole("cell")).toHaveText(cells);
  }
});

test("the categories page shows the tree in position order with kinds and the labeled mark", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/categories");

  await expect(page.getByRole("heading", { level: 1, name: "Kategorie" })).toBeVisible();
  const tree = page.getByRole("list", { name: "Drzewo kategorii" });
  await expect(tree.getByRole("heading", { level: 2 })).toHaveText([
    "Kategoria B",
    "Kategoria A",
    "Kategoria C",
  ]);

  const root = (name: string) =>
    tree.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2, name }) });

  const rootB = root("Kategoria B");
  await expect(rootB).toContainText("Wydatek");
  await expect(rootB).not.toContainText("Z etykietami");
  await expect(rootB.getByRole("listitem")).toHaveText([
    /^Podkategoria 2\s*Wydatek$/,
    /^Podkategoria 1\s*Wydatek$/,
  ]);

  const rootA = root("Kategoria A");
  await expect(rootA).toContainText("Mieszany");
  await expect(rootA).toContainText("Z etykietami");
  await expect(rootA.getByRole("listitem")).toHaveCount(0);

  const rootC = root("Kategoria C");
  await expect(rootC).toContainText("Przychód");
  await expect(rootC).not.toContainText("Z etykietami");
  await expect(rootC.getByRole("listitem")).toHaveText([/^Podkategoria 3\s*Przychód$/]);
});

test("the home page links to the accounts and the categories", async ({ page }) => {
  await signIn(page);

  await page.getByRole("link", { name: "Konta" }).click();
  await expect(page).toHaveURL("/accounts");
  await expect(page.getByRole("heading", { level: 1, name: "Konta" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Kategorie" }).click();
  await expect(page).toHaveURL("/categories");
  await expect(page.getByRole("heading", { level: 1, name: "Kategorie" })).toBeVisible();
});
