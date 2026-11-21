import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { logger } from "../../../lib/logger";
import { WebGL2MissingBanner } from "../WebGL2MissingBanner";

describe("WebGL2MissingBanner (tester, 2026-11-18: no routes, no reason given)", () => {
  it("says what is missing as an alert and offers a reload", () => {
    render(<WebGL2MissingBanner />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("map:webgl2Missing");
    expect(screen.getByRole("button", { name: "map:webgl2MissingReload" })).toBeInTheDocument();
  });

  it("sits at the top of the map, not in the corner the map panel covers", () => {
    render(<WebGL2MissingBanner />);
    const banner = screen.getByTestId("webgl2-missing");
    expect(banner.style.top).not.toBe("");
    expect(banner.style.bottom).toBe("");
    expect(banner.className).toContain("z-30");
  });

  it("leaves a warning in the console that a bug report can quote", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    render(<WebGL2MissingBanner />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("WebGL2 was unavailable"));
    warn.mockRestore();
  });
});
