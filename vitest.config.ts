import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./src/") + "/",
    },
  },
  test: {
    globals: false,
    exclude: ["src/generated/**", "node_modules/**"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "docker/**/*.test.ts"],
    environment: "node",
    env: {
      // React 19 requires NODE_ENV=test (or development) to expose React.act,
      // which @testing-library/react depends on for rendering.
      NODE_ENV: "test",
      // Required by the centralized env validation module (src/lib/env.ts).
      // These are safe test-only values — no real database or secrets.
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      NEXTAUTH_SECRET: "test-secret-at-least-16-chars-long",
      NEXTAUTH_URL: "http://localhost:3000",
    },
  },
});
