import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AutoCoverNote from "../AutoCoverNote";
import { useCoverCropStore } from "../../../store/coverCropStore";

vi.mock("../CoverSuggestDialog", () => ({
  default: () => <div data-testid="suggest-dialog" />,
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

const trip = { id: "t1", coverImageUrl: "/c.jpg", coverCrop: null };

describe("AutoCoverNote", () => {
  it("names the automatic choice and opens the suggestions", async () => {
    render(<AutoCoverNote trip={trip} onChanged={() => {}} />);
    expect(screen.getByText("autoCover.note")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "autoCover.other" }));
    expect(screen.getByTestId("suggest-dialog")).toBeInTheDocument();
  });

  it("opens the crop editor on the current cover", async () => {
    render(<AutoCoverNote trip={trip} onChanged={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "autoCover.adjust" }));
    expect(useCoverCropStore.getState().request?.coverImageUrl).toBe("/c.jpg");
  });
});
