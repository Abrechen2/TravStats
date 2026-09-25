import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import JournalWeatherFetch from "../JournalWeatherFetch";
import { openDataApi } from "../../../lib/api/openData";
import { useSettingsStore } from "../../../store/settingsStore";
import type { ObservedWeather, TripJournalEntry } from "../../../types";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.place ? `${k}(${String(o.place)})` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/api/openData", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../lib/api/openData")>();
  return { ...original, openDataApi: { ...original.openDataApi, refreshEntryWeather: vi.fn() } };
});

const measured: ObservedWeather = {
  code: 61,
  tMaxC: 17,
  tMinC: 11,
  precipMm: 0.7,
  place: "Stavanger",
  lat: 58.97,
  lon: 5.73,
  source: "open-meteo",
  fetchedAt: "2026-09-25T00:00:00Z",
};

const saved: TripJournalEntry = {
  id: "e1",
  tripId: "t1",
  date: "2024-07-15T00:00:00.000Z",
  title: null,
  body: "x",
  mood: null,
  weather: null,
  observedWeather: null,
  createdAt: "",
  updatedAt: "",
};

function renderFetch(
  over: Partial<{ entry: TripJournalEntry | null; date: string; weather: string }> = {}
) {
  const onPick = vi.fn();
  render(
    <JournalWeatherFetch
      tripId="t1"
      entry={over.entry === undefined ? saved : over.entry}
      date={over.date ?? "2024-07-15"}
      weather={over.weather ?? ""}
      onPick={onPick}
    />
  );
  return onPick;
}

describe("JournalWeatherFetch", () => {
  beforeEach(() => {
    vi.mocked(openDataApi.refreshEntryWeather).mockReset();
    useSettingsStore.setState({ openDataEnabled: true });
  });

  it("is absent while the instance's open data switch is off", () => {
    useSettingsStore.setState({ openDataEnabled: false });
    const { container } = render(
      <JournalWeatherFetch
        tripId="t1"
        entry={saved}
        date="2024-07-15"
        weather=""
        onPick={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says why there is no button for a new entry", () => {
    renderFetch({ entry: null });
    expect(screen.getByText("openData:weather.onSave")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not fetch the stored day's weather for a date the form has changed", () => {
    renderFetch({ date: "2024-07-16" });
    expect(screen.getByText("openData:weather.onSaveNewDate")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("fetches this entry's weather and offers it, without writing the author's field", async () => {
    vi.mocked(openDataApi.refreshEntryWeather).mockResolvedValue({
      ...saved,
      observedWeather: measured,
    });
    const onPick = renderFetch();

    fireEvent.click(screen.getByRole("button", { name: "openData:weather.fetchOne" }));

    expect(
      await screen.findByText(/openData:weather\.measuredAt\(Stavanger\)/)
    ).toBeInTheDocument();
    expect(openDataApi.refreshEntryWeather).toHaveBeenCalledWith("t1", "e1");
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /common:suggestionChip|17°\/11°/ }));
    expect(onPick).toHaveBeenCalledWith(
      expect.stringMatching(/^17°\/11° · openData:weather\.code\.rain · 0,7 mm$/)
    );
  });

  it("says so when the trip knows no place for the day", async () => {
    vi.mocked(openDataApi.refreshEntryWeather).mockResolvedValue({
      ...saved,
      observedWeather: null,
    });
    renderFetch();

    fireEvent.click(screen.getByRole("button", { name: "openData:weather.fetchOne" }));

    await waitFor(() => expect(screen.getByText("openData:weather.noPlace")).toBeInTheDocument());
  });
});
