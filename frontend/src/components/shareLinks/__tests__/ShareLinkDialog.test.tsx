import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

function renderDialog(kind: "flight" | "trip" = "flight") {
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
      view: {
        kind: "flight",
        flight: {
          flightNumber: { airline: "Lufthansa", number: "LH400" },
          route: { from: { code: "FRA", name: null }, to: { code: "JFK", name: null } },
          progress: { phase: "inFlight", fraction: 0.5, eta: null, basis: "schedule" },
        },
      },
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

  it("previews the ticked fields and asks again when one is unticked", async () => {
    renderDialog();
    expect(await screen.findByText("LH400", { exact: false })).toBeTruthy();
    expect(api.preview).toHaveBeenLastCalledWith({
      kind: "flight",
      targetId: "f1",
      fields: ["flightNumber", "route", "progress"],
    });
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(7);
    const routeBox = boxes.find((b) =>
      b.parentElement?.textContent?.includes("sharing:links.fields.flight.route")
    )!;
    await userEvent.click(routeBox);
    await waitFor(() =>
      expect(api.preview).toHaveBeenLastCalledWith({
        kind: "flight",
        targetId: "f1",
        fields: ["flightNumber", "progress"],
      })
    );
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
    expect(sent).toMatchObject({ kind: "flight", targetId: "f1" });
    expect(sent.expiresInDays).toBe(90);
    expect(sent).not.toHaveProperty("expiresAt");
    expect(screen.queryByRole("button", { name: "sharing:links.dialog.create" })).toBeNull();
  });

  it("says why the server refused — a landed flight is not a network error", async () => {
    api.create.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "SHARE_LINK_FLIGHT_LANDED" } },
    });
    renderDialog();
    await screen.findByText("LH400", { exact: false });
    await userEvent.click(screen.getByRole("button", { name: "sharing:links.dialog.create" }));
    expect(await screen.findByText("sharing:links.errors.landed")).toBeTruthy();
  });

  it("offers a trip's shareable notes as a field and previews how many travel (forgejo#146)", async () => {
    api.preview.mockResolvedValue({
      view: {
        kind: "trip",
        trip: {
          notes: {
            items: [
              {
                body: "Sunset",
                placeName: null,
                at: {
                  utc: "2030-06-04T23:30:00.000Z",
                  zone: "America/New_York",
                  offset: "-04:00",
                  local: "2030-06-04T19:30:00",
                  precision: "minute",
                },
                day: { date: "2030-06-04", zone: "America/New_York", precision: "day" },
              },
            ],
            truncated: true,
          },
        },
      },
      photosOmitted: null,
    });
    renderDialog("trip");
    const box = await screen.findByRole("checkbox", { name: "sharing:links.fields.trip.notes" });
    expect((box as HTMLInputElement).checked).toBe(false);
    await userEvent.click(box);
    await waitFor(() =>
      expect(api.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ fields: expect.arrayContaining(["notes"]) })
      )
    );
    const preview = await screen.findByTestId("share-preview");
    expect(preview.textContent).toContain("sharing:links.view.notes");
    expect(preview.textContent).toContain("sharing:links.view.moreNotes");
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
});
