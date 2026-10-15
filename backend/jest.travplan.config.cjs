// Explicit isolated database; no global database creation or destructive setup.
const base = require("./jest.config.js");
module.exports = {
  ...base,
  rootDir: __dirname,
  globalSetup: undefined,
  globalTeardown: undefined,
  setupFiles: ["<rootDir>/scripts/travplan-test-setup.cjs"],
  testMatch: [
    "**/services/travplan/__tests__/*.test.ts",
    "**/openapi.coverage.test.ts",
    "**/openapi.responseSchema.test.ts",
    "**/openapi.timeShape.ratchet.test.ts",
    "**/apiResponseShape.ratchet.test.ts",
    "**/services/llm/__tests__/llmProvider*.test.ts",
    "**/services/llm/__tests__/llmGate*.test.ts",
  ],
  moduleNameMapper: { ...base.moduleNameMapper, "^(\\.{1,2}/.*)\\.js$": "$1" },
};
