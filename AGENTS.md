# Repository Guidelines

FBO is a self-hosted household finance web app. Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, npm. The repository holds the application scaffold, sign-in for the single administrator (`src/lib/auth/`, `src/proxy.ts`, `src/app/login/`), the first domain rule (split totals in `src/lib/money/`), their tests, and the CI gate.

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

- `npm run dev` starts the development server on port 3000.
- `npm run lint` runs ESLint with the presets in `@eslint.config.mjs`.
- `npm run build` creates the production build and runs the type check.
- `npm test` runs the Vitest suite once; `npm run test:watch` reruns it on change.
- `npm run test:e2e` runs the Playwright suite against the production build; run `npm run build` first.
- `npm run auth:hash-password` reads a password (twice on a terminal, one line from a pipe) and prints the `ADMIN_PASSWORD_HASH=` line.
- `npm run verify` runs lint, then build, then unit tests, then E2E tests, and stops at the first failure.

Run `npm run verify` before every commit; it must exit 0. GitHub Actions runs the same command on every push and pull request.

## Coding Style

- TypeScript runs in `strict` mode; do not relax compiler options in `@tsconfig.json` to make a build pass.
- Use npm only; `package-lock.json` is the single lockfile.
- Keep `next` and `eslint-config-next` on the same exact version, and `react` and `react-dom` likewise, as pinned in `@package.json`.
- Pin new and updated dependencies and GitHub actions to an exact version: the highest semver in the chosen major line published at least 14×24 h earlier. Pin actions to the full commit SHA with the version in a trailing comment.
- The Node.js version in `@.nvmrc` is the exception: it is pinned to the major only.
- Represent money as `bigint` in the smallest currency unit, never as `number`; this is why `target` in `@tsconfig.json` is ES2020.

## Testing

- Vitest runs in a Node environment, configured in `@vitest.config.mts`.
- Unit tests live next to the code as `src/**/*.test.ts`; files elsewhere or with other names are not collected.
- Import code under test through the `@/` alias.
- Component tests need jsdom and Testing Library; add them in the change that first needs them.
- E2E tests live in `e2e/*.spec.ts` and run in Playwright with Chromium only, configured in `@playwright.config.ts`. They start `next start` on port 3100, so they need a prior `npm run build`, and pass the server a test-only account and a random session secret, overriding any local `.env.local`.
- `e2e/fixtures/` holds only test data; never put a real account or secret there.
- Report only tests that actually ran.

## Commits

- Use Conventional Commits subjects (`feat:`, `chore:`), as in `git log`.
- Explain what changed and why in prose. Never list the changed files.
- End every message with the line `Developed with <model> (effort: <level>).`, a blank line, then the `Co-Authored-By:` trailer for that model.
