import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../lib/api/client", () => ({
  api: { get: vi.fn(() => new Promise(() => {})) },
}));

import AboutSection from "../AboutSection";

// The "full list with licenses" link pointed at LICENSES.md, a file .gitignore
// keeps out of the repository — every click ended on a GitHub 404. The list
// that IS published is the README's third-party section.
describe("AboutSection — licence list link", () => {
  it("points at the README's third-party section, not an unpublished file", () => {
    render(<AboutSection />);

    const link = screen.getByRole("link", { name: "settings:about.dataSources.fullList" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/Abrechen2/TravStats#third-party-data-and-assets"
    );
  });
});
