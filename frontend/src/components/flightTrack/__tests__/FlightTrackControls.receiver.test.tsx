/**
 * "Fetch from my receiver" on the flight page (forgejo#408): the button needs a
 * hex, a refusal is said in the reader's language, and a stored recording is
 * only replaced after asking.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const receiverMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  flightsApi: {
    fetchReceiverTrack: (...args: unknown[]) => receiverMock(...args),
    uploadTrackFile: vi.fn(),
    deleteTrack: vi.fn(),
  },
}));
import FlightTrackControls from "../FlightTrackControls";

const apiError = (code: string) => ({
  response: { status: 409, data: { error: "english prose", code } },
});

describe("FlightTrackControls receiver action", () => {
  beforeEach(() => receiverMock.mockClear());

  it("offers no receiver button for a flight without an ICAO24 hex", () => {
    render(<FlightTrackControls flightId="f1" hasTrack={false} onChanged={vi.fn()} />);
    expect(screen.queryByTestId("flight-track-receiver")).toBeNull();
  });

  it("fetches without replace when no recording exists and reloads", async () => {
    receiverMock.mockResolvedValue({});
    const onChanged = vi.fn();
    render(
      <FlightTrackControls
        flightId="f1"
        hasTrack={false}
        onChanged={onChanged}
        aircraftModeS="3C6444"
      />
    );
    fireEvent.click(screen.getByTestId("flight-track-receiver"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(receiverMock).toHaveBeenCalledWith("f1", false);
    expect(receiverMock).toHaveBeenCalledTimes(1);
  });

  it("shows a refused receiver as its own sentence, not the server's English prose", async () => {
    receiverMock.mockRejectedValueOnce(apiError("RECEIVER_NOT_CONFIGURED"));
    render(
      <FlightTrackControls
        flightId="f1"
        hasTrack={false}
        onChanged={vi.fn()}
        aircraftModeS="3C6444"
      />
    );
    fireEvent.click(screen.getByTestId("flight-track-receiver"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "flights:track.receiverErrors.notConfigured"
    );
    expect(receiverMock).toHaveBeenCalledTimes(1);
  });

  it("asks before it replaces an existing recording", async () => {
    receiverMock.mockResolvedValue({});
    render(
      <FlightTrackControls flightId="f1" hasTrack onChanged={vi.fn()} aircraftModeS="3C6444" />
    );
    fireEvent.click(screen.getByTestId("flight-track-receiver"));
    expect(receiverMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "flights:track.replace" }));
    await waitFor(() => expect(receiverMock).toHaveBeenCalledWith("f1", true));
  });
});
