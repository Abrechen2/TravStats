import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import OdometerDialog from "../OdometerDialog";
import { toursApi } from "../../../lib/api/tours";

vi.mock("../../../lib/api/tours", () => ({
  toursApi: { update: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const save = (): HTMLElement =>
  screen.getByText("roadtrips:odometerDialog.save").closest("button") as HTMLElement;

/**
 * forgejo#280 point 1: the end reading is what makes a finished roadtrip
 * "Gefahren" without a GPS track, so the page needs a place to enter it —
 * until now only the start could be given, and only when creating.
 */
describe("OdometerDialog", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("sends both readings, and an emptied one as null (unknown, never 0)", async () => {
    vi.mocked(toursApi.update).mockResolvedValue({} as never);
    const onSaved = vi.fn();
    render(
      <OdometerDialog
        routeId="r1"
        startOdometerKm={84_210}
        endOdometerKm={null}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );
    fireEvent.change(screen.getByLabelText("roadtrips:odometerDialog.end"), {
      target: { value: "86 010" },
    });
    fireEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toursApi.update).toHaveBeenCalledWith(undefined, "r1", {
      startOdometerKm: 84_210,
      endOdometerKm: 86_010,
    });

    vi.mocked(toursApi.update).mockClear();
    fireEvent.change(screen.getByLabelText("roadtrips:odometerDialog.start"), {
      target: { value: "" },
    });
    fireEvent.click(save());
    await waitFor(() =>
      expect(toursApi.update).toHaveBeenCalledWith(undefined, "r1", {
        startOdometerKm: null,
        endOdometerKm: 86_010,
      })
    );
  });

  it("refuses an end reading below the start", () => {
    render(
      <OdometerDialog
        routeId="r1"
        startOdometerKm={84_210}
        endOdometerKm={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("roadtrips:odometerDialog.end"), {
      target: { value: "80000" },
    });
    expect(screen.getByText("roadtrips:odometerDialog.backwards")).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("says so when saving fails, and keeps the dialog open", async () => {
    vi.mocked(toursApi.update).mockRejectedValue(
      Object.assign(new Error("Network Error"), { isAxiosError: true, response: undefined })
    );
    const onSaved = vi.fn();
    render(
      <OdometerDialog
        routeId="r1"
        startOdometerKm={1}
        endOdometerKm={2}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });
});
