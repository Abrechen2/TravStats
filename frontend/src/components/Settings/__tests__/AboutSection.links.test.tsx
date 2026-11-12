import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../lib/api/client", () => ({
  api: { get: vi.fn(() => new Promise(() => {})) },
}));

import AboutSection from "../AboutSection";

// Settings v3 gives Über TravStats a Changelog and a Dokumentation row.
describe("AboutSection — Changelog and Dokumentation", () => {
  it("opens the published changelog and the documentation in a new tab", () => {
    render(<AboutSection />);
    // The two "Öffnen" buttons, in the order of their rows: Changelog, then Dokumentation.
    const [changelog, docs] = screen.getAllByRole("link", { name: "settings:about.open" });
    expect(screen.getByText("settings:about.changelog.name")).toBeInTheDocument();
    expect(screen.getByText("settings:about.docs.name")).toBeInTheDocument();
    expect(changelog).toHaveAttribute(
      "href",
      "https://github.com/Abrechen2/TravStats/blob/main/CHANGELOG.md"
    );
    expect(changelog).toHaveAttribute("target", "_blank");
    expect(changelog).toHaveAttribute("rel", "noopener noreferrer");

    expect(docs).toHaveAttribute("href", "https://travstats.de/docs/");
  });
});
