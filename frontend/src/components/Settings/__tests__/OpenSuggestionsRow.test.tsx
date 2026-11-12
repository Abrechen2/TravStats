import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
const count = vi.fn();
vi.mock("../../../lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { count: () => count() },
}));

import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import OpenSuggestionsRow from "../OpenSuggestionsRow";

const renderRow = async (): Promise<void> => {
  render(<OpenSuggestionsRow />);
  await act(async () => {});
};

describe("OpenSuggestionsRow (Reisen & Vorschläge)", () => {
  beforeEach(() => {
    count.mockReset();
    useSuggestionSwitchesStore.setState({ trips: true });
  });
  afterEach(() => cleanup());

  it("shows how many suggestions wait in the inbox", async () => {
    count.mockResolvedValue(4);
    await renderRow();
    expect(screen.getByText("settingsRows:trips.offenevor.t")).toBeInTheDocument();
    expect(screen.getByText("settingsRows:trips.offenevor.count")).toBeInTheDocument();
  });

  it("says nothing was counted when the count could not be read, instead of showing 0", async () => {
    count.mockRejectedValue(new Error("503"));
    await renderRow();
    expect(screen.getByText("–")).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("does not count at all while trip suggestions are switched off", async () => {
    useSuggestionSwitchesStore.setState({ trips: false });
    await renderRow();
    expect(count).not.toHaveBeenCalled();
    expect(screen.getByText("settingsRows:trips.offenevor.off")).toBeInTheDocument();
  });
});
