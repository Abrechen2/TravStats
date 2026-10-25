import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ months: vi.fn(), cityLookup: vi.fn(), setCityLookup: vi.fn() }));
vi.mock("../../../lib/api/travtrackMonths", () => ({ travTrackMonthsApi: api }));

import TravTrackCityLookup from "../TravTrackCityLookup";

/**
 * The city lookup switch of the monthly values (TravTrack plan L3): off by
 * default, its copy says rounded positions go to the geocoder, a save that
 * failed says so.
 */

describe("TravTrackCityLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.cityLookup.mockResolvedValue(false);
    api.setCityLookup.mockImplementation(async (enabled: boolean) => enabled);
  });

  it("is off by default and its copy names what is sent", async () => {
    render(<TravTrackCityLookup canChange />);
    const toggle = await screen.findByRole("switch", { name: "track:settings.cities.label" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("track:settings.cities.intro")).toBeInTheDocument();
  });

  it("switched on, it saves and says when cities come", async () => {
    render(<TravTrackCityLookup canChange />);
    await userEvent.click(await screen.findByRole("switch"));
    await waitFor(() => expect(api.setCityLookup).toHaveBeenCalledWith(true));
    expect(await screen.findByText("track:settings.cities.savedOn")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("a failed save says so and keeps the switch as it was", async () => {
    api.setCityLookup.mockRejectedValue(new Error("network"));
    render(<TravTrackCityLookup canChange />);
    await userEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("track:settings.cities.notSaved");
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("read-only where it cannot be changed", async () => {
    render(<TravTrackCityLookup canChange={false} />);
    expect(await screen.findByRole("switch")).toBeDisabled();
  });
});
