module.exports = {
  testEnvironment: "node",
  // Integration tests hit a shared Postgres database and a lot of them do
  // `prisma.user.deleteMany()` / `prisma.invitation.deleteMany()` in
  // beforeEach/beforeAll. Running workers in parallel against one DB makes
  // those wipes step on each other's test data. Run serially — the suite is
  // small enough that the throughput hit is acceptable.
  maxWorkers: 1,
  // One worker across ~200 suites accumulates enough heap to hit Node's ~4 GB
  // default and die with "Ineffective mark-compacts near heap limit". Measured
  // 2026-08-30: the full run crashed at 4030 MB after ~420s — and it did so
  // WITH and WITHOUT the harness below, so this is the suite's own growth, not
  // something the guards introduced. `--forceExit` reports 0 for that crash, so
  // it had been invisible in the exit code.
  //
  // Recycling the worker is the fix rather than a bigger heap: raising the
  // ceiling only buys time as suites are added, and each suite is already
  // written to stand alone.
  workerIdleMemoryLimit: "1200MB",
  // Fail once, loudly, when Postgres is unreachable — see jest.globalSetup.ts.
  globalSetup: "<rootDir>/jest.globalSetup.ts",
  // Caps the Prisma pool before any client is built — see jest.setup.ts.
  setupFiles: ["<rootDir>/jest.setup.ts"],
  roots: ["<rootDir>/src"],
  // Narrowed to the `.test.ts`/`.spec.ts` suffix (2026-09-18, evidence panel
  // Task 4): the old `**/__tests__/**/*.ts` ran EVERY file under a
  // `__tests__` directory as its own suite, with no suffix required. Every
  // existing test already carries the suffix, so this was silently
  // redundant with the second pattern below — until `invariants.ts`, a test
  // HELPER with no `describe`/`it` blocks, needed to live in
  // `services/evidence/__tests__/` beside the tests that import it. Jest
  // picked it up as a suite of its own and failed the whole run with "Your
  // test suite must contain at least one test." The suffix is what actually
  // marks a file as a test; the directory never was.
  testMatch: ["**/?(*.)+(spec|test).ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    // Prisma 7 emits its client as TypeScript under src/. It is generated, it
    // is gitignored, and 73 files of it in the denominator would move the
    // coverage ratchet by a number that means nothing about this project.
    "!src/generated/**",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
    "!src/__tests__/**",
    "!src/__mocks__/**",
    "!src/index.ts",
    "!src/init.ts",
  ],
  // No fixed threshold: the floor is scripts/coverage-baseline.json, checked by
  // scripts/check-coverage.mjs, which only ever tightens (forgejo#62).
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  // otplib 13 pulls in @scure/base, which ships ONLY as ESM (no `require`
  // export). Node itself is fine with that — `require(esm)` has been
  // unflagged since 22.12, and both the tsx dev path and the compiled
  // CommonJS build load it — but Jest's own module loader is not, and dies
  // on its first `export`. So that one package goes through the `.js`
  // transform to CommonJS instead of being skipped like the rest of
  // node_modules. Keep the pattern to the ESM-only packages: transforming all
  // of node_modules would turn the suite into a much longer one.
  //
  // `isolatedModules` (2026-09-17): each file is transpiled on its own, without
  // building a TypeScript program over it and everything it imports. The type
  // information that program produced was thrown away anyway — diagnostics
  // are off, because `tsc --noEmit` is the type gate in CI and in the
  // pre-commit hook. Measured on 46 route and shared suites without a cache:
  // 108 s before, 75 s after, same 435 tests green. swc was faster still
  // (68 s) and was tried first; it emits exports as non-configurable getters,
  // so every `jest.spyOn(module, "export")` in the suite fails with "Cannot
  // redefine property", which ts-jest's output does not.
  transform: {
    "^.+\.tsx?$": ["ts-jest", { diagnostics: false, isolatedModules: true }],
    "^.+\.js$": [
      "ts-jest",
      {
        diagnostics: false,
        isolatedModules: true,
        tsconfig: { allowJs: true, module: "commonjs" },
      },
    ],
  },
  // @noble/hashes 2 sits nested under @otplib/plugin-crypto-noble and is
  // reached through an ESM-only subpath, so it is on the list too; @otplib
  // itself ships .cjs and passes through the `.js` transform untouched.
  transformIgnorePatterns: ["node_modules/(?!(@scure/base|@noble/hashes|@otplib)/)"],
  // Mock modules to avoid ESM issues
  moduleNameMapper: {
    "^uuid$": "<rootDir>/src/__mocks__/uuid.ts",
    "^webdav$": "<rootDir>/src/__mocks__/webdav.ts",
  },
};
