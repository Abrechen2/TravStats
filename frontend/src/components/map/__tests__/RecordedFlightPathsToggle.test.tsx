// forgejo#312 — the map panel's switch for recorded flight paths: off by default (released from beta, forgejo#390), and it drives the store the
// dashboard's fetch reads.
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { RecordedFlightPathsToggle } from "../RecordedFlightPathsToggle";
import { useRecordedFlightPathsStore } from "../../../store/recordedFlightPathsStore";

describe("RecordedFlightPathsToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useRecordedFlightPathsStore.setState({ show: false });
  });

  it("switches the option on and back off", () => {
    render(<RecordedFlightPathsToggle />);
    const button = screen.getByRole("switch", {
      name: /recordedFlightPaths|Flugwege|flight paths/i,
    });
    fireEvent.click(button);
    expect(useRecordedFlightPathsStore.getState().show).toBe(true);
    fireEvent.click(button);
    expect(useRecordedFlightPathsStore.getState().show).toBe(false);
  });
});
