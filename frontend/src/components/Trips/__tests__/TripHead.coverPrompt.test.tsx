import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../TripMoreMenu", () => ({ default: () => <div>more-menu</div> }));
vi.mock("../CoverSuggestDialog", () => ({ default: () => <div>cover-dialog</div> }));
vi.mock("../TripTravellers", () => ({ default: () => null }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import TripHead from "../TripHead";
import type { Trip } from "../../../types";

const t = ((key: string) => key) as never;
const base = {
  id: "t1",
  name: "Lisbon",
  status: "completed",
  countries: [],
  companions: [],
  times: [],
  cruises: [],
  stops: [],
  flights: [],
} as unknown as Trip;

const renderHead = (trip: Trip) =>
  render(
    <MemoryRouter>
      <TripHead
        trip={trip}
        locale="de"
        t={t}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onChanged={vi.fn()}
      />
    </MemoryRouter>
  );

describe("trip head cover prompt", () => {
  it("offers a cover suggestion on a trip without a cover, and only opens it on a click", async () => {
    renderHead({ ...base, coverImageUrl: null });
    expect(screen.queryByText("cover-dialog")).toBeNull();
    await userEvent.click(screen.getByTestId("cover-suggest-prompt"));
    expect(screen.getByText("cover-dialog")).toBeInTheDocument();
  });

  it("stays quiet on a trip that already has a cover", () => {
    renderHead({ ...base, coverImageUrl: "/api/v1/trips/t1/photos/p/file" });
    expect(screen.queryByTestId("cover-suggest-prompt")).toBeNull();
  });
});
