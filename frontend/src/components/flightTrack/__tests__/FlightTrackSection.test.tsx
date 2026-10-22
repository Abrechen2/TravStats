/**
 * The flight page's recording section (forgejo#193): silent without a
 * recording, the map and what it measured with one, and a failed load said
 * as such — never passed off as "no recording".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FlightTrack } from "../../../types/flightTrack";

const getTrackMock = vi.fn();
const uploadMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  flightsApi: {
    getTrack: (...args: unknown[]) => getTrackMock(...args),
    uploadTrackFile: (...args: unknown[]) => uploadMock(...args),
    deleteTrack: (...args: unknown[]) => deleteMock(...args),
  },
}));
// The upload is behind the `flightTrackUpload` beta key (forgejo#312).
let betaOn = false;
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: betaOn,
    isFeatureVisible: (key: string) => betaOn && key === "flightTrackUpload",
  }),
}));
// The global mock returns bare keys; this one shows what was interpolated, so
// the numbers the caption is built from can be asserted.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "en" },
  }),
}));
// WebGL is not there in jsdom; the map has its own pure helpers under test.
vi.mock("../FlightTrackMap", () => ({
  FlightTrackMap: () => <div data-testid="flight-track-map-stub" />,
}));

import FlightTrackSection from "../FlightTrackSection";

const MUC = { lat: 48.3538, lon: 11.7861 };
const ICN = { lat: 37.4602, lon: 126.4407 };

const at = (utc: string, zone: string) => ({
  utc,
  zone,
  offset: "+00:00",
  local: utc.slice(0, 19),
  precision: "minute" as const,
  zoneSource: "catalogue" as const,
});

function makeTrack(over: Partial<FlightTrack> = {}): FlightTrack {
  return {
    id: "t1",
    flightId: "f1",
    source: "companion",
    uploadId: "rec-1",
    deviceId: "phone-1",
    times: {
      startedAt: at("2026-10-03T08:00:00Z", "Europe/Berlin"),
      endedAt: at("2026-10-03T19:00:00Z", "Asia/Seoul"),
    },
    pointCount: 12345,
    jitterDropped: 0,
    distanceKm: 8567.4,
    geometry: [
      [11.78, 48.35],
      [126.45, 37.46],
    ],
    segmentStarts: [0],
    elevations: null,
    createdAt: "2026-10-04T05:00:00Z",
    updatedAt: "2026-10-04T05:00:00Z",
    ...over,
  };
}

describe("FlightTrackSection", () => {
  // A block, not an arrow returning the mock: vitest runs a function returned
  // from beforeEach as the test's teardown, which would call the mock again.
  beforeEach(() => {
    getTrackMock.mockReset();
    uploadMock.mockReset();
    deleteMock.mockReset();
    betaOn = false;
  });

  it("draws nothing for a flight without a recording", async () => {
    getTrackMock.mockResolvedValue(null);
    const { container } = render(<FlightTrackSection flightId="f1" />);
    await waitFor(() => expect(getTrackMock).toHaveBeenCalledWith("f1"));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the map and what the phone measured", async () => {
    getTrackMock.mockResolvedValue(makeTrack());
    render(<FlightTrackSection flightId="f1" />);
    expect(await screen.findByTestId("flight-track-map-stub")).toBeInTheDocument();
    const caption = screen.getByTestId("flight-track-caption").textContent ?? "";
    expect(caption).toContain("flights:track.caption");
    expect(caption).toContain('"points":"12,345"');
    expect(caption).toMatch(/"distance":"8,567 /);
    // An unbroken recording claims no gaps.
    expect(caption).not.toContain("flights:track.gaps");
  });

  it("says how many stretches without a fix are left out", async () => {
    getTrackMock.mockResolvedValue(makeTrack({ segmentStarts: [0, 4, 9] }));
    render(<FlightTrackSection flightId="f1" />);
    const caption = await screen.findByTestId("flight-track-caption");
    expect(caption.textContent).toContain('flights:track.gaps {"count":2}');
  });

  it("says the recording could not be loaded instead of hiding the failure", async () => {
    getTrackMock.mockImplementation(async () => {
      throw new Error("503 from the server");
    });
    render(<FlightTrackSection flightId="f1" />);
    expect(await screen.findByText("flights:track.loadError")).toBeInTheDocument();
    expect(screen.queryByTestId("flight-track-map-stub")).not.toBeInTheDocument();
  });

  it("draws no upload and no comparison while the beta key is closed", async () => {
    getTrackMock.mockResolvedValue(makeTrack());
    render(<FlightTrackSection flightId="f1" departure={MUC} arrival={ICN} />);
    await screen.findByTestId("flight-track-map-stub");
    expect(screen.queryByTestId("flight-track-file")).not.toBeInTheDocument();
    expect(screen.queryByTestId("flight-track-comparison")).not.toBeInTheDocument();
  });

  describe("with the flightTrackUpload beta key (forgejo#312)", () => {
    beforeEach(() => {
      betaOn = true;
    });

    const pick = (name: string) => {
      const file = new File(["<kml/>"], name, { type: "application/xml" });
      fireEvent.change(screen.getByTestId("flight-track-file"), { target: { files: [file] } });
      return file;
    };

    it("offers the upload on a flight without a recording, then shows what was stored", async () => {
      getTrackMock.mockResolvedValueOnce(null).mockResolvedValueOnce(makeTrack({ source: "kml" }));
      uploadMock.mockResolvedValue({});
      render(<FlightTrackSection flightId="f1" />);
      await screen.findByText("flights:track.uploadIntro");
      const file = pick("export.kml");
      await waitFor(() => expect(uploadMock).toHaveBeenCalledWith("f1", file, false));
      expect(await screen.findByTestId("flight-track-map-stub")).toBeInTheDocument();
      expect(screen.getByTestId("flight-track-caption").textContent).toContain(
        'flights:track.captionFile {"distance"'
      );
      expect(screen.getByTestId("flight-track-caption").textContent).toContain('"format":"KML"');
    });

    it("says why a file was refused, in the reader's language", async () => {
      getTrackMock.mockResolvedValue(null);
      uploadMock.mockRejectedValue({
        response: { status: 400, data: { code: "TRACK_FILE_UNREADABLE", error: "English prose" } },
      });
      render(<FlightTrackSection flightId="f1" />);
      await screen.findByText("flights:track.uploadIntro");
      pick("broken.gpx");
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "flights:track.errors.fileUnreadable"
      );
      expect(screen.queryByText("English prose")).not.toBeInTheDocument();
    });

    it.each([
      ["TRACK_FILE_UNSUPPORTED", "fileUnsupported"],
      ["TRACK_KML_INVALID", "kmlInvalid"],
      ["TRACK_KML_UNPAIRED", "kmlUnpaired"],
      ["TRACK_KML_NO_TRACK", "kmlNoTrack"],
      ["TRACK_KMZ_DAMAGED", "kmzDamaged"],
      ["TRACK_KMZ_NO_KML", "kmzNoKml"],
      ["TRACK_KMZ_TOO_LARGE", "kmzTooLarge"],
      ["TRACK_CSV_COLUMNS", "csvColumns"],
      ["TRACK_CSV_NO_POSITIONS", "csvNoPositions"],
    ])("says %s as its own sentence", async (code, key) => {
      getTrackMock.mockResolvedValue(null);
      uploadMock.mockRejectedValue({ response: { status: 400, data: { code, error: "prose" } } });
      render(<FlightTrackSection flightId="f1" />);
      await screen.findByText("flights:track.uploadIntro");
      pick("export.kml");
      expect(await screen.findByRole("alert")).toHaveTextContent(`flights:track.errors.${key}`);
    });

    it("offers every format the server reads in the file picker", async () => {
      getTrackMock.mockResolvedValue(null);
      render(<FlightTrackSection flightId="f1" />);
      await screen.findByText("flights:track.uploadIntro");
      expect(screen.getByTestId("flight-track-file")).toHaveAttribute(
        "accept",
        ".gpx,.kml,.kmz,.tcx,.fit,.csv"
      );
    });

    it("asks before a file replaces a stored recording, and sends replace only then", async () => {
      getTrackMock.mockResolvedValue(makeTrack());
      uploadMock.mockResolvedValue({});
      render(<FlightTrackSection flightId="f1" />);
      await screen.findByTestId("flight-track-map-stub");
      const file = pick("new.gpx");
      expect(uploadMock).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole("button", { name: "flights:track.replace" }));
      await waitFor(() => expect(uploadMock).toHaveBeenCalledWith("f1", file, true));
    });

    it("removes the recording after asking", async () => {
      getTrackMock.mockResolvedValueOnce(makeTrack()).mockResolvedValueOnce(null);
      deleteMock.mockResolvedValue(1);
      render(<FlightTrackSection flightId="f1" />);
      fireEvent.click(await screen.findByRole("button", { name: "flights:track.remove" }));
      expect(deleteMock).not.toHaveBeenCalled();
      const buttons = await screen.findAllByRole("button", { name: "flights:track.remove" });
      fireEvent.click(buttons[buttons.length - 1]);
      await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("f1"));
      expect(await screen.findByText("flights:track.uploadIntro")).toBeInTheDocument();
    });

    it("sets the measured distance against the great circle", async () => {
      getTrackMock.mockResolvedValue(makeTrack({ distanceKm: 9100 }));
      render(<FlightTrackSection flightId="f1" departure={MUC} arrival={ICN} />);
      const line = await screen.findByTestId("flight-track-comparison");
      // MUC-ICN is ~8,500 km on the great circle: 9,100 km is +7 %.
      expect(line.textContent).toContain('"flown":"9,100 ');
      expect(line.textContent).toMatch(/"greatCircle":"8,5\d\d /);
      expect(line.textContent).toContain('"difference":"+7"');
    });
  });
});
