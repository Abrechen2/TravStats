import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import ShareLinkDialog from "../ShareLinkDialog";
import { shareLinksApi } from "../../../lib/api/shareLinks";

/**
 * "Als Link teilen" (forgejo#281): the preview is asked with exactly the
 * ticked fields, the URL is shown once after creating, a switched-off
 * instance is said instead of offering a form, and every refusal is said as
 * itself — never a silent close.
 */

vi.mock("../../../lib/api/shareLinks", () => ({
  shareLinksApi: { list: vi.fn(), preview: vi.fn(), create: vi.fn(), revoke: vi.fn() },
}));

const api = vi.mocked(shareLinksApi);

function renderDialog(kind: "trip" | "wrapped" = "trip") {
  render(
    <MemoryRouter>
      <ShareLinkDialog open onClose={vi.fn()} kind={kind} targetId="f1" />
    </MemoryRouter>
  );
}

describe("ShareLinkDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ enabled: true, links: [] });
    api.preview.mockResolvedValue({
      view: { kind: "trip", trip: { name: "New York LH400" } },
      photosOmitted: null,
    });
  });

  it("says that the instance has public links switched off, and offers no form", async () => {
    api.list.mockResolvedValue({ enabled: false, links: [] });
    renderDialog();
    expect(await screen.findByText("sharing:links.dialog.disabled")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("starts a trip link with name, dates, flights, stays and transport, and asks again when one is unticked", async () => {
    renderDialog();
    expect(await screen.findByText("LH400", { exact: false })).toBeTruthy();
    expect(api.preview).toHaveBeenLastCalledWith({
      kind: "trip",
      targetId: "f1",
      fields: ["name", "dates", "flights", "stays", "transport"],
    });
    // Four itinerary sections plus seven other fields; the old "itinerary" is not offered.
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(11);
    expect(
      screen.queryByRole("checkbox", { name: "sharing:links.fields.trip.itinerary" })
    ).toBeNull();
    const places = screen.getByRole("checkbox", { name: "sharing:links.fields.trip.places" });
    expect((places as HTMLInputElement).checked).toBe(false);
    await userEvent.click(
      screen.getByRole("checkbox", { name: "sharing:links.fields.trip.stays" })
    );
    await waitFor(() =>
      expect(api.preview).toHaveBeenLastCalledWith({
        kind: "trip",
        targetId: "f1",
        fields: ["name", "dates", "flights", "transport"],
      })
    );
  });

  it("offers no cost, companion or note field any more (2026-11-22)", async () => {
    renderDialog();
    await screen.findByText("LH400", { exact: false });
    for (const field of ["costs", "companions", "notes"]) {
      expect(
        screen.queryByRole("checkbox", { name: `sharing:links.fields.trip.${field}` })
      ).toBeNull();
    }
  });

  it("creates the link and shows its URL once", async () => {
    api.create.mockResolvedValue({
      id: "l1",
      url: "https://example.test/share#ts_share_abc",
      token: "ts_share_abc",
      expiresAt: "2030-09-01T00:00:00.000Z",
      effectiveExpiresAt: "2030-06-01T22:00:00.000Z",
    });
    renderDialog();
    await screen.findByText("LH400", { exact: false });
    await userEvent.click(screen.getByRole("button", { name: "sharing:links.dialog.create" }));
    const input = (await screen.findByDisplayValue(
      "https://example.test/share#ts_share_abc"
    )) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    const sent = api.create.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: "trip", targetId: "f1" });
    // "Until a week after the trip": the longest lifetime, which the server cuts at its cap.
    expect(sent.expiresInDays).toBe(90);
    expect(sent).not.toHaveProperty("expiresAt");
    expect(screen.queryByRole("button", { name: "sharing:links.dialog.create" })).toBeNull();
  });

  it("defaults a trip link to a week after the trip, and a year in review to a week", async () => {
    renderDialog();
    await screen.findByText("LH400", { exact: false });
    const expiry = screen.getByLabelText("sharing:links.dialog.expiry") as HTMLSelectElement;
    expect(expiry.value).toBe("tripEnd");
    cleanup();
    api.preview.mockResolvedValue({
      view: { kind: "wrapped", wrapped: { year: 2029, totals: undefined } },
      photosOmitted: null,
    });
    renderDialog("wrapped");
    await screen.findByTestId("share-preview");
    const wrappedExpiry = screen.getByLabelText("sharing:links.dialog.expiry") as HTMLSelectElement;
    expect(wrappedExpiry.value).toBe("week");
    expect(screen.queryByText("sharing:links.dialog.expiryOptions.tripEnd")).toBeNull();
  });

  it("says why the server refused — the link limit is not a network error", async () => {
    api.create.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "SHARE_LINK_LIMIT" } },
    });
    renderDialog();
    await screen.findByText("LH400", { exact: false });
    await userEvent.click(screen.getByRole("button", { name: "sharing:links.dialog.create" }));
    expect(await screen.findByText("sharing:links.errors.limit")).toBeTruthy();
  });

  it("tells the owner which photos stay out of a trip link, and why", async () => {
    api.preview.mockResolvedValue({
      view: { kind: "trip", trip: { photos: { count: 12 } } },
      photosOmitted: { unsupportedType: 2, unreadable: 0, overLimit: 1 },
    });
    renderDialog("trip");
    const note = await screen.findByRole("note");
    expect(note.textContent).toContain("sharing:links.dialog.photosOmitted.lead");
    expect(note.textContent).toContain("sharing:links.dialog.photosOmitted.unsupportedType");
    expect(note.textContent).toContain("sharing:links.dialog.photosOmitted.overLimit");
    expect(note.textContent).not.toContain("unreadable");
  });

  it("says so when the preview cannot be loaded, and when nothing is ticked", async () => {
    api.preview.mockRejectedValue(new Error("boom"));
    renderDialog("trip");
    expect(await screen.findByText("sharing:links.dialog.previewFailed")).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox") as HTMLInputElement[]) {
      if (box.checked) await userEvent.click(box);
    }
    expect(await screen.findByText("sharing:links.dialog.previewEmpty")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "sharing:links.dialog.create" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
  it("offers the itinerary with what it shows and never shows, and previews the current entry in words (forgejo#302)", async () => {
    const tv = (utc: string, local: string, zone: string, offset: string) => ({
      utc,
      zone,
      offset,
      local,
      precision: "minute" as const,
      zoneSource: "stored" as const,
    });
    api.preview.mockResolvedValue({
      view: {
        kind: "trip",
        trip: {
          itinerary: {
            sections: ["flights", "stays"],
            items: [
              {
                kind: "flight",
                airline: "Lufthansa",
                flightNumber: "LH400",
                from: { code: "FRA", name: "Frankfurt" },
                to: { code: "JFK", name: "New York JFK" },
                departure: tv(
                  "2030-06-01T12:00:00.000Z",
                  "2030-06-01T14:00:00",
                  "Europe/Berlin",
                  "+02:00"
                ),
                arrival: tv(
                  "2030-06-01T20:00:00.000Z",
                  "2030-06-01T16:00:00",
                  "America/New_York",
                  "-04:00"
                ),
                terminal: "1",
                gate: "B12",
                phase: "inFlight",
              },
              {
                kind: "stay",
                name: "Hotel Hudson View",
                address: "356 W 58th St",
                city: "New York",
                country: "US",
                checkIn: { date: "2030-06-01", zone: "America/New_York", precision: "day" },
                checkOut: { date: "2030-06-04", zone: "America/New_York", precision: "day" },
                checkInAt: null,
                checkOutAt: null,
              },
            ],
            now: { index: 0, state: "inProgress" },
          },
        },
      },
      photosOmitted: null,
    });
    renderDialog("trip");
    const box = await screen.findByRole("checkbox", {
      name: "sharing:links.fields.trip.flights",
    });
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(box.getAttribute("aria-describedby")).toBe("share-link-itinerary-hint");
    expect(screen.getByText("sharing:links.dialog.itineraryHint")).toBeTruthy();
    const list = await screen.findByTestId("share-itinerary");
    const entries = list.querySelectorAll("li");
    expect(entries).toHaveLength(2);
    expect(entries[0].getAttribute("aria-current")).toBe("step");
    expect(entries[0].textContent).toContain("sharing:links.view.itinerary.inProgress");
    expect(entries[0].textContent).toContain("LH400");
    // On the place's clock, with its zone written out.
    expect(entries[0].textContent).toContain("14:00 (Europe/Berlin · UTC+02:00)");
    expect(entries[0].textContent).toContain("16:00 (America/New_York · UTC-04:00)");
    expect(entries[1].getAttribute("aria-current")).toBeNull();
    expect(entries[1].textContent).toContain("Hotel Hudson View");
    expect(entries[1].textContent).toContain("356 W 58th St, New York, US");
  });

  it("says that the trip is over when an itinerary link is refused for it", async () => {
    api.preview.mockResolvedValue({
      view: { kind: "trip", trip: { name: "NY" } },
      photosOmitted: null,
    });
    api.create.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "SHARE_LINK_TRIP_ENDED" } },
    });
    renderDialog("trip");
    await screen.findByTestId("share-preview");
    await userEvent.click(screen.getByRole("button", { name: "sharing:links.dialog.create" }));
    expect(await screen.findByText("sharing:links.errors.tripEnded")).toBeTruthy();
  });
});
