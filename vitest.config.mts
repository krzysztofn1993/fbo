import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true }, // built-in since Vite 8; replaces vite-tsconfig-paths
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "src/**/*.db.test.ts"],
        },
      },
      {
        // Needs the local PostgreSQL (`docker compose up -d`). The files share
        // one database and empty it between tests, so they run one at a time.
        extends: true,
        test: {
          name: "db",
          include: ["src/**/*.db.test.ts"],
          fileParallelism: false,
          globalSetup: ["src/lib/db/db-global-setup.ts"],
        },
      },
    ],
  },
});
