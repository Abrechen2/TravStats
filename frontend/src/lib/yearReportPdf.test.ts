import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock jspdf and jspdf-autotable
const mockSave = vi.fn();
const mockText = vi.fn();
const mockSetFontSize = vi.fn();
const mockAddPage = vi.fn();
const mockAutoTable = vi.fn();

vi.mock("jspdf", () => {
  function MockJsPDF() {
    return {
      save: mockSave,
      text: mockText,
      setFontSize: mockSetFontSize,
      addPage: mockAddPage,
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
      setFont: vi.fn(),
      setTextColor: vi.fn(),
      setDrawColor: vi.fn(),
      line: vi.fn(),
    };
  }
  return { jsPDF: MockJsPDF };
});

vi.mock("jspdf-autotable", () => ({ default: mockAutoTable }));

import { generateYearReportPdf } from "./yearReportPdf";
import type { Flight } from "../types";

const mockFlight: Flight = {
  id: "1",
  userId: "u1",
  airline: "Lufthansa",
  flightNumber: "LH123",
  depIata: "FRA",
  depName: "Frankfurt",
  depLat: 50.0,
  depLon: 8.5,
  arrIata: "JFK",
  arrName: "New York JFK",
  arrLat: 40.6,
  arrLon: -73.7,
  departureTime: "2026-01-15T08:00:00Z",
  arrivalTime: "2026-01-15T11:00:00Z",
  status: "flown",
  createdAt: "2026-01-15T00:00:00Z",
  tags: [],
  companions: [],
  co2Kg: 450,
};

describe("generateYearReportPdf", () => {
  it("calls jsPDF save with correct filename", async () => {
    await generateYearReportPdf({
      year: 2026,
      flights: [mockFlight],
      userName: "Dennis",
      units: "km",
    });
    expect(mockSave).toHaveBeenCalledWith("flug-jahr-2026.pdf");
  });

  it("calls addPage for the flight list page", async () => {
    await generateYearReportPdf({
      year: 2026,
      flights: [mockFlight],
      userName: "Dennis",
      units: "km",
    });
    expect(mockAddPage).toHaveBeenCalled();
  });

  it("calls autoTable with flight rows", async () => {
    await generateYearReportPdf({
      year: 2026,
      flights: [mockFlight],
      userName: "Dennis",
      units: "km",
    });
    expect(mockAutoTable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.arrayContaining([expect.arrayContaining(["Lufthansa", "LH123"])]),
      })
    );
  });

  describe("favourite route (forgejo#254)", () => {
    beforeEach(() => {
      mockText.mockClear();
    });

    const leg = (id: string, dep: string, arr: string): Flight => ({
      ...mockFlight,
      id,
      depIata: dep,
      arrIata: arr,
    });

    it("counts a connection in both directions as one pair", async () => {
      // 4 x HNL->OGG and 4 x OGG->HNL beat 5 x FRA->JFK only if they are ONE
      // connection of eight; keyed by direction the PDF named FRA -> JFK.
      const flights = [
        ...[1, 2, 3, 4].map((n) => leg(`a${n}`, "HNL", "OGG")),
        ...[1, 2, 3, 4].map((n) => leg(`b${n}`, "OGG", "HNL")),
        ...[1, 2, 3, 4, 5].map((n) => leg(`c${n}`, "FRA", "JFK")),
      ];
      await generateYearReportPdf({ year: 2026, flights, userName: "Dennis", units: "km" });
      const drawn = mockText.mock.calls.map((call) => call[0]);
      expect(drawn).toContain("HNL - OGG");
      expect(drawn).not.toContain("FRA \u2192 JFK");
    });

    it("shows a dash when no flight names both airports", async () => {
      await generateYearReportPdf({
        year: 2026,
        flights: [{ ...mockFlight, depIata: undefined, depIcao: undefined }],
        userName: "Dennis",
        units: "km",
      });
      const drawn = mockText.mock.calls.map((call) => call[0]);
      expect(drawn).not.toContain("? \u2192 JFK");
      expect(drawn.filter((d) => d === "-").length).toBeGreaterThan(0);
    });
  });

  describe("characters the PDF font has", () => {
    // jsPDF's built-in Helvetica is WinAnsi: an arrow, a subscript two, a
    // dingbat or a narrow no-break space is drawn as garbage in the real file.
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.flatMap(strings) : typeof value === "string" ? [value] : [];

    it.each(["km", "mi"] as const)("draws only Latin-1 characters (%s)", async (units) => {
      mockText.mockClear();
      mockAutoTable.mockClear();
      const flights: Flight[] = [
        mockFlight,
        { ...mockFlight, id: "2", depIata: undefined, co2Kg: undefined, departureTime: undefined },
      ] as Flight[];
      await generateYearReportPdf({ year: 2026, flights, userName: "Dennis", units });

      const drawn = [
        ...mockText.mock.calls.flatMap((call) => strings(call[0])),
        ...mockAutoTable.mock.calls.flatMap((call) => [
          ...strings(call[1].head),
          ...strings(call[1].body),
        ]),
      ];
      expect(drawn.length).toBeGreaterThan(10);
      const offenders = drawn.filter((text) => [...text].some((c) => c.charCodeAt(0) > 0xff));
      expect(offenders).toEqual([]);
    });
  });
});
