import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AutoCoverSetting from "../AutoCoverSetting";

const getAuto = vi.fn();
const setAuto = vi.fn();
const removeAutoCovers = vi.fn();
vi.mock("../../../lib/api/coverSuggestions", () => ({
  coverSuggestionsApi: {
    getAuto: (...a: unknown[]) => getAuto(...a),
    setAuto: (...a: unknown[]) => setAuto(...a),
    removeAutoCovers: (...a: unknown[]) => removeAutoCovers(...a),
  },
}));

describe("AutoCoverSetting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the switch as on and saves turning it off", async () => {
    getAuto.mockResolvedValue({ enabled: true, autoCovers: 0 });
    setAuto.mockResolvedValue(undefined);
    render(<AutoCoverSetting />);
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(setAuto).toHaveBeenCalledWith(false));
    expect(box).not.toBeChecked();
  });

  it("removes the automatic covers and says how many", async () => {
    getAuto.mockResolvedValue({ enabled: true, autoCovers: 2 });
    removeAutoCovers.mockResolvedValue(2);
    render(<AutoCoverSetting />);
    await userEvent.click(await screen.findByRole("button", { name: /autoCover\.remove/ }));
    await waitFor(() => expect(removeAutoCovers).toHaveBeenCalled());
    expect(await screen.findByText("autoCover.removed")).toBeInTheDocument();
  });

  it("says so when the save fails and keeps the old state", async () => {
    getAuto.mockResolvedValue({ enabled: true, autoCovers: 0 });
    setAuto.mockRejectedValue(new Error("boom"));
    render(<AutoCoverSetting />);
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.click(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("autoCover.saveFailed");
    expect(box).toBeChecked();
  });
});
