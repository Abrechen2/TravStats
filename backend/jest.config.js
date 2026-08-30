module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      diagnostics: false, // Skip type-checking in tests; production code is checked via tsc --noEmit
    },
  },
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
  workerIdleMemoryLimit: '1200MB',
  // Fail once, loudly, when Postgres is unreachable — see jest.globalSetup.ts.
  globalSetup: '<rootDir>/jest.globalSetup.ts',
  // Caps the Prisma pool before any client is built — see jest.setup.ts.
  setupFiles: ['<rootDir>/jest.setup.ts'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/__tests__/**',
    '!src/__mocks__/**',
    '!src/index.ts',
    '!src/init.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  // Mock modules to avoid ESM issues
  moduleNameMapper: {
    '^uuid$': '<rootDir>/src/__mocks__/uuid.ts',
    '^webdav$': '<rootDir>/src/__mocks__/webdav.ts',
  },
};
