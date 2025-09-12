import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Bring in Next.js + TypeScript recommended configs
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Ignore build artifacts
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },

  // Project-specific rules
  {
    rules: {
      "@next/next/no-img-element": "off",              // allow <img>
      "no-console": ["warn", { allow: ["warn", "error"] }], // console.log discouraged
      eqeqeq: ["error", "always"],                     // enforce ===
      curly: ["error", "all"],                         // require curly braces
    },
  },
];

export default eslintConfig;
