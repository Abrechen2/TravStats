import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "../lib/clipboard";

describe("copyToClipboard", () => {
  const originalClipboard = navigator.clipboard;
  const originalIsSecureContext = window.isSecureContext;
  const originalExecCommand = document.execCommand;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: originalIsSecureContext,
      configurable: true,
    });
    document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
  });

  describe("secure context with navigator.clipboard", () => {
    beforeEach(() => {
      Object.defineProperty(window, "isSecureContext", {
        value: true,
        configurable: true,
      });
    });

    it("uses the modern API when available", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      await copyToClipboard("hello");
      expect(writeText).toHaveBeenCalledWith("hello");
    });

    it("falls back to execCommand when navigator.clipboard.writeText rejects", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("NotAllowed"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      document.execCommand = vi.fn().mockReturnValue(true);

      await copyToClipboard("hello");
      expect(writeText).toHaveBeenCalled();
      expect(document.execCommand).toHaveBeenCalledWith("copy");
    });
  });

  describe("insecure context (HTTP on a LAN IP)", () => {
    beforeEach(() => {
      Object.defineProperty(window, "isSecureContext", {
        value: false,
        configurable: true,
      });
      // A non-null clipboard object that we should NOT call
      const writeText = vi.fn();
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
    });

    it("skips navigator.clipboard entirely and uses execCommand", async () => {
      document.execCommand = vi.fn().mockReturnValue(true);

      await copyToClipboard("insecure-payload");

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(document.execCommand).toHaveBeenCalledWith("copy");
    });

    it("throws when execCommand returns false", async () => {
      document.execCommand = vi.fn().mockReturnValue(false);

      await expect(copyToClipboard("x")).rejects.toThrow(/execCommand/);
    });

    it("throws when execCommand throws", async () => {
      document.execCommand = vi.fn().mockImplementation(() => {
        throw new Error("not supported");
      });

      await expect(copyToClipboard("x")).rejects.toThrow(/execCommand/);
    });
  });
});
