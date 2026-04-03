import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import nodemailer from "nodemailer";

// Persistent mock transporter shared across all calls to createTransport
const mockTransporter = {
  sendMail: jest.fn(),
  verify: jest.fn(),
};

// jest.mock is hoisted — factories run before any import statements
jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

jest.mock("../db", () => ({
  prisma: {
    smtpConfig: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../routes/admin/smtp", () => ({ SMTP_CONFIG_ID: 1 }));

// Import service after mocks are registered
import { sendFlightReminder, testSmtpConnection } from "../services/emailService";
import { prisma } from "../db";

const mockFindUnique = prisma.smtpConfig.findUnique as jest.Mock;
const mockCreateTransport = nodemailer.createTransport as jest.Mock;

const MOCK_FLIGHT = {
  id: "flight-1",
  flightNumber: "LH103",
  depName: "Munich Airport",
  depIata: "MUC",
  arrName: "Frankfurt Airport",
  arrIata: "FRA",
  departureTime: new Date("2026-05-01T10:00:00Z"),
};

const MOCK_USER = { notificationEmail: "user@example.com" };

const MOCK_SMTP_CONFIG = {
  id: 1,
  host: "smtp.example.com",
  port: 587,
  secure: false,
  username: "user",
  password: "pass",
  fromEmail: "noreply@example.com",
  fromName: "TravStats",
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("emailService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Always return the same persistent transporter so we can inspect its mocks
    mockCreateTransport.mockReturnValue(mockTransporter);
  });

  describe("sendFlightReminder", () => {
    it("skips send when user has no notification email", async () => {
      await sendFlightReminder(MOCK_FLIGHT, { notificationEmail: null }, 24);

      expect(mockFindUnique).not.toHaveBeenCalled();
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it("skips send when SMTP config is not found", async () => {
      mockFindUnique.mockResolvedValue(null);

      await sendFlightReminder(MOCK_FLIGHT, MOCK_USER, 24);

      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it("skips send when SMTP is disabled", async () => {
      mockFindUnique.mockResolvedValue({ ...MOCK_SMTP_CONFIG, enabled: false });

      await sendFlightReminder(MOCK_FLIGHT, MOCK_USER, 24);

      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it("sends email when SMTP is configured and enabled", async () => {
      mockFindUnique.mockResolvedValue(MOCK_SMTP_CONFIG);
      mockTransporter.sendMail.mockResolvedValue({ messageId: "msg-1" });

      await sendFlightReminder(MOCK_FLIGHT, MOCK_USER, 24);

      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockTransporter.sendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.to).toBe("user@example.com");
      expect(callArgs.subject).toContain("LH103");
      expect(callArgs.subject).toContain("24h");
      expect(callArgs.html).toContain("MUC");
      expect(callArgs.html).toContain("FRA");
    });

    it("throws when sendMail fails", async () => {
      mockFindUnique.mockResolvedValue(MOCK_SMTP_CONFIG);
      mockTransporter.sendMail.mockRejectedValue(new Error("SMTP connection refused"));

      await expect(sendFlightReminder(MOCK_FLIGHT, MOCK_USER, 24)).rejects.toThrow(
        "SMTP connection refused"
      );
    });

    it("uses flight number N/A when flightNumber is null", async () => {
      mockFindUnique.mockResolvedValue(MOCK_SMTP_CONFIG);
      mockTransporter.sendMail.mockResolvedValue({ messageId: "msg-1" });

      await sendFlightReminder({ ...MOCK_FLIGHT, flightNumber: null }, MOCK_USER, 48);

      const callArgs = mockTransporter.sendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.subject).toContain("N/A");
      expect(callArgs.subject).toContain("48h");
    });
  });

  describe("testSmtpConnection", () => {
    it("calls verify on the transporter", async () => {
      mockTransporter.verify.mockResolvedValue(true);

      await testSmtpConnection(MOCK_SMTP_CONFIG);

      expect(mockTransporter.verify).toHaveBeenCalledTimes(1);
    });

    it("throws when verify fails", async () => {
      mockTransporter.verify.mockRejectedValue(new Error("Connection refused"));

      await expect(testSmtpConnection(MOCK_SMTP_CONFIG)).rejects.toThrow("Connection refused");
    });

    it("creates transporter with correct settings", async () => {
      mockTransporter.verify.mockResolvedValue(true);

      await testSmtpConnection({ ...MOCK_SMTP_CONFIG, port: 465, secure: true });

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "smtp.example.com",
          port: 465,
          secure: true,
        })
      );
    });
  });
});
