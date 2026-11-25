# Repository Guidelines

FBO is a self-hosted household finance web app. Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, npm. The repository currently holds only the application scaffold.

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

Run `npm run lint` and `npm run build` before every commit; both must exit 0. There is no CI yet, so this local run is the gate.

## Coding Style

- TypeScript runs in `strict` mode; do not relax compiler options in `@tsconfig.json` to make a build pass.
- Use npm only; `package-lock.json` is the single lockfile.
- Keep `next` and `eslint-config-next` on the same exact version, and `react` and `react-dom` likewise, as pinned in `@package.json`.

## Testing

No test runner or `test` script exists yet. Until one is added, verify changes with lint and build, and report it that way instead of claiming tests passed.

## Commits

- Use Conventional Commits subjects (`feat:`, `chore:`), as in `git log`.
- Explain what changed and why in prose. Never list the changed files.
- End every message with the line `Developed with <model> (effort: <level>).`, a blank line, then the `Co-Authored-By:` trailer for that model.
