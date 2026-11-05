import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));
const caps = vi.hoisted(() => ({
  current: { version: 1, offered: true, enabled: true, active: true, hasData: true } as {
    version: 1;
    offered: boolean;
    enabled: boolean;
    active: boolean;
    hasData: boolean;
  },
}));
vi.mock("../../../../hooks/useTravTrackVisible", () => ({
  useTravTrackCapabilities: () => caps.current,
}));
const demo = vi.hoisted(() => ({ current: false }));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.current }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import TravTrackPlacesSection from "../TravTrackPlacesSection";
import { travTrackPlacesApi, type FixedPlacesAnswer } from "../../../../lib/api/travtrackPlaces";
import { travTrackApi } from "../../../../lib/api/travtrack";
import { resetWriteQueue } from "../../../ui/settings/writeQueue";

/**
 * Settings → TravTrack → Feste Orte against the contract in
 * docs/superpowers/specs/2026-11-05-travtrack-fixed-places.md, with the API
 * mocked: the backend is built by another package.
 */

const HOME = {
  id: "home",
  name: "Zuhause",
  kind: "home" as const,
  lat: 48.78,
  lon: 9.18,
  radiusM: 150,
  window: null,
};
const WORK = {
  id: "w1",
  name: "Büro",
  kind: "work" as const,
  lat: 48.8,
  lon: 9.2,
  radiusM: 200,
  window: { days: [1, 2, 3, 4, 5], from: "08:00", until: "18:00" },
};
const ANSWER: FixedPlacesAnswer = {
  places: [HOME, WORK],
  lodgingAsPlace: { enabled: false, radiusM: 150 },
  lodgingSkipped: 2,
};
const failure = (status: number, error?: string) =>
  Object.assign(new Error(String(status)), { response: { status, data: error ? { error } : {} } });
const show = () =>
  render(
    <MemoryRouter>
      <TravTrackPlacesSection />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.restoreAllMocks();
  demo.current = false;
  caps.current = { version: 1, offered: true, enabled: true, active: true, hasData: true };
  navigate.mockReset();
  vi.spyOn(travTrackPlacesApi, "list").mockResolvedValue(ANSWER);
  vi.spyOn(travTrackApi, "zones").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
});

describe("Feste Orte", () => {
  it("lists home and work with radius and window, and the skipped bookings", async () => {
    show();
    const work = await screen.findByTestId("place-w1");
    expect(work).toHaveTextContent("Büro");
    expect(work).toHaveTextContent('"metres":200');
    expect(work).toHaveTextContent("settings:tt.places.days.1");
    expect(work).toHaveTextContent("08:00–18:00");
    expect(screen.getByTestId("place-home")).toHaveTextContent("settings:tt.places.kinds.home");
    expect(
      screen.getByText(/settings:tt\.places\.lodging\.skipped.*"count":2/)
    ).toBeInTheDocument();
  });

  it("says the server is too old when /travtrack/places answers 404, and draws no editor", async () => {
    vi.spyOn(travTrackPlacesApi, "list").mockRejectedValue(failure(404));
    show();
    expect(await screen.findByTestId("places-too-old")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "settings:tt.places.add" })).toBeNull();
  });

  it("a list that does not load is not 'no places'; it retries", async () => {
    const list = vi
      .spyOn(travTrackPlacesApi, "list")
      .mockRejectedValueOnce(failure(500))
      .mockResolvedValue(ANSWER);
    show();
    expect(await screen.findByText("settings:tt.places.loadError")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    expect(await screen.findByTestId("place-w1")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("adds a place with name, centre, radius and a weekday window", async () => {
    const create = vi.spyOn(travTrackPlacesApi, "create").mockResolvedValue({ ...WORK, id: "n1" });
    show();
    await userEvent.click(await screen.findByRole("button", { name: "settings:tt.places.add" }));
    const save = screen.getByRole("button", { name: "settings:tt.places.editor.save" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("settings:tt.places.editor.name"), "Gym");
    await userEvent.type(screen.getByLabelText("settings:tt.places.editor.centre"), "48.1, 9.1");
    await userEvent.clear(screen.getByLabelText(/settings:tt.places.editor.radius$/));
    await userEvent.type(screen.getByLabelText(/settings:tt.places.editor.radius$/), "80");
    await userEvent.click(screen.getByLabelText("settings:tt.places.editor.timed"));
    await userEvent.click(screen.getByRole("button", { name: "settings:tt.places.days.6" }));
    await userEvent.click(save);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      name: "Gym",
      kind: "custom",
      lat: 48.1,
      lon: 9.1,
      radiusM: 80,
      window: { days: [1, 2, 3, 4, 5, 6], from: "08:00", until: "18:00" },
    });
    // The list is read again after the write.
    await waitFor(() => expect(travTrackPlacesApi.list).toHaveBeenCalledTimes(2));
  });

  it("refuses a radius outside 25..2000 m before asking the server", async () => {
    const create = vi.spyOn(travTrackPlacesApi, "create");
    show();
    await userEvent.click(await screen.findByRole("button", { name: "settings:tt.places.add" }));
    await userEvent.type(screen.getByLabelText("settings:tt.places.editor.name"), "Gym");
    await userEvent.type(screen.getByLabelText("settings:tt.places.editor.centre"), "48.1, 9.1");
    await userEvent.clear(screen.getByLabelText(/settings:tt.places.editor.radius$/));
    await userEvent.type(screen.getByLabelText(/settings:tt.places.editor.radius$/), "5000");
    expect(screen.getByRole("button", { name: "settings:tt.places.editor.save" })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the form and offers a retry when the server refuses; says why for a 400", async () => {
    const create = vi
      .spyOn(travTrackPlacesApi, "create")
      .mockRejectedValueOnce(failure(400, "validation"))
      .mockResolvedValueOnce({ ...WORK, id: "n1" });
    show();
    await userEvent.click(await screen.findByRole("button", { name: "settings:tt.places.add" }));
    await userEvent.type(screen.getByLabelText("settings:tt.places.editor.name"), "Gym");
    await userEvent.type(screen.getByLabelText("settings:tt.places.editor.centre"), "48.1, 9.1");
    await userEvent.click(screen.getByRole("button", { name: "settings:tt.places.editor.save" }));
    expect(await screen.findByText("settings:tt.places.errors.validation")).toBeInTheDocument();
    expect(screen.getByLabelText("settings:tt.places.editor.name")).toHaveValue("Gym");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  });

  it("names TravTrack-off (403) and an unreachable server separately", async () => {
    const create = vi
      .spyOn(travTrackPlacesApi, "create")
      .mockRejectedValueOnce(
        Object.assign(new Error("403"), {
          response: { status: 403, data: { code: "TRAVTRACK_DISABLED" } },
        })
      )
      .mockRejectedValueOnce(Object.assign(new Error("net"), { response: undefined }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "settings:tt.places.add" }));
    await userEvent.type(screen.getByLabelText("settings:tt.places.editor.name"), "Gym");
    await userEvent.type(screen.getByLabelText("settings:tt.places.editor.centre"), "48.1, 9.1");
    await userEvent.click(screen.getByRole("button", { name: "settings:tt.places.editor.save" }));
    expect(await screen.findByText("settings:tt.places.errors.disabled")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    expect(await screen.findByText("settings:tt.places.errors.network")).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("edits home by radius and window only, through PUT /places/home", async () => {
    const update = vi
      .spyOn(travTrackPlacesApi, "update")
      .mockResolvedValue({ ...HOME, radiusM: 300 });
    show();
    await userEvent.click(await screen.findByRole("button", { name: /places\.edit: Zuhause/ }));
    expect(screen.getByText("settings:tt.places.editor.homeNote")).toBeInTheDocument();
    expect(screen.queryByLabelText("settings:tt.places.editor.name")).toBeNull();
    expect(screen.queryByLabelText("settings:tt.places.editor.centre")).toBeNull();
    await userEvent.clear(screen.getByLabelText(/settings:tt.places.editor.radius$/));
    await userEvent.type(screen.getByLabelText(/settings:tt.places.editor.radius$/), "300");
    await userEvent.click(screen.getByRole("button", { name: "settings:tt.places.editor.save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("home", { radiusM: 300, window: null })
    );
  });

  it("sends 'Wohnort ändern' to the profile and offers no delete for home", async () => {
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: /settings:tt\.places\.changeHome/ })
    );
    expect(navigate).toHaveBeenCalledWith("/settings/account#home", undefined);
    expect(screen.queryByRole("button", { name: /places\.remove: Zuhause/ })).toBeNull();
  });

  it("deletes a place only after the confirmation, and a 404 on it says it is gone", async () => {
    const remove = vi.spyOn(travTrackPlacesApi, "remove").mockRejectedValueOnce(
      Object.assign(new Error("404"), {
        response: { status: 404, data: { code: "TRAVTRACK_PLACE_NOT_FOUND" } },
      })
    );
    show();
    await userEvent.click(await screen.findByRole("button", { name: /places\.remove: Büro/ }));
    const dialog = await screen.findByRole("dialog");
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getAllByRole("button").pop()!);
    expect(await screen.findByText("settings:tt.places.errors.notFound")).toBeInTheDocument();
    expect(remove).toHaveBeenCalledWith("w1");
  });

  it("writes the lodging switch with its radius, and keeps it on a refusal", async () => {
    const set = vi
      .spyOn(travTrackPlacesApi, "setLodging")
      .mockRejectedValueOnce(failure(500))
      .mockResolvedValueOnce({ enabled: true, radiusM: 150 });
    show();
    await userEvent.click(
      await screen.findByRole("switch", { name: "settings:tt.places.lodging.name" })
    );
    expect(await screen.findByText("settings:tt.places.errors.generic")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "settings:tt.places.lodging.name" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
    expect(set).toHaveBeenLastCalledWith({ enabled: true, radiusM: 150 });
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "settings:tt.places.lodging.name" })
      ).toHaveAttribute("aria-checked", "true")
    );
  });

  it("saves a changed lodging radius only on its own button, with the switch state unchanged", async () => {
    const set = vi
      .spyOn(travTrackPlacesApi, "setLodging")
      .mockResolvedValue({ enabled: false, radiusM: 300 });
    show();
    const input = await screen.findByLabelText(/settings:tt.places.lodging.radius/);
    await userEvent.clear(input);
    await userEvent.type(input, "300");
    expect(set).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "settings:tt.places.lodging.saveRadius" })
    );
    await waitFor(() => expect(set).toHaveBeenCalledWith({ enabled: false, radiusM: 300 }));
  });

  it("says why an out-of-range lodging radius is not saved", async () => {
    show();
    const input = await screen.findByLabelText(/settings:tt.places.lodging.radius/);
    await userEvent.clear(input);
    await userEvent.type(input, "9");
    expect(screen.getAllByText(/settings:tt.places.editor.radiusInvalid/).length).toBeGreaterThan(
      0
    );
    expect(
      screen.queryByRole("button", { name: "settings:tt.places.lodging.saveRadius" })
    ).toBeNull();
  });

  it("offers no editing to the demo account or while TravTrack is off", async () => {
    demo.current = true;
    show();
    await screen.findByTestId("place-w1");
    expect(screen.queryByRole("button", { name: "settings:tt.places.add" })).toBeNull();
    expect(screen.queryByRole("button", { name: /places\.edit: Büro/ })).toBeNull();
  });
});
