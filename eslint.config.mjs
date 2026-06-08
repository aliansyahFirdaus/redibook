import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".agents/**", "**/dist/**", "**/.output/**", "**/.vinxi/**", "**/node_modules/**", "**/coverage/**", "promptfoo/results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["eslint.config.mjs", "scripts/**/*.mjs", "promptfoo/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly"
      }
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
  },
  {
    files: ["apps/web/**/*.tsx"],
    rules: {
      "no-undef": "off"
    }
  }
);
