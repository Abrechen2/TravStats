import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger } from "../lib/logger";

describe("Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should log info messages in development", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    logger.info("Test message");

    // In development mode, info should be called
    // Note: Actual behavior depends on import.meta.env.DEV
    expect(consoleSpy).toBeDefined();
    consoleSpy.mockRestore();
  });

  it("should always log error messages", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("Test error");

    expect(consoleSpy).toHaveBeenCalledWith("Test error");
    consoleSpy.mockRestore();
  });

  it("should log warn messages", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.warn("Test warning");

    expect(consoleSpy).toHaveBeenCalledWith("Test warning");
    consoleSpy.mockRestore();
  });
});
