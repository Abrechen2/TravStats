/**
 * forgejo#405: roadtrips and tours had no tags. The editor saves through the
 * shared section endpoint, and a failed save says so instead of reverting.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TourRoute } from "../../../types/tour";

// A plain function, not a vi.fn(): a spy on a rejecting promise leaves its own derived promise unhandled.
let updateImpl: (...a: unknown[]) => Promise<unknown> = () => Promise.resolve(null);
const calls: unknown[][] = [];
vi.mock("../../../lib/api/tours", () => ({
  toursApi: {
    update: (...a: unknown[]) => {
      calls.push(a);
      return updateImpl(...a);
    },
  },
}));
vi.mock("../../../hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import RouteTagsEditor from "../RouteTagsEditor";

const route = { id: "r1", tags: ["Wohnmobil"] };

describe("RouteTagsEditor", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("shows the stored tags and sends the edited list for a standalone route", async () => {
    updateImpl = () => Promise.resolve({ id: "r1", tags: ["Wohnmobil", "Norwegen"] } as TourRoute);
    const onSaved = vi.fn();
    render(<RouteTagsEditor route={route} tripId={undefined} onSaved={onSaved} />);
    expect(screen.getByText("#Wohnmobil")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Tags bearbeiten" }));
    await userEvent.type(screen.getByLabelText("Tags"), "Norwegen,");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls).toEqual([[undefined, "r1", { tags: ["Wohnmobil", "Norwegen"] }]]);
  });

  it("keeps the editor open and says so when saving fails", async () => {
    updateImpl = () =>
      Promise.reject({
        isAxiosError: true,
        response: { status: 503, data: { code: "DB_UNAVAILABLE" } },
      });
    const onSaved = vi.fn();
    render(<RouteTagsEditor route={route} tripId="t1" onSaved={onSaved} />);
    await userEvent.click(screen.getByRole("button", { name: "Tags bearbeiten" }));
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeInTheDocument();
  });
});
