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
    },
  },
});
