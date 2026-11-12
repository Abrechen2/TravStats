import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../lodging/RatingCategoriesManager", () => ({
  RatingCategoriesManager: ({ open }: { open: boolean }) => (
    <div data-testid="rating-manager" data-open={String(open)} />
  ),
}));

import LodgingRatingsSection from "../LodgingRatingsSection";

describe("LodgingRatingsSection (Unterkünfte)", () => {
  afterEach(() => cleanup());

  it("names the Bewertungskategorien row and mounts the stay editor's category manager in it", () => {
    render(<LodgingRatingsSection />);
    const row = screen.getByText("settingsRows:lodging.ratingcats.t").closest("[data-setting-row]");
    expect(row).not.toBeNull();
    expect(row).toContainElement(screen.getByTestId("rating-manager"));
  });
});
