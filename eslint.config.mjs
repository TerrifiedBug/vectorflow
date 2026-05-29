import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next 16.2.x ships a newer eslint-plugin-react-hooks that
  // promotes several React-Compiler-era rules to errors. They flag
  // pre-existing patterns across the codebase (setState-in-effect,
  // ref-access-during-render, immutability, incompatible-library); downgrade
  // to warnings so they stay visible without blocking CI, pending a dedicated
  // cleanup pass (see follow-up issue).
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/incompatible-library": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated code (Prisma, etc.)
    "src/generated/**",
    // Internal design prototypes are not production source.
    "docs/internal/**",
  ]),
]);

export default eslintConfig;
