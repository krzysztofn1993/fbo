# FBO

FBO is a self-hosted household finance app. It runs as a single instance on
your own machine.

The project is at an early stage: this repository holds the application
scaffold, sign-in for the single administrator, a first domain rule, the
database schema for accounts, categories and transactions, a one-time command
that moves them from the old version, pages that list the accounts, the
category tree and the transactions with their details, their tests, and a CI
check.

## Requirements

- Node.js 26 (the version is pinned in `.nvmrc`)
- npm
- Docker with Compose, for the local PostgreSQL (see [Database](#database))

## Getting started

```bash
npm install
docker compose up -d
npm run db:migrate
npm run dev
```

The development server listens on http://localhost:3000. Every page except
the sign-in screen requires the configuration described below.

## Configuration

The instance has one administrator account. Its credentials and the session
secret come from environment variables, as does everything else the app and
its commands need; variables marked "migration" are read only by
`npm run legacy:migrate`:

| Variable                      | Required  | Meaning                                                                                |
| ----------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `ADMIN_USERNAME`              | yes       | Username of the administrator                                                          |
| `ADMIN_PASSWORD_HASH`         | yes       | Hash of the administrator password, printed by `npm run auth:hash-password`            |
| `SESSION_SECRET`              | yes       | Key that encrypts the session cookie, at least 32 characters                           |
| `SESSION_COOKIE_SECURE`       | no        | `true` (default) or `false`; see [HTTPS](#https) below                                 |
| `DATABASE_URL`                | yes       | PostgreSQL connection URL; see [Database](#database) below                             |
| `LEGACY_DATABASE_URL`         | migration | URL of the restored old database; see [Moving data](#moving-data-from-the-old-version) |
| `LEGACY_CATEGORY_LAYOUT_FILE` | migration | Path to the layout file (categories and accounts), kept outside the repository         |

Generate the password hash and the secret:

```bash
npm run -s auth:hash-password   # asks for the password twice, 15 to 256 characters
openssl rand -base64 32         # prints a value for SESSION_SECRET
```

The hash command prints a ready `ADMIN_PASSWORD_HASH=...` line. Keep the `-s`
flag when you redirect it into a file: without it npm adds its own lines to
the output. Put the values
in `.env.local` in the project root, which Git ignores, or pass them to the
process in your deployment. Without a complete and valid configuration every
page except the sign-in screen redirects to it, the form reports that sign-in
is unavailable, and the server log names the variables at fault (never their
values).

A session ends after one hour without activity or twelve hours after sign-in.
Changing the password, the username or `SESSION_SECRET` signs the
administrator out everywhere. Signing out ends the session only in that
browser: a copy of its cookie stays valid until one of those limits is
reached. After three failed sign-ins in a row each further
attempt has to wait, starting at one second and doubling up to a minute; a
successful sign-in or a server restart resets the wait. The wait is shared by
everyone who reaches the sign-in page, so anyone who can open it can keep the
administrator waiting by sending a wrong password about once a minute. Put the
instance behind an access gateway that admits only people you know (for
example an identity-aware proxy or a VPN), and make sure the app cannot be
reached around it.

### HTTPS

By default the session cookie is `Secure` and named `__Host-fbo_session`, so
browsers send it only over HTTPS; most also accept it on `http://localhost`
for development. To use the app over plain HTTP, for example from another
device on a home network, set `SESSION_COOKIE_SECURE=false`: the cookie loses
the `Secure` flag and the `__Host-` prefix, and the server logs a warning. Do
not do this on an instance reachable from the internet.

### Reverse proxy

Behind a reverse proxy, forward the original `Host` header or set
`X-Forwarded-Host`. Server Actions, including sign-in and sign-out, compare the
`Origin` of each request with that host and reject requests that do not match.

Do not let the reverse proxy or a CDN cache the app's pages. Some responses,
such as the sign-in page, are sent with a long `s-maxage` because Next.js
prerenders them, and a shared cache would keep serving an old copy after an
update. Cache only the files under `/_next/static/`.

## Database

FBO keeps its data in PostgreSQL 18. For development, `compose.yaml` runs one
in Docker on `127.0.0.1:5433`, a port chosen so that it does not collide with
a server on the default 5432. Its user, password and database are all `fbo`;
the password is for this local database only. Add the URL to `.env.local`:

```bash
DATABASE_URL=postgres://fbo:fbo@127.0.0.1:5433/fbo
```

Then start the server and create the schema:

```bash
docker compose up -d   # start PostgreSQL in the background
npm run db:migrate     # apply the migrations the database does not have yet
```

`npm run db:migrate` applies the SQL migrations from `drizzle/` in order and
skips those already applied, so running it again changes nothing. Run it after
every update that brings new migrations. The data lives in a named Docker
volume: `docker compose down` keeps it, `docker compose down -v` deletes it.
The Compose project is always called `fbo-dev`, whatever the directory is
named; `COMPOSE_PROJECT_NAME` or `docker compose -p <name>` still override it,
for example to give parallel worktrees separate stacks; only one of them can
listen on port 5433 at a time.

The database tests in `npm test`, the browser tests in `npm run test:e2e` and
`npm run verify` need the server running. They use their own databases,
`fbo_test` and `fbo_test_legacy` for the database tests and `fbo_e2e` for the
browser tests, on the same server, which they create when missing and empty on
every run; set `TEST_DATABASE_URL`, `TEST_LEGACY_DATABASE_URL` and
`E2E_DATABASE_URL` to use others. The test
setup refuses any database whose name does not end in `_test`, `_test_legacy`
or `_e2e`, so it cannot empty the development database by mistake.

## Moving data from the old version

`npm run legacy:migrate` moves the accounts, categories and transactions of the
old version into the new database, once. It copies the active accounts with their type,
currency and reporting scope and skips the inactive ones. It copies every
category with its kind, merges categories of one parent, and root categories
among themselves, whose names differ only in case or spacing (the old IDs of
all merged rows map to the one new category), and takes the order of the categories, the categories that take
labels instead of subcategories, and any account renames and merges from a
layout file. Transactions are described [below](#transactions).

1. Restore the dump of the old database into a database of its own, for
   example `fbo_legacy` on the local server. The command only reads it.
2. Write the category layout file and keep it outside the repository. It lists
   the root categories in display order, and under each its subcategories in
   display order; `"type": "labeled"` marks a root category that takes labels,
   and such a category cannot have `children`. Names are matched with the old
   categories regardless of case and spacing, and the spelling in the file
   becomes the name of the new category. To rename a root category, give its
   old name in `"legacyName"`: the entry then matches the old category of that
   name, the new category gets `"name"`, and the summary lists the rename. Two
   entries cannot match the same old category, and the new names must stay
   unique. Subcategories are always matched by their own name.

   The same file can rename and merge accounts in an optional `"accounts"`
   list. Each entry makes one new account named `"name"` from the old active
   accounts named in `"legacyNames"`, matched regardless of case and spacing:
   one old name renames an account, several merge accounts into one, and every
   old account ID maps to it, so their later data lands on the one account.
   Merged accounts must share type, currency and reporting scope, and the new
   account keeps the creation time of the oldest. Accounts the list does not
   name move over unchanged. An old name that matches no active account, an
   old account in two entries and a new name that collides with another
   account's name, regardless of case and spacing, are errors. The summary
   lists the renamed and merged accounts. A made-up example:

   ```json
   {
     "roots": [
       { "name": "Category A", "children": ["Subcategory 2", "Subcategory 1"] },
       { "name": "Category B", "type": "labeled" },
       { "name": "Earnings", "legacyName": "Income", "children": ["Salary", "Bonus"] }
     ],
     "accounts": [
       { "name": "Shared account", "legacyNames": ["bank 1", "bank 2"] },
       { "name": "Cash", "legacyNames": ["cash 1"] }
     ]
   }
   ```

3. Set `DATABASE_URL` to a new database with the schema applied
   (`npm run db:migrate`) and no data yet,
   `LEGACY_DATABASE_URL` to the restored old database and
   `LEGACY_CATEGORY_LAYOUT_FILE` to the layout file, for example in
   `.env.local`.
4. Run `npm run legacy:migrate` once and read the summary it prints.

Every root category of the old database needs an entry in the layout file.
Subcategories without an entry go after the listed ones of their root
category, oldest first, and the summary names them; entries without a
matching category only produce a warning. The command refuses to run when
both URLs point at the same database, and it checks every rule before it
writes: when the old data break one (an inactive account that other rows
still refer to, a third category level, an unknown value), it lists every
problem and writes nothing. The transactions are checked once the accounts and
categories pass, so fixing those can bring up a second round of problems. The
write is one transaction into tables that must all be empty, accounts,
categories, transactions and the tables that hang off them alike, so a second
run refuses and changes nothing. To try again, start from a fresh new database:
recreate it, run `npm run db:migrate`, then `npm run legacy:migrate`; a
database that already holds accounts and categories from an earlier version of
the command has to be recreated too.

### Transactions

Every transaction moves to the new account its old account maps to, so the
transactions of merged accounts land on the one account, with its booking and
operation dates, amount in minor units, description and reporting scope
override. Its currency is the currency of the account. Each old split becomes a
part with its category (merged categories included), amount, reporting class
and approval, and the classification state is derived from the parts as in the
old version: no parts is unclassified, a part that is not approved needs
review, and otherwise the transaction is approved.

- A label stays only on a part in a category that takes labels; a label
  anywhere else is dropped, and the part keeps its category and amount.
- The source trace (source kind, merchant, import run, file name, hash, type
  and size, sheet, cell, record index, raw value and record hashes, bank
  connection, bank sync run and the provider metadata) and every old
  classification result, with its category, rules, confidence, reason, status
  and timestamps, are kept in tables of their own for later features; the path
  of the old source file, import counters and the state of the bank
  connections are not moved.
- The transactions are inserted in their order in the source: by booking date,
  the spreadsheet rows before the bank rows (manual ones last), the spreadsheet
  rows by file name, then by file (so two files of the same name stay apart),
  sheet and the importer's record order, the bank rows by
  operation date, and the old ID last, so the new IDs keep that order.
- Pairs of possible duplicates are marked, not removed: the old version kept
  both the spreadsheet and the bank rows for the months they overlap, so one
  money movement can appear twice. A bank row (from the bank connection or a
  bank file) and a spreadsheet row are candidates when they are on the same new
  account (merged accounts included), have the same amount, and the booking
  date of the spreadsheet row is at most three calendar days from the booking
  or the operation date of the bank row; the smaller of the two gaps is the
  pair's day difference. Every row is in at most one pair: the candidates are
  taken in order of the day difference, then of how many candidates their two
  rows have together (so a row with a single candidate is not lost to one with
  several), then of the booking date and the source position of the bank row,
  and of the source position of the spreadsheet row, skipping any whose row is
  already paired. Both transactions of a pair still count in every total until
  someone resolves the pair.

The run stops and writes nothing when a transaction has no account or is on an
account that is not migrated, its currency differs from the account currency,
a value is unknown (source kind, reporting class, classifier type, result
status, reporting scope), a part or result is in a category that is not
migrated, the parts do not sum exactly to the amount, a part goes the other
way than the amount (a part of an outflow is positive or a part of an inflow is
negative), a part in a category that takes labels has no label, a transaction has a note or is marked as a
refund (the new version does not keep either yet), or a transaction without
parts has a conflicting classification result (the old version showed it as
needing review, the new rule would show it as unclassified).

Besides the accounts and categories, the summary counts the transactions by
source, the parts, the transactions in each classification state, the labels
kept and dropped, the old classification results by status, and the pairs of
possible duplicates: all of them, split into three disjoint groups (0 days
apart with no competing candidate, 1 to 3 days apart with no competing
candidate, and those where either row had another candidate), and by month of
the bank row's booking date. It prints counts only, no descriptions or amounts.

## Scripts

| Command                      | What it does                                                          |
| ---------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                | Start the development server                                          |
| `npm run build`              | Create a production build                                             |
| `npm run start`              | Serve the production build                                            |
| `npm run lint`               | Check the code with ESLint                                            |
| `npm test`                   | Run the unit and database tests once                                  |
| `npm run test:watch`         | Rerun the unit and database tests on every change                     |
| `npm run test:e2e`           | Run the browser tests on the production build                         |
| `npm run verify`             | Run lint, build, unit, database and browser tests in order            |
| `npm run db:migrate`         | Apply pending migrations to `DATABASE_URL`                            |
| `npm run db:generate`        | Write a migration for changes in the schema                           |
| `npm run legacy:migrate`     | Move accounts, categories and transactions from the old version, once |
| `npm run auth:hash-password` | Print the `ADMIN_PASSWORD_HASH` line                                  |

`npm run test:e2e` starts the production build on port 3100 with a test-only
account and the `fbo_e2e` database filled with made-up accounts, categories
and transactions, so run `npm run build` first and keep PostgreSQL running.
The first run needs the browser: `npx playwright install chromium`.

## Stack

Next.js (App Router), React, TypeScript and Tailwind CSS; PostgreSQL with
Drizzle ORM and node-postgres.
