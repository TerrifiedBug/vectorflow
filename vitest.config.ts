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
  },
});
