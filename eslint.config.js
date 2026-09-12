import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
    },
  },
  {
    files: [
      "vite.config.ts",
      "vite.e2e.config.ts",
      "playwright.config.ts",
      "tests/audio/**/*.ts",
      "tests/e2e/**/*.spec.ts",
    ],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["tests/e2e/**/*-harness.ts"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
);
