// forgejo#312 — the map panel's switch for recorded flight paths: behind the
// `flightTrackUpload` beta key, off by default, and it drives the store the
// dashboard's fetch reads.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

let betaOn = true;
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: betaOn,
    isFeatureVisible: (key: string) => betaOn && key === "flightTrackUpload",
  }),
}));

import { RecordedFlightPathsToggle } from "../RecordedFlightPathsToggle";
import { useRecordedFlightPathsStore } from "../../../store/recordedFlightPathsStore";

describe("RecordedFlightPathsToggle", () => {
  beforeEach(() => {
    betaOn = true;
    window.localStorage.clear();
    useRecordedFlightPathsStore.setState({ show: false });
  });

  it("switches the option on and back off", () => {
    render(<RecordedFlightPathsToggle />);
    const button = screen.getByRole("button", {
      name: /recordedFlightPaths|Flugwege|flight paths/i,
    });
    fireEvent.click(button);
    expect(useRecordedFlightPathsStore.getState().show).toBe(true);
    fireEvent.click(button);
    expect(useRecordedFlightPathsStore.getState().show).toBe(false);
  });

  it("is not there while the beta key is closed", () => {
    betaOn = false;
    render(<RecordedFlightPathsToggle />);
    expect(screen.queryByTestId("recorded-flight-paths-toggle")).toBeNull();
  });
});
