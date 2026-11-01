import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import SettingsSectionSwitch from "../SettingsSectionSwitch";

const Where = (): JSX.Element => {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
};

function renderViews(): void {
  render(
    <MemoryRouter>
      <SettingsSectionSwitch
        section="mapAppearance"
        page={{} as Parameters<typeof SettingsSectionSwitch>[0]["page"]}
      />
      <Where />
    </MemoryRouter>
  );
}

describe("Settings › Karte, Start & Listen", () => {
  it("the map row deep-links to the map panel's Routen switches, not just to the dashboard", () => {
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /settings:views\.map\.jump/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/dashboard?panel=routes");
  });

  it("is one section with three jump rows: map look, home page, lists", () => {
    renderViews();
    for (const row of ["map", "start", "lists"]) {
      expect(screen.getByText(`settings:views.${row}.name`)).toBeInTheDocument();
      expect(screen.getByText(`settings:views.${row}.sub`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /settings:views\.start\.jump/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/dashboard");
  });
});
