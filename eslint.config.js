import globals from "globals";

const sharedRules = {
  "no-console": "off",
  "no-debugger": "error",
  "no-redeclare": "error",
  "no-undef": "error",
  "no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
    },
  ],
};

export default [
  { ignores: ["node_modules/**", "output/**", "coverage/**", ".cache/**"] },
  {
    files: ["src/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        fetch: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: sharedRules,
  },
  {
    files: ["src/studio/app.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
    rules: sharedRules,
  },
];
