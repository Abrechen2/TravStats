import { useState } from "react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NewRoadtripDialog from "../NewRoadtripDialog";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import { tripsApi } from "../../../lib/api/trips";

vi.mock("../../../lib/api/roadtrips", () => ({ roadtripsApi: { create: vi.fn() } }));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn(async () => [{ id: "t1", name: "Herbst in Norwegen" }]) },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

function renderDialog(onCreated = vi.fn()): ReturnType<typeof vi.fn> {
  render(<NewRoadtripDialog open onClose={vi.fn()} onCreated={onCreated} />);
  return onCreated;
}

const networkError = (): Error =>
  Object.assign(new Error("Network Error"), { isAxiosError: true, response: undefined });

const submitButton = (): HTMLElement =>
  screen.getByText("roadtrips:newDialog.submit").closest("button") as HTMLElement;

describe("NewRoadtripDialog", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("offers no rail — train journeys are a domain of their own (owner, 2026-09-25)", async () => {
    renderDialog();
    await screen.findByText("Herbst in Norwegen");
    expect(screen.getByText("roadtrips:vehicle.campervan")).toBeInTheDocument();
    expect(screen.queryByText("roadtrips:vehicle.rail")).not.toBeInTheDocument();
  });

  it("needs only a name, and sends what was filled in", async () => {
    vi.mocked(roadtripsApi.create).mockResolvedValue({ id: "new" } as never);
    const onCreated = renderDialog();
    expect(submitButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.name/), {
      target: { value: "Fjorde 2026" },
    });
    fireEvent.click(screen.getByText("roadtrips:vehicle.campervan"));
    fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.odometer/), {
      target: { value: "84 210" },
    });
    await screen.findByText("Herbst in Norwegen");
    fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.trip/), {
      target: { value: "t1" },
    });
    fireEvent.click(submitButton());

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(roadtripsApi.create).toHaveBeenCalledWith({
      name: "Fjorde 2026",
      vehicle: "campervan",
      vehicleName: null,
      tripId: "t1",
      startOdometerKm: 84210,
    });
  });

  // forgejo#245: the one required field is marked, the optional ones are not
  // marked "optional" any more, and the greyed-out button says what it waits for.
  it("marks the name as required and says beside the button that it is missing", async () => {
    renderDialog();
    await screen.findByText("Herbst in Norwegen");
    const name = screen.getByLabelText(/roadtrips:newDialog.name/);
    expect(name).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
    expect(screen.queryByText(/newDialog.optional/)).not.toBeInTheDocument();

    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent("roadtrips:newDialog.name");
    expect(submitButton()).toHaveAttribute("aria-describedby", "roadtrip-new-save-blocked");
    fireEvent.click(screen.getByRole("button", { name: "roadtrips:newDialog.name" }));
    expect(name).toHaveFocus();

    fireEvent.change(name, { target: { value: "Fjorde" } });
    expect(screen.queryByTestId("save-blocked-hint")).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("says at the odometer why it cannot be a reading, and holds the save back", async () => {
    renderDialog();
    await screen.findByText("Herbst in Norwegen");
    fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.name/), { target: { value: "X" } });
    const odometer = screen.getByLabelText(/roadtrips:newDialog.odometer/);
    fireEvent.change(odometer, { target: { value: "12,5" } });

    expect(submitButton()).toBeDisabled();
    expect(odometer).toHaveAttribute("aria-invalid", "true");
    expect(odometer).toHaveAccessibleDescription("roadtrips:newDialog.odometerInvalid");
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent(
      "roadtrips:newDialog.odometerMissing"
    );
  });

  // forgejo#246/#247: a failed create is said in the dialog and stays; the
  // draft is kept; a network failure offers a retry that sends once more.
  it("keeps the draft on a failed create, says why in a banner and retries once", async () => {
    vi.mocked(roadtripsApi.create)
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ id: "new" } as never);
    const onCreated = renderDialog();
    fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.name/), {
      target: { value: "Fjorde" },
    });
    fireEvent.click(submitButton());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.network");
    expect(screen.getByLabelText(/roadtrips:newDialog.name/)).toHaveValue("Fjorde");
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(roadtripsApi.create).toHaveBeenCalledTimes(2);
  });

  it("creates once however fast the button is pressed twice", async () => {
    let resolve: (value: never) => void = () => {};
    vi.mocked(roadtripsApi.create).mockImplementation(
      () => new Promise((r) => (resolve = r as (value: never) => void))
    );
    renderDialog();
    await screen.findByText("Herbst in Norwegen");
    fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.name/), {
      target: { value: "Fjorde" },
    });
    const button = submitButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => resolve({ id: "new" } as never));
    expect(roadtripsApi.create).toHaveBeenCalledTimes(1);
  });

  it("says so when the trips cannot be loaded, instead of offering only “no trip”", async () => {
    vi.mocked(tripsApi.getAll).mockRejectedValueOnce(networkError());
    renderDialog();
    expect(await screen.findByText("roadtrips:newDialog.tripsFailed")).toBeInTheDocument();
  });

  // forgejo#248 + rollout rule: the dialog stays mounted, so it must start over
  // on every opening, and ask before a typed name is thrown away.
  it("asks before discarding a typed name, and opens empty the next time", async () => {
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen
          </button>
          <NewRoadtripDialog open={open} onClose={() => setOpen(false)} onCreated={vi.fn()} />
        </>
      );
    }
    render(<Harness />);
    await userEvent.type(screen.getByLabelText(/roadtrips:newDialog.name/), "Fjorde");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "common:discard.confirm" }));
    await waitFor(() =>
      expect(screen.queryByLabelText(/roadtrips:newDialog.name/)).not.toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: "reopen" }));
    expect(screen.getByLabelText(/roadtrips:newDialog.name/)).toHaveValue("");
    // Untouched: Escape closes without a question.
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByLabelText(/roadtrips:newDialog.name/)).not.toBeInTheDocument()
    );
    expect(screen.queryByText("common:discard.title")).not.toBeInTheDocument();
  });
});
