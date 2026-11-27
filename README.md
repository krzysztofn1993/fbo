# FBO

FBO is a self-hosted household finance app. It runs as a single instance on
your own machine.

The project is at an early stage: this repository holds the application
scaffold, sign-in for the single administrator, a first domain rule, the
database schema for accounts and categories, their tests, and a CI check.

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
secret come from environment variables:

| Variable                | Required | Meaning                                                                     |
| ----------------------- | -------- | --------------------------------------------------------------------------- |
| `ADMIN_USERNAME`        | yes      | Username of the administrator                                               |
| `ADMIN_PASSWORD_HASH`   | yes      | Hash of the administrator password, printed by `npm run auth:hash-password` |
| `SESSION_SECRET`        | yes      | Key that encrypts the session cookie, at least 32 characters                |
| `SESSION_COOKIE_SECURE` | no       | `true` (default) or `false`; see [HTTPS](#https) below                      |
| `DATABASE_URL`          | yes      | PostgreSQL connection URL; see [Database](#database) below                  |

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

The database tests in `npm test` and `npm run verify` need the server running.
They use their own databases, `fbo_test` and `fbo_test_legacy` on the same
server, which they create when missing and empty on every run; set
`TEST_DATABASE_URL` and `TEST_LEGACY_DATABASE_URL` to use others. The test
setup refuses any database whose name does not end in `_test`, `_test_legacy`
or `_e2e`, so it cannot empty the development database by mistake.

## Scripts

| Command                      | What it does                                               |
| ---------------------------- | ---------------------------------------------------------- |
| `npm run dev`                | Start the development server                               |
| `npm run build`              | Create a production build                                  |
| `npm run start`              | Serve the production build                                 |
| `npm run lint`               | Check the code with ESLint                                 |
| `npm test`                   | Run the unit and database tests once                       |
| `npm run test:watch`         | Rerun the unit and database tests on every change          |
| `npm run test:e2e`           | Run the browser tests on the production build              |
| `npm run verify`             | Run lint, build, unit, database and browser tests in order |
| `npm run db:migrate`         | Apply pending migrations to `DATABASE_URL`                 |
| `npm run db:generate`        | Write a migration for changes in the schema                |
| `npm run auth:hash-password` | Print the `ADMIN_PASSWORD_HASH` line                       |

`npm run test:e2e` starts the production build on port 3100 with a test-only
account, so run `npm run build` first. The first run needs the browser:
`npx playwright install chromium`.

## Stack

Next.js (App Router), React, TypeScript and Tailwind CSS; PostgreSQL with
Drizzle ORM and node-postgres.
