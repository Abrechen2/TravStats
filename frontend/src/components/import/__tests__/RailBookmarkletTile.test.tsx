import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { RailBookmarkletTile } from "../RailBookmarkletTile";

const codeOf = (href: string | null): string =>
  decodeURIComponent((href ?? "").replace(/^javascript:/, ""));

describe("RailBookmarkletTile (forgejo#204)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers a draggable bookmark that hands over to this instance", () => {
    render(<RailBookmarkletTile />);
    const link = screen.getByTestId("rail-bookmarklet-link");
    expect(link).toHaveTextContent("rail:bookmarklet.linkLabel");
    expect(link).toHaveAttribute("draggable", "true");
    const href = link.getAttribute("href");
    expect(href?.startsWith("javascript:")).toBe(true);
    expect(codeOf(href)).toContain(JSON.stringify(`${window.location.origin}/rail/from-bahn`));
    expect(codeOf(href)).toContain("/web/api/angebote/verbindung/");
    // Never the recon POST bahn.de blocks after a few requests.
    expect(codeOf(href)).not.toContain('recon"');
    expect(codeOf(href)).not.toContain("POST");
  });

  it("explains a click on TravStats instead of running it here", () => {
    render(<RailBookmarkletTile />);
    const link = screen.getByTestId("rail-bookmarklet-link");
    // fireEvent answers false when the default was prevented.
    expect(fireEvent.click(link)).toBe(false);
    expect(screen.getByText("rail:bookmarklet.dragHint")).toBeInTheDocument();
  });

  it("names the steps and the way on an iPad or a phone", () => {
    render(<RailBookmarkletTile />);
    for (const key of ["step1", "step2", "step3", "touchHint", "privacy"]) {
      expect(screen.getByText(`rail:bookmarklet.${key}`)).toBeInTheDocument();
    }
  });

  it("copies the code, and shows it to select by hand when the clipboard refuses", async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("no"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<RailBookmarkletTile />);

    fireEvent.click(screen.getByRole("button", { name: "rail:bookmarklet.copy" }));
    expect(await screen.findByText("rail:bookmarklet.copied")).toBeInTheDocument();
    expect(writeText.mock.calls[0][0]).toMatch(/^javascript:/);
    expect(screen.queryByLabelText("rail:bookmarklet.codeLabel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "rail:bookmarklet.copy" }));
    expect(await screen.findByText("rail:bookmarklet.copyFailed")).toBeInTheDocument();
    expect(screen.getByLabelText("rail:bookmarklet.codeLabel")).toHaveValue(
      writeText.mock.calls[0][0]
    );
  });
});
