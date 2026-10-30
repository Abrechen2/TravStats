import type { Flight } from "../types";
import { calculateDistance } from "./geo";
import { getFlightDuration } from "./flightDuration";
import { formatDate } from "./displayFormat";
import { favoriteConnection } from "./stats/favoriteConnection";

interface YearReportOptions {
  year: number;
  flights: Flight[];
  userName: string;
  units: "km" | "mi";
}

/**
 * Great-circle km, or null when an end has no coordinates. Reading a missing
 * coordinate as 0 measured the flight from a point in the Gulf of Guinea and
 * added thousands of invented kilometres to the year.
 */
function distanceOf(f: Flight): number | null {
  const ends = [f.depLat, f.depLon, f.arrLat, f.arrLon];
  if (!ends.every((v): v is number => typeof v === "number" && Number.isFinite(v))) return null;
  return calculateDistance(ends[0], ends[1], ends[2], ends[3]);
}

// jsPDF's built-in Helvetica is WinAnsi (Latin-1): it has no arrows, no subscript
// two, no dingbats and no narrow no-break space (what some locales put into
// `toLocaleString`). Every string drawn below stays inside Latin-1, so routes
// read "FRA - JFK" here while the web UI keeps its arrows, numbers are formatted
// as en-US like the English labels around them, and the unit is "CO2".
export async function generateYearReportPdf(opts: YearReportOptions): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const { year, flights, userName, units } = opts;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  // ─── Page 1: Summary ──────────────────────────────────────────────────────────

  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 64, 175);
  doc.text(`${year}`, pageW / 2, 30, { align: "center" });

  doc.setFontSize(16);
  doc.setTextColor(55, 65, 81);
  doc.text("My Flying Year", pageW / 2, 40, { align: "center" });

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(`${userName} · Generated on ${formatDate(new Date())}`, pageW / 2, 48, {
    align: "center",
  });

  doc.setDrawColor(209, 213, 219);
  doc.line(14, 52, pageW - 14, 52);

  // Compute summary stats
  let totalDistance = 0;
  let measuredFlights = 0;
  let totalFlightTimeMin = 0;
  let timedFlights = 0;
  let totalCo2 = 0;
  const airlineCounts = new Map<string, number>();

  for (const f of flights) {
    const dist = distanceOf(f);
    if (dist !== null) {
      totalDistance += dist;
      measuredFlights += 1;
    }
    // The shared duration rule, as on the stats page: placeholder clocks and
    // negative spans do not count (forgejo#377).
    const duration = getFlightDuration(f);
    if (duration) {
      totalFlightTimeMin += duration.minutes;
      timedFlights += 1;
    }
    if (f.co2Kg) totalCo2 += f.co2Kg;
    const airline = f.airline ?? "Unknown";
    airlineCounts.set(airline, (airlineCounts.get(airline) ?? 0) + 1);
  }

  const topAirline = [...airlineCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
  const topRoute = favoriteConnection(flights, " - ") ?? "-";
  const totalHours = Math.round(totalFlightTimeMin / 60);
  const distDisplay =
    units === "mi" ? Math.round(totalDistance * 0.621371) : Math.round(totalDistance);
  const distUnit = units === "mi" ? "mi" : "km";

  const summaryItems: [string, string][] = [
    ["Total Flights", String(flights.length)],
    // Nothing measured is "-", not "0 km".
    [
      "Total Distance",
      flights.length > 0 && measuredFlights === 0
        ? "-"
        : `${distDisplay.toLocaleString("en-US")} ${distUnit}`,
    ],
    // Nothing measurable is "-", not "0 h".
    ["Total Flight Time", timedFlights === 0 ? "-" : `${totalHours} h`],
    ["Most Flown Airline", topAirline],
    ["Favourite Route", topRoute],
    ...(totalCo2 > 0 ? ([["Total CO2", `${Math.round(totalCo2)} kg`]] as [string, string][]) : []),
  ];

  doc.setFontSize(11);
  let y = 62;
  for (const [label, value] of summaryItems) {
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "normal");
    doc.text(label, 20, y);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.text(value, 100, y);
    y += 10;
  }

  // ─── Page 2: Flight list ───────────────────────────────────────────────────────
  doc.addPage();

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 64, 175);
  doc.text("Flight Overview", 14, 20);

  const tableRows = flights.map((f) => {
    const date = f.departureTime ? formatDate(f.departureTime) : "-";
    const dep = f.depIata ?? f.depIcao ?? "?";
    const arr = f.arrIata ?? f.arrIcao ?? "?";
    const km = distanceOf(f);
    const dist = km === null ? null : Math.round(km);
    const co2 = f.co2Kg != null ? String(Math.round(f.co2Kg)) : "-";
    return [
      date,
      `${dep} - ${arr}`,
      f.airline ?? "-",
      f.flightNumber,
      dist === null ? "-" : dist.toLocaleString("en-US"),
      co2,
    ];
  });

  autoTable(doc, {
    head: [["Date", "Route", "Airline", "Flight", `Dist. (${distUnit})`, "CO2 (kg)"]],
    body: tableRows,
    startY: 26,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`flug-jahr-${year}.pdf`);
}
