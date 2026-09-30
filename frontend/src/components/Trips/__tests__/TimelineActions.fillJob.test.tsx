import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * "Wetter nachtragen" as a server job with a per-entry outcome (silent-failure
 * fixes, 2026-09-26). It used to run one Open-Meteo call after another — up
 * to eight seconds each — inside a request the browser dropped after ten, and
 * then said "Das Wetter konnte nicht geholt werden" while the server kept
 * filling. The real `openDataApi.fillJournalWeather` and job poll run here;
 * only the HTTP client is stubbed.
 */

vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}#${o.count}` : k),
    i18n: { language: "de" },
  }),
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import { api } from "../../../lib/api/client";
import { useSettingsStore } from "../../../store/settingsStore";
import TimelineActions from "../TimelineActions";
import type { TripJournalEntry } from "../../../types";

const withoutWeather: TripJournalEntry = {
  id: "e1",
  tripId: "t1",
  date: "2024-07-15",
  title: null,
  body: "x",
  mood: null,
  weather: null,
  observedWeather: null,
  createdAt: "",
  updatedAt: "",
};

function renderActions(onChanged = vi.fn()) {
  useSettingsStore.setState({ openDataEnabled: true });
  render(
    <TimelineActions
      tripId="t1"
      entries={[withoutWeather]}
      onAddJournal={vi.fn()}
      onChanged={onChanged}
    />
  );
  return onChanged;
}

describe("filling a trip's weather reports each entry's outcome", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    addToast.mockClear();
  });

  it("runs past the old timeout and says what was filled and what the service refused", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { jobId: "job-1" } } as never);
    const answers = [
      { status: "running", result: null },
      {
        status: "succeeded",
        result: {
          filled: 1,
          outcomes: [
            { entryId: "e1", date: "2024-07-15", outcome: "observed" },
            { entryId: "e2", date: "2024-07-16", outcome: "rateLimited" },
            { entryId: "e3", date: "2024-07-17", outcome: "rateLimited" },
          ],
          entries: [],
        },
      },
    ];
    vi.spyOn(api, "get").mockImplementation((() =>
      Promise.resolve({
        data: { success: true, data: { id: "job-1", error: null, ...answers.shift() } },
      })) as never);
    const onChanged = renderActions();

    fireEvent.click(screen.getByRole("button", { name: "openData:weather.fill" }));

    await waitFor(
      () =>
        expect(addToast).toHaveBeenCalledWith(
          "info",
          "openData:weather.filled#1 openData:weather.fillFailed#2"
        ),
      { timeout: 4000 }
    );
    expect(onChanged).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("/trips/t1/journal/weather", { background: true });
  });

  it("an entry of today is 'not measured yet', not 'nothing to fill' and not 'no place'", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: { jobId: "job-1" } } as never);
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        success: true,
        data: {
          id: "job-1",
          status: "succeeded",
          error: null,
          result: {
            filled: 0,
            outcomes: [{ entryId: "e1", date: "2026-09-26", outcome: "futureOrToday" }],
            entries: [],
          },
        },
      },
    } as never);
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: "openData:weather.fill" }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("info", "openData:weather.fillNotYet#1")
    );
  });
});
