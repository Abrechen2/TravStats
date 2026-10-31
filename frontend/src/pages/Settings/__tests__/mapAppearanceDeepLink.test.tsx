import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import SettingsSectionSwitch from "../SettingsSectionSwitch";

describe("Settings › Ansichten › Routen", () => {
  it("deep-links to the map panel's Routen switches, not just to the dashboard", () => {
    render(
      <MemoryRouter>
        <SettingsSectionSwitch
          section="mapAppearance"
          page={{} as Parameters<typeof SettingsSectionSwitch>[0]["page"]}
        />
      </MemoryRouter>
    );
    const links = screen.getAllByRole("link", { name: "settings:contextLinks.open" });
    expect(links[0]).toHaveAttribute("href", "/dashboard?panel=routes");
  });
});
