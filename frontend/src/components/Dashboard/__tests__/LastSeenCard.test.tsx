import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import i18n from "../../../i18n/config";

const api = vi.hoisted(() => ({ lastSeen: vi.fn() }));
vi.mock("../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: api,
}));
const visible = vi.hoisted(() => ({ value: true }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackVisible: () => visible.value,
}));
// The real copy in both languages: the wording is what is under test.
vi.mock("../../../hooks/useTranslation", async () => {
  const { default: real } = await import("../../../i18n/config");
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => real.t(key, opts),
      i18n: real,
    }),
  };
});
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "Asia/Seoul" }));

import { LastSeenCard, LastSeenLine } from "../LastSeenCard";

/**
 * „Zuletzt gesehen" on the dashboard and on /track (TravTrack plan L2): how
 * long ago and on which device — no coordinates on screen, shown only where
 * TravTrack is visible, and a failed read says so instead of vanishing.
 */

const NOW = Date.parse("2026-10-25T03:00:00Z");
const SEEN = {
  at: new Date(NOW - 12 * 60_000).toISOString(),
  lat: 37.5665,
  lon: 126.978,
  accuracyM: 5,
  deviceId: "phone-1",
  deviceLabel: "Pixel 9",
  origin: "companion:phone-1",
};

function DayRoute() {
  return <p data-testid="track-day-route">{useParams().date}</p>;
}

const renderCard = (node = <LastSeenCard />) =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={node} />
        <Route path="/track/:date" element={<DayRoute />} />
      </Routes>
    </MemoryRouter>
  );

describe("LastSeenCard", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    visible.value = true;
    api.lastSeen.mockReset();
    await i18n.changeLanguage("de");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the age and the device, never the coordinates", async () => {
    api.lastSeen.mockResolvedValue(SEEN);
    renderCard();
    const card = await screen.findByTestId("last-seen-card");
    expect(card.textContent).toContain("Zuletzt gesehen");
    expect(card.textContent).toContain("vor 12 Min.");
    expect(card.textContent).toContain("Pixel 9");
    expect(card.textContent).not.toContain("37.5665");
    expect(card.textContent).not.toContain("126.978");
  });

  it("speaks English too", async () => {
    await i18n.changeLanguage("en");
    api.lastSeen.mockResolvedValue(SEEN);
    renderCard();
    const card = await screen.findByTestId("last-seen-card");
    expect(card.textContent).toContain("Last seen");
    expect(card.textContent).toContain("12 min. ago");
  });

  it("an unnamed device is called so", async () => {
    api.lastSeen.mockResolvedValue({ ...SEEN, deviceLabel: null });
    renderCard();
    expect((await screen.findByTestId("last-seen-card")).textContent).toContain(
      "Unbekanntes Gerät"
    );
  });

  it("opens the day it was seen on, on the profile clock", async () => {
    // 23:30Z on 24 Oct is already 25 Oct in Seoul.
    api.lastSeen.mockResolvedValue({ ...SEEN, at: "2026-10-24T23:30:00.000Z" });
    renderCard();
    fireEvent.click(await screen.findByTestId("last-seen-open"));
    expect((await screen.findByTestId("track-day-route")).textContent).toBe("2026-10-25");
  });

  it("no position yet is said, not hidden", async () => {
    api.lastSeen.mockResolvedValue(null);
    renderCard();
    expect((await screen.findByTestId("last-seen-card")).textContent).toContain(
      "Noch keine Position"
    );
  });

  it("a refusal reaches the user as itself", async () => {
    const response = {
      status: 403,
      statusText: "Forbidden",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: "off", code: "TRAVTRACK_DISABLED" },
    };
    api.lastSeen.mockRejectedValue(
      new AxiosError("403", "ERR_BAD_REQUEST", undefined, undefined, response)
    );
    renderCard();
    expect((await screen.findByTestId("last-seen-card")).textContent).toContain(
      "TravTrack ist auf diesem Server ausgeschaltet"
    );
  });

  it("is hidden, and asks nothing, while TravTrack is not visible", async () => {
    visible.value = false;
    api.lastSeen.mockResolvedValue(SEEN);
    renderCard();
    await waitFor(() => expect(screen.queryByTestId("last-seen-card")).toBeNull());
    expect(api.lastSeen).not.toHaveBeenCalled();
  });

  it("the /track header line says the same", async () => {
    api.lastSeen.mockResolvedValue(SEEN);
    renderCard(<LastSeenLine />);
    const line = await screen.findByTestId("track-last-seen");
    expect(line.textContent).toBe("Zuletzt gesehen vor 12 Min. · Pixel 9");
  });
});
