import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true }, // built-in since Vite 8; replaces vite-tsconfig-paths
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
