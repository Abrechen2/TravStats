import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockParseTrainingLogFindMany = jest.fn();
const mockParseTrainingLogCount = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    parseTrainingLog: {
      findMany: mockParseTrainingLogFindMany,
      count: mockParseTrainingLogCount,
    },
  },
}));
jest.mock("../middleware/auth", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireWriteScope: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock("../middleware/rateLimit", () => ({
  adminExportLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminReseedLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  generalLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock("../services/loggingConfig", () => ({
  getLoggingConfig: jest.fn(),
  updateLoggingConfig: jest.fn(),
  toggleDebugLogging: jest.fn(),
  invalidateCacheAndReinit: jest.fn(),
}));
jest.mock("../services/logManager", () => ({
  listLogFiles: jest.fn(),
  readLogFile: jest.fn(),
  deleteLogFile: jest.fn(),
  cleanupOldLogs: jest.fn(),
  getLogStats: jest.fn(),
  searchLogs: jest.fn(),
  getLogFilePathForDownload: jest.fn(),
}));
jest.mock("../services/apiKeyTester", () => ({
  testOpenAIKey: jest.fn(),
  testClaudeKey: jest.fn(),
  testAirlabsKey: jest.fn(),
  testAviationstackKey: jest.fn(),
  testOpenSkyCredentials: jest.fn(),
}));
jest.mock("../utils/encryption", () => ({
  encryptApiKey: jest.fn(),
  decryptApiKey: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.mock("../services/backupService", () => ({}));
jest.mock("../services/backupScheduler", () => ({
  startScheduler: jest.fn(),
  stopScheduler: jest.fn(),
  updateSchedule: jest.fn(),
  getScheduleStatus: jest.fn(),
}));
jest.mock("./admin/smtp", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require("express") as typeof import("express");
  const smtpRouter = express.Router();
  return { __esModule: true, default: smtpRouter };
});

import request from "supertest";
import express from "express";

describe("GET /api/v1/admin/parse-logs/stats", () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: adminRoutes } = await import("./admin");
    app = express();
    app.use(express.json());
    app.use("/api/v1/admin", adminRoutes);
  });

  it("returns aggregate stats grouped by airline", async () => {
    mockParseTrainingLogCount.mockResolvedValue(3);
    mockParseTrainingLogFindMany.mockResolvedValue([
      { airline: "Lufthansa", templateHit: true, missingFields: [] },
      { airline: "Lufthansa", templateHit: false, missingFields: ["seatClass", "price"] },
      { airline: "Ryanair", templateHit: true, missingFields: ["price"] },
    ]);

    const res = await request(app).get("/api/v1/admin/parse-logs/stats");
    expect(res.status).toBe(200);
    expect(res.body.totalLogs).toBe(3);
    expect(res.body.byAirline).toHaveLength(2);

    const lh = res.body.byAirline.find((a: { airline: string }) => a.airline === "Lufthansa");
    expect(lh.total).toBe(2);
    expect(lh.hits).toBe(1);
    expect(lh.hitRate).toBe(50);
    expect(lh.commonMissingFields).toContain("seatClass");
  });

  it("returns overallHitRate of 0 when no logs exist", async () => {
    mockParseTrainingLogCount.mockResolvedValue(0);
    mockParseTrainingLogFindMany.mockResolvedValue([]);

    const res = await request(app).get("/api/v1/admin/parse-logs/stats");
    expect(res.status).toBe(200);
    expect(res.body.totalLogs).toBe(0);
    expect(res.body.overallHitRate).toBe(0);
  });
});

describe('GET /api/v1/admin/parse-logs/export', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: adminRoutes } = await import("./admin");
    app = express();
    app.use(express.json());
    app.use("/api/v1/admin", adminRoutes);
  });

  it('returns JSONL with userId stripped', async () => {
    mockParseTrainingLogFindMany.mockResolvedValue([
      {
        id: 'abc',
        airline: 'Lufthansa',
        templateUsed: 'lh-v1',
        templateHit: true,
        confidence: 90,
        fieldCount: 8,
        missingFields: [],
        parserProvider: 'ollama',
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const res = await request(app).get('/api/v1/admin/parse-logs/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/ndjson/);
    const lines = res.text.trim().split('\n').filter((l: string) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.userId).toBeUndefined();
    expect(parsed.airline).toBe('Lufthansa');
    expect(parsed.id).toBe('abc');
  });
});
