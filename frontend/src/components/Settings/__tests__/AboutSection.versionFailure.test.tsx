import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../../../lib/api/client", () => ({
  api: { get: vi.fn(() => Promise.reject(new Error("offline"))) },
}));
vi.mock("../../../lib/logger", () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import AboutSection from "../AboutSection";

// forgejo#385 RULE-39: the version read used `.catch(() => {})`, so a server that
// could not answer left the bundled version on screen with nothing in the log.
describe("AboutSection — a failed version read", () => {
  it("keeps the bundled version AND logs the failure as itself", async () => {
    render(<AboutSection />);
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith("Failed to read the server version", expect.any(Error))
    );
  });
});
