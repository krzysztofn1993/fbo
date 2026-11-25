# FBO

FBO is a self-hosted household finance app. It runs as a single instance on
your own machine.

The project is at an early stage: this repository currently holds the
application scaffold.

## Requirements

- Node.js 26 (the version is pinned in `.nvmrc`)
- npm

## Getting started

```bash
npm install
npm run dev
```

The development server listens on http://localhost:3000.

## Scripts

| Command              | What it does                        |
| -------------------- | ----------------------------------- |
| `npm run dev`        | Start the development server        |
| `npm run build`      | Create a production build           |
| `npm run start`      | Serve the production build          |
| `npm run lint`       | Check the code with ESLint          |
| `npm test`           | Run the test suite once             |
| `npm run test:watch` | Rerun the tests on every change     |
| `npm run verify`     | Run lint, build and tests in order  |

## Stack

Next.js (App Router), React, TypeScript and Tailwind CSS.
