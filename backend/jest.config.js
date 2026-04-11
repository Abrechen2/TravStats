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
