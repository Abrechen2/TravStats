import { describe, it, expect, vi } from "vitest";

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
});
