import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import HomeSuggestionPrompt from "../HomeSuggestionPrompt";

describe("HomeSuggestionPrompt", () => {
  it("asks whether the spot is home and links to the existing home setting", () => {
    render(
      <MemoryRouter>
        <HomeSuggestionPrompt suggestion={{ lat: 47.8, lon: 12.1, fromMs: 0, untilMs: 1 }} />
      </MemoryRouter>
    );
    expect(screen.getByText("track:homeSuggestion.question")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "track:homeSuggestion.action" }).getAttribute("href")
    ).toBe("/settings/reisearten#home");
  });
});
