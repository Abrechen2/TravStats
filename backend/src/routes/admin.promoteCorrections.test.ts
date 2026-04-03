import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockAnalyticsEventFindMany = jest.fn();
const mockTrainingDataCreate = jest.fn();
const mockTrainingDataFindMany = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    analyticsEvent: { findMany: mockAnalyticsEventFindMany },
    trainingData: {
      create: mockTrainingDataCreate,
      findMany: mockTrainingDataFindMany,
    },
  },
}));
jest.mock("../middleware/auth", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock("../middleware/rateLimit", () => ({
  adminExportLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
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
jest.mock("../services/parserFeedback", () => ({
  getParserFeedbackStats: jest.fn(),
}));
jest.mock("../services/apiKeyTester", () => ({
  testOpenAIKey: jest.fn(),
  testClaudeKey: jest.fn(),
  testAirlabsKey: jest.fn(),
  testAviationstackKey: jest.fn(),
  testOpenSkyCredentials: jest.fn(),
}));
jest.mock("../services/patternAnalyzer", () => ({
  analyzeFeedbackForPatterns: jest.fn(),
  getPatternAnalysisSummary: jest.fn(),
}));
jest.mock("../services/patternUpdater", () => ({
  getPendingPatternSuggestions: jest.fn(),
  applyPatternSuggestion: jest.fn(),
  autoApplyHighConfidencePatterns: jest.fn(),
  getPatternUpdateStats: jest.fn(),
}));
jest.mock("../services/hardwareService", () => ({
  getHardwareInfo: jest.fn(),
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

describe("POST /api/v1/admin/parse-logs/promote", () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    const { default: adminRoutes } = await import("./admin");
    app = express();
    app.use(express.json());
    app.use("/api/v1/admin", adminRoutes);
  });

  it("creates TrainingData for events with correctedResult", async () => {
    mockTrainingDataFindMany.mockResolvedValue([]);
    mockAnalyticsEventFindMany.mockResolvedValue([
      {
        id: "evt-1",
        userId: "user-1",
        type: "parser_feedback",
        payload: {
          sourceType: "email",
          correctedResult: [{ flightNumber: "LH123" }],
          originalData: { subject: "Booking", text: "Flight LH123" },
        },
        createdAt: new Date(),
      },
    ]);
    mockTrainingDataCreate.mockResolvedValue({ id: "td-1" });

    const res = await request(app).post("/api/v1/admin/parse-logs/promote").send({});
    expect(res.status).toBe(200);
    expect(res.body.promoted).toBe(1);
    expect(mockTrainingDataCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          type: "email",
          status: "pending",
          tags: ["auto-promoted"],
        }),
      })
    );
  });

  it("skips events without correctedResult", async () => {
    mockTrainingDataFindMany.mockResolvedValue([]);
    mockAnalyticsEventFindMany.mockResolvedValue([
      {
        id: "evt-2",
        userId: "user-1",
        type: "parser_feedback",
        payload: { sourceType: "email" }, // no correctedResult
        createdAt: new Date(),
      },
    ]);

    const res = await request(app).post("/api/v1/admin/parse-logs/promote").send({});
    expect(res.status).toBe(200);
    expect(res.body.promoted).toBe(0);
    expect(mockTrainingDataCreate).not.toHaveBeenCalled();
  });

  it("skips events with empty correctedResult array", async () => {
    mockTrainingDataFindMany.mockResolvedValue([]);
    mockAnalyticsEventFindMany.mockResolvedValue([
      {
        id: "evt-3",
        userId: "user-1",
        type: "parser_feedback",
        payload: { sourceType: "email", correctedResult: [] },
        createdAt: new Date(),
      },
    ]);

    const res = await request(app).post("/api/v1/admin/parse-logs/promote").send({});
    expect(res.status).toBe(200);
    expect(res.body.promoted).toBe(0);
    expect(mockTrainingDataCreate).not.toHaveBeenCalled();
  });

  it("skips already-promoted events on second call", async () => {
    mockAnalyticsEventFindMany.mockResolvedValue([
      {
        id: "evt-1",
        userId: "user-1",
        type: "parser_feedback",
        payload: {
          sourceType: "email",
          correctedResult: [{ flightNumber: "LH123" }],
          originalData: {},
        },
        createdAt: new Date(),
      },
    ]);
    // Simulate that this event was already promoted
    mockTrainingDataFindMany.mockResolvedValue([{ originalFile: "promoted:evt-1" }]);

    const res = await request(app).post("/api/v1/admin/parse-logs/promote").send({});
    expect(res.status).toBe(200);
    expect(res.body.promoted).toBe(0);
    expect(mockTrainingDataCreate).not.toHaveBeenCalled();
  });
});
