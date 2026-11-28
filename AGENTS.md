# Repository Guidelines

FBO is a self-hosted household finance web app. Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, npm. The repository holds the application scaffold, sign-in for the single administrator (`src/lib/auth/`, `src/proxy.ts`, `src/app/login/`), the first domain rules (split totals and the exact amount formatter in `src/lib/money/`), the data layer (PostgreSQL 18 through Drizzle ORM and `pg`: schema and helpers in `src/lib/db/`, generated migrations in `drizzle/`), the transaction model with its classification-state rule and the list and detail queries (`src/lib/transactions/`), the one-time migration from the old version (`src/lib/legacy/`), the accounts, categories and transactions pages (`src/app/accounts/`, `src/app/categories/`, `src/app/transactions/`, catalog queries in `src/lib/catalog/`, Polish names in `src/i18n/pl.ts`), their tests, and the CI gate.

## Hard Rules

- Everything ignored in `@.gitignore` stays out of history: never use `git add -f`, and never copy the contents of ignored files into tracked ones.
- The repository is public. Keep personal data out of code, fixtures, docs, and commit messages: no real names, account numbers, bank or merchant names, real amounts, host paths, or usernames. Use placeholders such as "person A" and "bank 1".
- Write code, comments, identifiers, and commit messages in English.
- Keep `eslint` on 9 and `typescript` on 5.9 until the lint plugins behind `eslint-config-next` declare support for newer majors. Do not install with `--force` or `--legacy-peer-deps`.
- Do not hand-edit the Next.js section below or its marker comments; `next dev` rewrites it.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project Structure

- Import from `src/` through the `@/*` alias defined in `@tsconfig.json`.
- `@next.config.ts` enables Cache Components and the Tailwind loader for Turbopack.

## Commands

- `docker compose up -d` starts the local PostgreSQL 18 from `@compose.yaml` on `127.0.0.1:5433`; database tests and `verify` need it running.
- `npm run dev` starts the development server on port 3000.
- `npm run lint` runs ESLint with the presets in `@eslint.config.mjs`.
- `npm run build` creates the production build and runs the type check.
- `npm test` runs the Vitest suite once; `npm run test:watch` reruns it on change.
- `npm run test:e2e` runs the Playwright suite against the production build; run `npm run build` first.
- `npm run db:generate` writes a new SQL migration to `drizzle/` from changes in `src/lib/db/schema.ts`; commit it together with the schema and never edit an applied migration. What Drizzle cannot express (such as an expression index with `NULLS NOT DISTINCT`) goes into a custom migration from `npx drizzle-kit generate --custom --name <name>`.
- `npm run db:migrate` applies the pending migrations to `DATABASE_URL` (from the environment or `.env.local`); running it again changes nothing.
- `npm run legacy:migrate` moves the accounts, categories and transactions of the old version from `LEGACY_DATABASE_URL` into the empty tables of `DATABASE_URL`, once and in one transaction, with the category order, root category renames, and account renames and merges from the file in `LEGACY_CATEGORY_LAYOUT_FILE` (format in `@README.md`). Transactions keep their parts (labels only in `labeled` categories, others dropped), source trace and old classification results, and are inserted in source order; any rule broken by the old data (rules in `@README.md`) stops the run before it writes, and a second run refuses. The summary prints counts only. The translation rules live in `src/lib/legacy/`; its tests use a made-up old database and made-up counts, never real data or numbers from a dump.
- `npm run auth:hash-password` reads a password (twice on a terminal, one line from a pipe) and prints the `ADMIN_PASSWORD_HASH=` line.
- `npm run verify` runs lint, then build, then unit and database tests, then E2E tests, and stops at the first failure.

Run `npm run verify` before every commit; it must exit 0. GitHub Actions runs the same command on every push and pull request.

## Coding Style

- TypeScript runs in `strict` mode; do not relax compiler options in `@tsconfig.json` to make a build pass.
- Use npm only; `package-lock.json` is the single lockfile.
- Keep `next` and `eslint-config-next` on the same exact version, and `react` and `react-dom` likewise, as pinned in `@package.json`.
- Pin new and updated dependencies and GitHub actions to an exact version: the highest semver in the chosen major line published at least 14×24 h earlier. Pin actions to the full commit SHA with the version in a trailing comment.
- The Node.js version in `@.nvmrc` is the exception: it is pinned to the major only.
- Pin container images by tag and digest (`name:tag@sha256:…`) under the same 14-day rule, and keep `@compose.yaml` and `@.github/workflows/ci.yml` on the same image.
- The schema and every module that a plain `node` script or a test setup loads import only packages and relative paths with the `.ts` extension, never `@/` or `server-only`, and use erasable TypeScript syntax only.
- Enum values in the code and the database are English identifiers; names shown to the user live only in the translation file, `src/i18n/pl.ts`.
- Pages get the database from `getDb()` in `src/lib/db/client.ts` only after `verifySession()`, inside `<Suspense>`, so `next build` never connects; queries take the handle as a parameter.
- New IDs are UUIDv7 given by the database (`uuidv7()` as the column default); do not generate IDs in the application.
- Validate every external input (environment variables, files, rows from another system's database, request and form data, API responses) with a Zod schema where it enters, and work with the parsed type inside; name the failing variable or field in problems, never the value of a secret.
- Model identifiers as branded types from `src/lib/ids.ts`, one brand per entity and separate brands for legacy IDs, so they cannot be mixed up. An ID gets its brand where it enters: from the schema that parses it, or from `$type<…>()` on its column in `src/lib/db/schema.ts` when the database returns it.
- Represent money as `bigint` in the smallest currency unit, never as `number`; this is why `target` in `@tsconfig.json` is ES2020.

## Testing

- Vitest runs in a Node environment, configured in `@vitest.config.mts`.
- Tests live next to the code as `src/**/*.test.ts`; files elsewhere or with other names are not collected. Vitest has two projects: `unit` takes every such file except `*.db.test.ts`, and `db` takes `src/**/*.db.test.ts`.
- Database tests (`*.db.test.ts`) need the local database, so `npm test` and `npm run verify` fail without it. The `db` global setup creates `fbo_test` and `fbo_test_legacy` when missing (override with `TEST_DATABASE_URL` and `TEST_LEGACY_DATABASE_URL`), drops and recreates their schema, and applies the migrations to `fbo_test`. The helper in `src/lib/db/test-database.ts` refuses any database whose name does not end in `_test`, `_test_legacy` or `_e2e`. Database test files run one at a time; empty the tables with `truncateTables()` before each test.
- Import code under test through the `@/` alias.
- Component tests need jsdom and Testing Library; add them in the change that first needs them.
- E2E tests live in `e2e/*.spec.ts` and run in Playwright with Chromium only, configured in `@playwright.config.ts`. They start `next start` on port 3100, so they need a prior `npm run build`, and pass the server a test-only account, a random session secret and a `DATABASE_URL` for the `fbo_e2e` database (override with `E2E_DATABASE_URL`). These five variables take precedence over a local `.env.local`, but any other variable set there still reaches the server, and outside CI a server already listening on port 3100 is reused. The global setup in `e2e/global-setup.ts` recreates `fbo_e2e` with the same name guard, applies the migrations and writes the made-up data from `e2e/fixtures/catalog.ts` and `e2e/fixtures/transactions.ts`, so E2E tests need the local database running.
- `e2e/fixtures/` holds only test data; never put a real account or secret there.
- Report only tests that actually ran.

## Commits

- Use Conventional Commits subjects (`feat:`, `chore:`), as in `git log`.
- Explain what changed and why in prose. Never list the changed files.
- End every message with the line `Developed with <model> (effort: <level>).`, a blank line, then the `Co-Authored-By:` trailer for that model.
