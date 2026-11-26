# FBO

FBO is a self-hosted household finance app. It runs as a single instance on
your own machine.

The project is at an early stage: this repository holds the application
scaffold, sign-in for the single administrator, a first domain rule with its
tests, and a CI check.

## Requirements

- Node.js 26 (the version is pinned in `.nvmrc`)
- npm

## Getting started

```bash
npm install
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

## Scripts

| Command                      | What it does                                     |
| ---------------------------- | ------------------------------------------------ |
| `npm run dev`                | Start the development server                     |
| `npm run build`              | Create a production build                        |
| `npm run start`              | Serve the production build                       |
| `npm run lint`               | Check the code with ESLint                       |
| `npm test`                   | Run the unit tests once                          |
| `npm run test:watch`         | Rerun the unit tests on every change             |
| `npm run test:e2e`           | Run the browser tests on the production build    |
| `npm run verify`             | Run lint, build, unit and browser tests in order |
| `npm run auth:hash-password` | Print the `ADMIN_PASSWORD_HASH` line             |

`npm run test:e2e` starts the production build on port 3100 with a test-only
account, so run `npm run build` first. The first run needs the browser:
`npx playwright install chromium`.

## Stack

Next.js (App Router), React, TypeScript and Tailwind CSS.
