import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import TimelineActions from "../TimelineActions";
import { openDataApi } from "../../../lib/api/openData";
import { useSettingsStore } from "../../../store/settingsStore";
import type { TripJournalEntry } from "../../../types";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/openData", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../lib/api/openData")>();
  return { ...original, openDataApi: { ...original.openDataApi, fillJournalWeather: vi.fn() } };
});

const entry = (observed: boolean): TripJournalEntry => ({
  id: observed ? "a" : "b",
  tripId: "t1",
  date: "2024-07-15",
  title: null,
  body: "x",
  mood: null,
  weather: null,
  observedWeather: observed
    ? {
        code: 0,
        tMaxC: 20,
        tMinC: 10,
        precipMm: 0,
        place: "Stavanger",
        lat: 58.97,
        lon: 5.73,
        source: "open-meteo",
        fetchedAt: "2026-09-24T00:00:00Z",
      }
    : null,
  createdAt: "",
  updatedAt: "",
});

describe("TimelineActions", () => {
  beforeEach(() => vi.mocked(openDataApi.fillJournalWeather).mockReset());

  it("offers the weather only where open data is on and an entry lacks it", () => {
    useSettingsStore.setState({ openDataEnabled: true });
    const { rerender } = render(
      <TimelineActions
        tripId="t1"
        entries={[entry(true)]}
        onAddJournal={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "openData:weather.fill" })).toBeNull();
    rerender(
      <TimelineActions
        tripId="t1"
        entries={[entry(false)]}
        onAddJournal={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "openData:weather.fill" })).toBeInTheDocument();
    act(() => useSettingsStore.setState({ openDataEnabled: false }));
    rerender(
      <TimelineActions
        tripId="t1"
        entries={[entry(false)]}
        onAddJournal={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "openData:weather.fill" })).toBeNull();
  });

  it("fills the missing weather and reloads the trip", async () => {
    useSettingsStore.setState({ openDataEnabled: true });
    vi.mocked(openDataApi.fillJournalWeather).mockResolvedValue({ filled: 1, entries: [] });
    const onChanged = vi.fn();
    render(
      <TimelineActions
        tripId="t1"
        entries={[entry(false)]}
        onAddJournal={vi.fn()}
        onChanged={onChanged}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "openData:weather.fill" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(openDataApi.fillJournalWeather).toHaveBeenCalledWith("t1");
  });
});
